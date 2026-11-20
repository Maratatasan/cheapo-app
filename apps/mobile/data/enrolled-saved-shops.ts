import { shopSchema, type Shop } from '@cheapo/domain';
import { normalizeName, shopDisplayName } from '@cheapo/domain/names';
import { randomUUID } from 'expo-crypto';

import type { EditableSavedShopRead, ShopCandidate, ShoppingRead } from './cheapo-shopping-reads';
import type { SavedShopState, ShopEditBase, ShopRepository } from './shop-repository';
import type { QueuedShoppingMutation, ShoppingMutationQueue } from './shopping-mutation-queue';
import { mutationResource, type ShoppingMutation } from './shopping-mutations';

type ShopAction = Extract<ShoppingMutation['action'], { kind: 'save-shop' | 'edit-shop' | 'unlink-shop' | 'select-shop' }>;
type Baseline = { state: SavedShopState; versions?: EditableSavedShopRead['versions']; observedOperations?: Set<string> };
const offline: Baseline = { state: { shops: [], sync: { status: 'unavailable' } } };
type Dependencies = {
  queue: Pick<ShoppingMutationQueue, 'read' | 'enqueue'>;
  loadHosted: (observedOperations: readonly string[]) => Promise<ShoppingRead<EditableSavedShopRead>>;
  loadCandidates?: (query: string, signal?: AbortSignal) => Promise<ShoppingRead<ShopCandidate[]>>;
  assertCurrent: () => Promise<void>;
  sync: () => Promise<unknown>;
};

function altersSelection(action: ShoppingMutation['action']) {
  return action.kind === 'select-shop' || (action.kind === 'save-shop' && action.select);
}

function compareBranchVersions(left: string, right: string) {
  const [leftCounter, leftLink] = left.split(':');
  const [rightCounter, rightLink] = right.split(':');
  return leftLink === rightLink ? Number(leftCounter) - Number(rightCounter) : undefined;
}

function shouldProjectSettledVersion(displayed: string | undefined, outcome: string | undefined, expected: string | undefined) {
  if (!displayed) return true;
  // Counters are comparable only within a link revision. If a nickname edit
  // changed the revision, the exact prior link still identifies older cache.
  const relativeToOutcome = outcome === undefined ? undefined : compareBranchVersions(displayed, outcome);
  if (relativeToOutcome !== undefined) return relativeToOutcome < 0;
  const relativeToExpected = expected === undefined ? undefined : compareBranchVersions(displayed, expected);
  // For unlink the expected revision is still visible in a pre-acknowledgement
  // cache. A different saved link is left intact until a checked read confirms it.
  return relativeToExpected !== undefined && relativeToExpected <= 0;
}

function project(baseline: Baseline, entries: QueuedShoppingMutation[]): SavedShopState {
  const shops = new Map(baseline.state.shops.map(shop => [shop.id, shop]));
  const editBases = new Map<string, ShopEditBase>(
    baseline.versions?.map(({ shopId, version }) => [shopId, { kind: 'version', version }]) ?? [],
  );
  const accepted = new Map(entries.flatMap(entry => entry.outcome?.kind === 'applied'
    ? [[entry.intent.operationId, entry.outcome.receipt.version] as const] : []));
  let currentId = baseline.state.currentShop?.id;

  for (const entry of entries) {
    if (entry.superseded) continue;
    const { action, operationId } = entry.intent;
    if (action.kind !== 'save-shop' && action.kind !== 'edit-shop' && action.kind !== 'unlink-shop' && action.kind !== 'select-shop') continue;
    const shopId = action.kind === 'save-shop' ? action.shop.id : action.shopId;
    const displayBase = editBases.get(shopId);
    const displayed = displayBase?.kind === 'version' ? displayBase.version : undefined;
    const expectedVersion = 'base' in action
      ? action.base.kind === 'version' ? action.base.version : accepted.get(action.base.operationId)
      : undefined;
    const expected = typeof expectedVersion === 'string' ? expectedVersion : undefined;
    const checkedAfterOutcome = baseline.observedOperations?.has(operationId);
    if (entry.resolution) {
      const conflict = entry.outcome;
      if (!checkedAfterOutcome && entry.resolution.kind === 'keep-cloud' && conflict?.kind === 'conflict' &&
        typeof conflict.currentVersion === 'string' && shouldProjectSettledVersion(displayed, conflict.currentVersion, expected)) {
        const checked = shopSchema.safeParse(conflict.current);
        if (checked.success && checked.data.id === shopId) {
          shops.set(shopId, { ...shops.get(shopId), ...checked.data });
          editBases.set(shopId, { kind: 'version', version: conflict.currentVersion });
        }
      }
      continue;
    }
    const applied = entry.outcome?.kind === 'applied' ? entry.outcome.receipt : undefined;
    if (applied && (checkedAfterOutcome || ('base' in action && !shouldProjectSettledVersion(
      displayed, typeof applied.version === 'string' ? applied.version : undefined, expected,
    )))) continue;
    switch (action.kind) {
      case 'save-shop':
        if (action.select) currentId = shopId;
        if (!shops.has(shopId)) shops.set(shopId, action.shop);
        else if (displayed && typeof applied?.version === 'string' && !shouldProjectSettledVersion(displayed, applied.version, undefined)) continue;
        break;
      case 'edit-shop': {
        const before = shops.get(shopId);
        if (!before) continue;
        const { name, nickname, address } = action.details;
        shops.set(shopId, { ...before,
          ...(name === undefined ? {} : { name: name ?? undefined }),
          ...(nickname === undefined ? {} : { nickname: nickname ?? undefined }),
          ...(address === undefined ? {} : { address: address ?? undefined }),
        });
        break;
      }
      case 'unlink-shop':
        shops.delete(shopId);
        editBases.delete(shopId);
        if (currentId === shopId) currentId = undefined;
        continue;
      case 'select-shop':
        if (shops.has(shopId)) currentId = shopId;
        continue;
    }
    editBases.set(shopId, typeof applied?.version === 'string'
      ? { kind: 'version', version: applied.version }
      : { kind: 'operation', operationId });
  }
  const currentShop = currentId ? shops.get(currentId) : undefined;
  return { shops: [...shops.values()], ...(currentShop ? { currentShop } : {}), editBases, sync: baseline.state.sync };
}

export function createEnrolledSavedShops(dependencies: Dependencies): ShopRepository {
  let baseline: Baseline | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  let loading: Promise<SavedShopState> | undefined;

  function write(makeAction: (state: SavedShopState) => ShopAction): Promise<SavedShopState> {
    const save = pending.then(async () => {
      await dependencies.assertCurrent();
      const source = baseline ?? offline;
      const { entries } = await dependencies.queue.read();
      const view = project(source, entries);
      const action = makeAction(view);
      const queued = entries.filter(entry => entry.outcome?.kind !== 'applied' && !entry.resolution && !entry.superseded);
      const shopId = action.kind === 'save-shop' ? action.shop.id : action.shopId;
      const previousShop = queued.findLast(entry => mutationResource(entry.intent.action) === `shop:${shopId}`);
      const previousSelection = altersSelection(action) ? queued.findLast(entry => altersSelection(entry.intent.action)) : undefined;
      const waitFor = [...new Set([previousShop, previousSelection].flatMap(entry => entry ? [entry.intent.operationId] : []))];
      const operationId = randomUUID();
      const lastCreated = entries.at(-1)?.intent.createdAt;
      const createdAt = new Date(Math.max(Date.now(), lastCreated ? Date.parse(lastCreated) + 1 : 0)).toISOString();
      const shop = action.kind === 'save-shop' ? action.shop : view.shops.find(item => item.id === shopId);
      const name = shop ? shopDisplayName(shop) : undefined;
      const actionTitle = { 'save-shop': 'Save', 'edit-shop': 'Edit', 'unlink-shop': 'Remove', 'select-shop': 'Select' }[action.kind];
      await dependencies.assertCurrent();
      await dependencies.queue.enqueue({
        operationId, createdAt, action,
        title: `${actionTitle} ${name ?? 'shop'}`.slice(0, 128),
        waitFor,
      });
      const saved = project(source, (await dependencies.queue.read()).entries);
      await dependencies.assertCurrent();
      void dependencies.sync().catch(() => {});
      return saved;
    });
    pending = save.catch(() => {});
    return save;
  }

  function requiredShop(state: SavedShopState, id: string): Shop {
    const shop = state.shops.find(item => item.id === id);
    if (!shop) throw Error('That shop is no longer saved.');
    return shop;
  }

  function requiredBase(base?: ShopEditBase) {
    if (!base) throw Error('Open a saved shop with its last synced version to make this change.');
    return base;
  }

  async function readSavedShops() {
    await dependencies.assertCurrent();
    const beforeRead = (await dependencies.queue.read()).entries;
    const observed = beforeRead.flatMap(entry => {
      if (entry.outcome?.kind !== 'applied' && entry.resolution?.kind !== 'keep-cloud') return [];
      const resource = mutationResource(entry.intent.action);
      return resource === 'current-shop' || resource.startsWith('shop:') ? [entry.intent.operationId] : [];
    });
    const result = await dependencies.loadHosted(observed);
    await dependencies.assertCurrent();
    if (result.status !== 'unavailable') {
      baseline = {
        state: { ...result.value, sync: { status: result.status, lastSyncedAt: result.lastSyncedAt } },
        versions: result.value.versions, observedOperations: new Set(result.observedOperationIds),
      };
    } else if (baseline?.state.sync?.status === 'fresh') {
      baseline.state = { ...baseline.state, sync: { status: 'cached', lastSyncedAt: baseline.state.sync.lastSyncedAt } };
    }
    const view = project(baseline ?? offline, (await dependencies.queue.read()).entries);
    await dependencies.assertCurrent();
    return view;
  }

  return {
    loadSavedShops() {
      return loading ??= readSavedShops().finally(() => { loading = undefined; });
    },
    async findShopCandidates(details, signal) {
      await dependencies.assertCurrent();
      const searches = [...new Set([normalizeName(details.address), normalizeName(details.name)])]
        .filter((value): value is string => value !== undefined && value.length >= 2 && value.length <= 120 && !value.includes('\0'));
      if (searches.length === 0) return { status: 'needs-details', shops: [] };
      const read = dependencies.loadCandidates;
      if (!read) return { status: 'unavailable', shops: [] };
      const responses = await Promise.all(searches.map(query => read(query, signal)));
      await dependencies.assertCurrent();
      const matches = new Map<string, ShopCandidate>();
      for (const result of responses) {
        if (result.status !== 'unavailable') {
          for (const shop of result.value) if (!matches.has(shop.id)) matches.set(shop.id, shop);
        }
      }
      return { status: responses.some(result => result.status === 'unavailable') ? 'unavailable' : 'checked',
        shops: [...matches.values()].slice(0, 20) };
    },
    saveShop(input, options) {
      return write(() => ({
        kind: 'save-shop', shop: shopSchema.parse({ ...input, id: input.id ?? randomUUID() }), select: options?.select,
      }));
    },
    updateShop(id, details, base) {
      return write(state => {
        const current = requiredShop(state, id);
        const next = shopSchema.parse({ ...current, ...details, address: normalizeName(details.address) });
        return { kind: 'edit-shop', shopId: id, base: requiredBase(base),
          details: { name: next.name ?? null, nickname: next.nickname ?? null, address: next.address ?? null } };
      });
    },
    removeShop(id, base) {
      return write(state => {
        requiredShop(state, id);
        return { kind: 'unlink-shop', shopId: id, base: requiredBase(base) };
      });
    },
    selectShop(id) {
      return write(state => {
        requiredShop(state, id);
        return { kind: 'select-shop', shopId: id };
      });
    },
  };
}

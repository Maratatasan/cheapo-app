import { comparisonPreferenceGroup, createEnrolledComparisonPreferences } from '../data/enrolled-comparison-preferences';
import type { ComparisonPreferenceRead, ShoppingRead } from '../data/cheapo-shopping-reads';
import type { QueuedShoppingMutation } from '../data/shopping-mutation-queue';
import { shoppingMutation, type ShoppingMutationInput } from '../data/shopping-mutations';

let mockNext = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `comparison-${++mockNext}` }));

const at = '2026-11-20T01:00:00.000Z';
const group = 'type:dry rice';

function fixture() {
  const entries: QueuedShoppingMutation[] = [];
  const args = {
    queue: {
      read: jest.fn(async () => ({ entries, recovery: [] })),
      enqueue: jest.fn(async (input: ShoppingMutationInput) => { entries.push({ intent: shoppingMutation.parse(input) }); }),
    },
    readHosted: jest.fn<Promise<ShoppingRead<ComparisonPreferenceRead>>, [string, AbortSignal?]>()
      .mockResolvedValue({ status: 'cached', lastSyncedAt: at, value: { basis: null, version: 0 } }),
    assertOwner: jest.fn(async () => {}),
    sync: jest.fn(async () => {}),
  };
  return { args, entries, repository: createEnrolledComparisonPreferences(args) };
}

test('uses the established category spelling rules and keeps canonical and fallback groups distinct', () => {
  expect(comparisonPreferenceGroup('starchy-sides', 'Dry rice')).toBe('starchy-sides');
  expect(comparisonPreferenceGroup(undefined, ' Dry  Rice ')).toBe(group);
  expect(comparisonPreferenceGroup('type:rice')).toBe('group:type:rice');
  expect(comparisonPreferenceGroup(undefined, 'pasta / noodles')).not.toBe(comparisonPreferenceGroup(undefined, 'pasta %2F noodles'));
  expect(comparisonPreferenceGroup(undefined, '/'.repeat(128))).toBeUndefined();
});

test('keeps a choice and a later offline clear after restart, with the exact displayed version dependency', async () => {
  const { args, entries, repository } = fixture();
  const current = await repository.load(group);
  const chosen = await repository.save(current, '100g');
  expect(entries[0].intent.action).toEqual({ kind: 'preference', groupId: group, basis: '100g', base: { kind: 'version', version: 0 } });
  args.readHosted.mockResolvedValue({ status: 'unavailable' });
  const reopened = createEnrolledComparisonPreferences(args);
  expect(await reopened.load(group)).toMatchObject({ basis: '100g', base: { kind: 'operation' } });
  expect(await reopened.loadLocal(group)).toMatchObject({ basis: '100g', base: { kind: 'operation' }, sync: 'unavailable' });
  const cleared = await reopened.save(chosen, null);
  expect(entries[1].intent.waitFor).toEqual([entries[0].intent.operationId]);
  expect(cleared.basis).toBeNull();
  expect(await reopened.load('type:another category')).toEqual({ groupId: 'type:another category', basis: null, sync: 'unavailable' });
});

test('keeps the chosen cloud value over an older cache and respects a newer server version', async () => {
  const { args, entries, repository } = fixture();
  await repository.save(await repository.load(group), '100g');
  entries[0].outcome = { kind: 'conflict', currentVersion: 4, current: { basis: 'kg' } };
  entries[0].resolution = { kind: 'keep-cloud', laterIds: [] };
  const reopened = createEnrolledComparisonPreferences(args);
  expect(await reopened.load(group)).toMatchObject({ basis: 'kg', base: { kind: 'version', version: 4 } });
  args.readHosted.mockResolvedValue({ status: 'fresh', lastSyncedAt: at, value: { basis: null, version: 5 } });
  expect(await reopened.load(group)).toMatchObject({ basis: null, base: { kind: 'version', version: 5 } });
  args.assertOwner.mockRejectedValueOnce(Error('Cheapo access changed.'));
  await expect(reopened.save({ groupId: group, basis: 'kg', base: { kind: 'version', version: 4 }, sync: 'cached' }, null)).rejects.toThrow('access changed');
  expect(entries).toHaveLength(1);
});

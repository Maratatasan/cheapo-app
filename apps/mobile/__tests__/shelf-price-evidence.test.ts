import type { Product } from '@cheapo/domain';
import { classifyShelfPrice, sameShelfPrice, type PreviousShelfPrice, type PriceEvidenceSnapshot } from '../data/shelf-price-evidence';

const product: Product = {
  id: 'example-oats', name: 'Whole Rolled Oats', brand: 'Sample Mill', variety: 'Whole Rolled',
  pack: { quantity: 500, unit: 'g' },
};
const previous: PreviousShelfPrice = {
  productId: product.id, shopId: 'example-shop', amount: '2.50', currency: 'GBP',
  packSize: '500g', basis: 'pack', offer: 'ordinary',
};

type Line = PriceEvidenceSnapshot['blocks'][number]['lines'][number];
const label = ['Sample Mill', 'Whole Rolled Oats', '500 g'];
function view(text: readonly (string | Line)[], source: PriceEvidenceSnapshot['source'] = 'original'): PriceEvidenceSnapshot {
  return { source, blocks: text.map((line, index) => ({
    lines: [typeof line === 'string'
      ? { text: line, box: [0.35, 0.3 + 0.025 * index, 0.62, 0.32 + 0.025 * index] }
      : line],
  })) };
}

test.each([
  ['£2.50', 250], ['£2', 200], ['250p', 250], ['50 p each', 50], ['GBP 2.5', 250], ['Now £2.50', 250],
])('extracts the independently marked current amount %s', (text, minor) => {
  const snapshots = [view([...label, text])];
  expect(classifyShelfPrice(product, snapshots)).toMatchObject({ kind: 'clear', snapshots,
    selling: { productId: product.id, currency: 'GBP', minor, offer: 'ordinary' },
    support: expect.arrayContaining([expect.objectContaining({ text, source: 'original', box: expect.any(Array) })]),
  });
});

test('bare decimal needs nearby GBP and a stated selling role', () => {
  expect(classifyShelfPrice(product, [view([...label, '2.50'])])).toMatchObject({ kind: 'uncertain', issue: 'price-role' });
  expect(classifyShelfPrice(product, [view([...label, 'Selling price', '2.50'])])).toMatchObject({ kind: 'uncertain', issue: 'price-role' });
  expect(classifyShelfPrice(product, [view([...label, 'Selling price', '2.50', 'GBP'])]))
    .toMatchObject({ kind: 'clear', selling: { minor: 250 } });
  expect(classifyShelfPrice(product, [view([...label, 'Selling price', '2.50', '$4.75'])]))
    .toMatchObject({ kind: 'uncertain', issue: 'foreign-currency' });
});

test('does not infer a labelled price from barcode, weight or damaged currency glyphs', () => {
  expect(classifyShelfPrice(product, [view([...label, 'Barcode 00012345678905'])])).toMatchObject({ kind: 'no-price' });
  expect(classifyShelfPrice(product, [view([...label, 'S2.50'])])).toMatchObject({ kind: 'no-price' });
  expect(classifyShelfPrice(product, [view([])])).toMatchObject({ kind: 'uncertain', issue: 'unreadable' });
});

test.each([
  ['unit rate', ['£2.50 / 100 g']], ['RRP', ['RRP £2.50']], ['saving', ['Save £2.50']],
  ['previous selling amount', ['Was £2.50']], ['detached reference', ['Was', '£2.50']],
  ['detached unit rate', ['Per 100 g', '£2.50']],
  ['detached unit rate with a currency heading', ['Unit price GBP', '£2.50']],
])('does not confirm when old amount is printed only as %s', (_label, priceLines) => {
  const evidence = classifyShelfPrice(product, [view([...label, ...priceLines])]);
  expect(evidence).toMatchObject({ kind: 'uncertain', issue: 'price-role' });
  expect(sameShelfPrice(evidence, 'example-shop', previous)).toEqual({ kind: 'review', reason: 'evidence' });
});

test('old price cannot select a matching reference amount instead of the current pack price', () => {
  const evidence = classifyShelfPrice(product, [view([...label, '£3.10', 'RRP £2.50', 'Save £2.50', '£2.50 / 100 g'])]);
  expect(evidence).toMatchObject({ kind: 'clear', selling: { minor: 310 } });
  expect(sameShelfPrice(evidence, 'example-shop', previous)).toEqual({ kind: 'review', reason: 'changed-price' });
  expect(sameShelfPrice(evidence, 'example-shop', { ...previous, amount: '3.10' })).toMatchObject({ kind: 'confirm-same-price' });
});

test.each(['Members only', 'Clubcard price', '2 for £5', 'Buy 1 get 1', 'Reduced', 'With app'])(
  'keeps %s out of ordinary same-price confirmation', terms => {
    expect(classifyShelfPrice(product, [view([...label, '£2.50', terms])])).toMatchObject({
      kind: 'uncertain', issue: 'conditional-offer',
    });
  },
);

test('rejects an adjacent price, wrong variant, conflicting pack and two unassigned amounts', () => {
  const farPrice: Line = { text: '£2.50', box: [0.8, 0.35, 0.95, 0.4] };
  expect(classifyShelfPrice(product, [view([...label, farPrice])])).toMatchObject({
    kind: 'uncertain', issue: 'product-unconfirmed',
  });
  expect(classifyShelfPrice(product, [view(['Sample Mill', 'Whole Rolled Oats Dark Roast', '500 g', '£2.50'])]))
    .toMatchObject({ kind: 'uncertain', issue: 'product-unconfirmed' });
  expect(classifyShelfPrice(product, [view(['Another Mill', 'Whole Rolled Oats', '500 g', '£2.50'])]))
    .toMatchObject({ kind: 'uncertain', issue: 'product-unconfirmed' });
  expect(classifyShelfPrice(product, [view([...label, '1 kg', '£2.50'])])).toMatchObject({ kind: 'uncertain', issue: 'pack-conflict' });
  expect(classifyShelfPrice(product, [view([...label, '£2.50', '£1.75'])])).toMatchObject({ kind: 'uncertain', issue: 'multiple-prices' });
});

test('lets a readable crop recover a blurred original and preserves evidence from both', () => {
  const snapshots = [view([]), view([...label, '£2.50'], 'crop')];
  expect(classifyShelfPrice(product, snapshots)).toMatchObject({ kind: 'clear', snapshots,
    selling: { minor: 250 }, support: expect.arrayContaining([expect.objectContaining({ source: 'crop', text: '£2.50' })]),
  });
  expect(classifyShelfPrice(product, [view([...label, '£2.75']), snapshots[1]]))
    .toMatchObject({ kind: 'uncertain', issue: 'multiple-prices' });
  expect(classifyShelfPrice(product, [view(['Clubcard price']), snapshots[1]]))
    .toMatchObject({ kind: 'uncertain', issue: 'conditional-offer' });
  expect(classifyShelfPrice(product, [view([...label, '£2.50']), view(['£2.50'], 'crop')]))
    .toMatchObject({ kind: 'clear', selling: { minor: 250 } });
});

test('compares the recorded pack, currency, shop, and conditions after extraction', () => {
  const evidence = classifyShelfPrice(product, [view([...label, '£2.50'])]);
  for (const override of [{ amount: '2.5000' }, { packSize: '0.5 kg' }]) {
    expect(sameShelfPrice(evidence, 'example-shop', { ...previous, ...override })).toMatchObject({ kind: 'confirm-same-price' });
  }
  for (const override of [
    { amount: '2.501' }, { currency: 'USD' }, { packSize: '2 × 250g' }, { packSize: undefined },
    { basis: 'unit' as const }, { basis: 'unknown' as const }, { offer: 'conditional' as const }, { offer: 'unknown' as const },
  ]) {
    expect(sameShelfPrice(evidence, 'example-shop', { ...previous, ...override })).toEqual({
      kind: 'review', reason: 'incompatible-history',
    });
  }
  for (const override of [{ productId: 'another-product' }, { recordedInError: true }, { shopId: 'different-shop' }]) {
    expect(sameShelfPrice(evidence, 'example-shop', { ...previous, ...override })).toEqual({
      kind: 'review', reason: 'no-exact-history',
    });
  }
  expect(sameShelfPrice(evidence, 'example-shop')).toEqual({ kind: 'review', reason: 'no-exact-history' });
  expect(sameShelfPrice(evidence, undefined, previous)).toEqual({ kind: 'review', reason: 'shop-required' });
});

test('compares multipack count and unit without using a comparison display preference', () => {
  const multipack = { ...product, pack: { label: '2×250g', quantity: 500, unit: 'g' } };
  const evidence = classifyShelfPrice(multipack, [view(['Sample Mill', 'Whole Rolled Oats', '2 × 250 g', '£2.50'])]);
  expect(evidence).toMatchObject({ kind: 'clear', selling: { pack: { count: 2, quantity: 250, unit: 'g' } } });
  expect(sameShelfPrice(evidence, 'example-shop', previous)).toEqual({ kind: 'review', reason: 'incompatible-history' });
  expect(sameShelfPrice(evidence, 'example-shop', { ...previous, packSize: '2 x 0.25 kg' }))
    .toMatchObject({ kind: 'confirm-same-price' });
});

test('reports false proposals and eligible fallbacks separately on controlled examples', () => {
  const controls = [
    { text: [...label, '£2.50'], eligible: true },
    { text: [...label, '250p'], eligible: true },
    { text: [...label, '2.50'], eligible: true }, // Same on the source label. OCR lost the role and currency.
    { text: ['W h o', '50g'], eligible: true }, // Same on the source label, but this OCR view is unreadable.
    { text: [...label, '£2.50 / 100g'], eligible: false },
    { text: [...label, '£3.12', 'Was £2.50'], eligible: false },
    { text: [...label, '£2.50', 'Members only'], eligible: false },
    { text: [...label, '£2.50'], eligible: false, shopId: 'other-shop' },
  ];
  const outcome = { correctProposals: 0, falseProposals: 0, eligibleFallbacks: 0, correctFallbacks: 0 };
  for (const { text, eligible, shopId } of controls) {
    const proposed = sameShelfPrice(classifyShelfPrice(product, [view(text)]), shopId ?? 'example-shop', previous)
      .kind === 'confirm-same-price';
    if (proposed) outcome[eligible ? 'correctProposals' : 'falseProposals']++;
    else outcome[eligible ? 'eligibleFallbacks' : 'correctFallbacks']++;
  }
  expect(outcome).toEqual({ correctProposals: 2, falseProposals: 0, eligibleFallbacks: 2, correctFallbacks: 4 });
});

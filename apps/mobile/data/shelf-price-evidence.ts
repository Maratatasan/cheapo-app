import type { Product } from '@cheapo/domain';
import { reviewedPackParts } from '@cheapo/domain/package-measures';

type Box = readonly [left: number, top: number, right: number, bottom: number];
type TextLine = { text: string; box?: Box };
export type PriceEvidenceSnapshot = {
  source: 'original' | 'crop';
  blocks: readonly { lines: readonly TextLine[] }[];
};
type KnownProduct = Pick<Product, 'id' | 'name' | 'brand' | 'variety' | 'pack'>;
type PackBasis = { count: number; quantity: number; unit: 'g' | 'ml' | 'item' | 'wash' };
type SellingAmount = {
  productId: string;
  minor: number;
  currency: 'GBP';
  pack: PackBasis;
  offer: 'ordinary';
};
type EvidenceIssue = 'unreadable' | 'price-role' | 'foreign-currency' | 'conditional-offer' | 'multiple-prices'
  | 'product-unconfirmed' | 'pack-unconfirmed' | 'pack-conflict';
type EvidenceLine = TextLine & { source: PriceEvidenceSnapshot['source']; block: number };

export type ShelfPriceEvidence = { snapshots: readonly PriceEvidenceSnapshot[] } & (
  | { kind: 'clear'; selling: SellingAmount; support: readonly EvidenceLine[] }
  | { kind: 'uncertain'; issue: EvidenceIssue }
  | { kind: 'no-price' }
);

const sellingPrice = /^(?:(?:now|(?:selling\s+|shelf\s+)?price)\s*:?\s*)?(?:(?:£\s*|GBP\s+)(\d{1,7}(?:\.\d{1,2})?)|(\d{1,9})\s*p|(\d{1,7}(?:\.\d{1,2})?)\s+GBP)(?:\s+each)?$/i;
const decimal = /^(?:(?:now|(?:selling\s+|shelf\s+)?price)\s*:?\s*)?(\d{1,7}\.\d{2})(?:\s+each)?$/i;
const amountCue = /(?:£\s*\d|\b\d+\s*p\b|\bGBP\b|\b(?:price|rrp|save|was)\b)/i;
const currencyEvidence = /£\s*\d|\bGBP\b|\b\d+\s*p\b/i;
const foreignCurrency = /[€$]\s*\d|\b(?:EUR|USD|CAD|AUD|CHF)\b/i;
const reference = /\b(?:rrp|was|save|saving|worth|from)\b/i;
const unitRate = /\b(?:unit\s*(?:price|rate)|per\s*(?:\d+(?:\.\d+)?\s*)?(?:kg|g|ml|l|litres?|items?|washes?))\b|\/\s*(?:\d+(?:\.\d+)?\s*)?(?:kg|g|ml|l|litres?|items?|washes?)\b/i;
const offer = /\b(?:clubcard|nectar|loyalty|members?|card\s*price|app\s*price|club\s*price|reduced|clearance|multibuy|offers?|vouchers?|coupons?|half\s+price|mix\s*&\s*match|limits?\s*\d+|with\s+(?:card|app)|buy\s*\d+|\d+\s*for\s*£?\s*\d+)\b/i;
const packToken = /\b(?:\d+\s*[x×]\s*)?\d+(?:\.\d+)?\s*(?:kg|g|mL|L|items?|washes?)\b/gi;
const namedPrice = /\b(?:selling\s+price|shelf\s+price|price|now)\b/i;

function pence(pounds: string | null) {
  const match = pounds?.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return;
  const value = 100 * Number(match[1]) + Number((match[2] ?? '').padEnd(2, '0'));
  return value > 0 ? value : undefined;
}

function explicitMinor(text: string) {
  const match = sellingPrice.exec(text);
  if (!match) return;
  if (!match[2]) return pence(match[1] ?? match[3]);
  const amount = Number(match[2]);
  return amount > 0 && amount <= 999_999_999 ? amount : undefined;
}

function normalizePack(label: string): PackBasis | undefined {
  const parsed = reviewedPackParts(label);
  const quantity = Number(parsed?.quantity);
  if (!parsed || !Number.isFinite(quantity) || quantity <= 0) return;
  switch (parsed.unit.toLowerCase()) {
    case 'kg': return { count: parsed.count, quantity: quantity * 1000, unit: 'g' };
    case 'g': return { count: parsed.count, quantity, unit: 'g' };
    case 'l': return { count: parsed.count, quantity: quantity * 1000, unit: 'ml' };
    case 'ml': return { count: parsed.count, quantity, unit: 'ml' };
    case 'item':
    case 'items': return { count: parsed.count, quantity, unit: 'item' };
    case 'wash':
    case 'washes': return { count: parsed.count, quantity, unit: 'wash' };
  }
}

function compatible(a: PackBasis, b: PackBasis) {
  return a.unit === b.unit && a.count === b.count
    && Math.abs(a.quantity - b.quantity) <= Number.EPSILON * 4 * Math.max(a.quantity, b.quantity);
}

function closeTo(price: EvidenceLine, candidate: EvidenceLine) {
  if (candidate === price) return true;
  const a = price.box;
  const b = candidate.box;
  if (!a || !b) return false;
  // Vertical distance uses line centres. The horizontal gap keeps a neighboring
  // label from borrowing a heading just because both amounts sit on one shelf.
  return Math.abs((a[1] + a[3] - b[1] - b[3]) / 2) <= 0.18
    && Math.max(b[0] - a[2], a[0] - b[2]) <= 0.075;
}

function words(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(packToken, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function containsPhrase(text: string, phrase: string) {
  return !!phrase && ` ${text} `.includes(` ${phrase} `);
}

function matchesIdentity(lines: readonly EvidenceLine[], product: KnownProduct) {
  const name = words(product.name);
  const brand = words(product.brand ?? '');
  const variety = words(product.variety ?? '');
  const knownWords = new Set([name, brand, variety].filter(Boolean).join(' ').split(' '));
  const text = lines.map(line => words(line.text));
  // A lone common name fragment must not match a different named variant.
  const nameLines = text.filter(line => containsPhrase(line, name));
  return nameLines.length > 0 && nameLines.every(line => line.split(' ').every(word => knownWords.has(word)))
    && (!brand || text.some(line => containsPhrase(line, brand)))
    && (!variety || text.some(line => containsPhrase(line, variety)));
}

type Assessment = { issue?: EvidenceIssue; minor?: number; pack?: PackBasis; support?: readonly EvidenceLine[] };

function assess(snapshot: PriceEvidenceSnapshot, product: KnownProduct | undefined): Assessment {
  const lines = snapshot.blocks.flatMap((block, index) => block.lines.flatMap(line => {
    const text = line.text.normalize('NFKC').trim();
    return text ? [{ ...line, text, block: index, source: snapshot.source }] : [];
  }));
  if (!lines.length) return { issue: 'unreadable' };

  const roleLines = lines.filter(line => !reference.test(line.text) && !unitRate.test(line.text));
  const candidates = roleLines.flatMap(line => {
    const contextual = lines.filter(other => closeTo(line, other) || (!other.box && other.block === line.block));
    const explicit = explicitMinor(line.text);
    const bare = decimal.exec(line.text);
    const marked = bare && contextual.some(other => !reference.test(other.text) && !unitRate.test(other.text) && namedPrice.test(other.text))
      && contextual.some(other => currencyEvidence.test(other.text));
    const minor = explicit ?? (marked ? pence(bare[1]) : undefined);
    return minor === undefined ? [] : [{ minor, line, contextual }];
  });
  if (candidates.length > 1) return { issue: 'multiple-prices' };
  const current = candidates[0];
  if (!current) {
    if (lines.some(line => foreignCurrency.test(line.text))) return { issue: 'foreign-currency' };
    if (lines.some(line => offer.test(line.text))) return { issue: 'conditional-offer' };
    return lines.some(line => amountCue.test(line.text) || decimal.test(line.text) || unitRate.test(line.text))
      ? { issue: 'price-role' } : {};
  }

  const { minor, line, contextual } = current;
  if (contextual.some(other => foreignCurrency.test(other.text))) return { issue: 'foreign-currency', minor };
  if (contextual.some(other => offer.test(other.text))) return { issue: 'conditional-offer', minor };
  // OCR can put a role caption and its amount on different lines.
  if (contextual.some(other => !currencyEvidence.test(other.text) && (reference.test(other.text) || unitRate.test(other.text)))) {
    return { issue: 'price-role', minor };
  }
  const associated = roleLines.filter(other => closeTo(line, other));
  const pack = product?.pack;
  const expected = pack && (normalizePack(pack.label ?? '') ?? normalizePack(`${pack.quantity} ${pack.unit}`));
  const packs = associated.flatMap(other => (other.text.match(packToken) ?? []).flatMap(label => normalizePack(label) ?? []));
  if (expected && packs.some(value => !compatible(expected, value))) return { issue: 'pack-conflict', minor };
  if (!product || !matchesIdentity(associated, product)) return { issue: 'product-unconfirmed', minor };
  if (!expected || !packs.length) return { issue: 'pack-unconfirmed', minor };
  return { minor, pack: expected, support: associated };
}

/** Interpret current label evidence before any historical amount is available. */
export function classifyShelfPrice(product: KnownProduct | undefined, snapshots: readonly PriceEvidenceSnapshot[]): ShelfPriceEvidence {
  const views = snapshots.map(snapshot => assess(snapshot, product));
  const hardConflict = views.find(view => view.issue === 'multiple-prices' || view.issue === 'pack-conflict'
    || view.issue === 'foreign-currency' || view.issue === 'conditional-offer' || (view.issue === 'price-role' && view.minor !== undefined));
  if (hardConflict?.issue) return { kind: 'uncertain', issue: hardConflict.issue, snapshots };
  const current = views.find(view => view.support);
  if (product && current?.minor !== undefined && current.pack && current.support) {
    if (views.some(view => view.minor !== undefined && view.minor !== current.minor)) {
      return { kind: 'uncertain', issue: 'multiple-prices', snapshots };
    }
    return { kind: 'clear', selling: { productId: product.id, minor: current.minor, currency: 'GBP', pack: current.pack, offer: 'ordinary' },
      support: current.support, snapshots };
  }
  const issue = views.find(view => view.issue && view.issue !== 'unreadable')?.issue ?? views.find(view => view.issue)?.issue;
  if (issue || snapshots.length === 0) return { kind: 'uncertain', issue: issue ?? 'unreadable', snapshots };
  return { kind: 'no-price', snapshots };
}

export type PreviousShelfPrice = {
  productId: string | null;
  shopId: string | null;
  amount: string | null;
  currency: string | null;
  packSize?: string | null;
  basis: 'pack' | 'unit' | 'unknown';
  offer: 'ordinary' | 'conditional' | 'unknown';
  recordedInError?: boolean;
};

export function sameShelfPrice(evidence: ShelfPriceEvidence, shopId: string | undefined, previous?: PreviousShelfPrice) {
  if (evidence.kind !== 'clear') return { kind: 'review', reason: 'evidence' } as const;
  const { selling } = evidence;
  if (!shopId) return { kind: 'review', reason: 'shop-required' } as const;
  if (!previous || previous.recordedInError || previous.productId !== selling.productId || previous.shopId !== shopId) {
    return { kind: 'review', reason: 'no-exact-history' } as const;
  }
  const pack = normalizePack(previous.packSize ?? '');
  // Numeric database values can retain additional zeroes beyond pence.
  const pastMinor = pence(previous.amount?.replace(/(\.\d{2})0+$/, '$1') ?? null);
  if (previous.currency !== selling.currency || previous.basis !== 'pack' || previous.offer !== selling.offer
    || !pack || !compatible(selling.pack, pack) || pastMinor === undefined) {
    return { kind: 'review', reason: 'incompatible-history' } as const;
  }
  if (pastMinor !== selling.minor) return { kind: 'review', reason: 'changed-price' } as const;
  return { kind: 'confirm-same-price', selling, shopId } as const;
}

import { reviewedPackParts } from '@cheapo/domain/package-measures';

import { catalogCandidateLimit, packFromLabel, type CatalogCandidate, type CandidateSearch,
  type ExecuteCatalogCandidates } from './catalog-candidates.ts';
import { productColumns, productFromRow, type ProductRow } from './postgres-catalog.ts';
import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';

const sourceLimit = 50;
const observationName = "coalesce(nullif(btrim(review->>'productName'), ''), source_product_name)";

// Operands are fixed SQL expressions. Search text is always a bound parameter.
function identityKey(expression: string) {
  return `nullif(btrim(regexp_replace(lower(${expression}), '[[:space:][:punct:]]+', ' ', 'g')), '')`;
}

function containsPhrase(full: string, phrase: string) {
  return `strpos(' ' || ${full} || ' ', ' ' || ${phrase} || ' ') > 0`;
}

function includeBrand(name: string, brand: string) {
  return `CASE WHEN ${brand} IS NULL OR ${containsPhrase(name, brand)} THEN ${name}
    ELSE ${brand} || ' ' || ${name} END`;
}

function modestExtension(full: string, phrase: string) {
  const wordCount = (key: string) => `cardinality(string_to_array(${key}, ' '))`;
  const corroboratedBrand = `(stored_brand = wanted_brand OR ${containsPhrase('wanted_name', 'stored_brand')}
    OR ${containsPhrase('stored_name', 'wanted_brand')})`;
  return `${containsPhrase(full, phrase)}
    AND (${wordCount(phrase)} >= 3 OR (${wordCount(phrase)} = 2 AND ${corroboratedBrand}))
    AND ${wordCount(full)} - ${wordCount(phrase)} <= 3`;
}

function identityMatches(name: string, brand: string, variety: string) {
  return `
    CROSS JOIN LATERAL (SELECT ${identityKey('$1::text')} AS wanted_name, ${identityKey('$2::text')} AS wanted_brand,
      ${identityKey('$3::text')} AS wanted_variety) AS wanted
    CROSS JOIN LATERAL (SELECT ${identityKey(name)} AS stored_name, ${identityKey(brand)} AS stored_brand,
      ${identityKey(variety)} AS stored_variety) AS stored
    CROSS JOIN LATERAL (SELECT ${includeBrand('wanted_name', 'wanted_brand')} AS wanted_phrase,
      ${includeBrand('stored_name', 'stored_brand')} AS stored_phrase) AS phrases
    CROSS JOIN LATERAL (SELECT CASE
      WHEN stored_name = wanted_name THEN 0
      WHEN stored_phrase = wanted_phrase THEN 1
      WHEN (${modestExtension('wanted_phrase', 'stored_phrase')})
        OR (${modestExtension('stored_phrase', 'wanted_phrase')}) THEN 2
      END AS name_rank) AS matches
  `;
}

const compatibleIdentity = `name_rank IS NOT NULL
  AND (wanted_brand IS NULL OR stored_brand IS NULL OR stored_brand = wanted_brand)
  AND (wanted_variety IS NULL OR stored_variety IS NULL OR stored_variety = wanted_variety)`;

const units: Record<string, readonly [string, number]> = {
  g: ['mass', 1], kg: ['mass', 1000], ml: ['volume', 1], l: ['volume', 1000],
  litre: ['volume', 1000], litres: ['volume', 1000], liter: ['volume', 1000], liters: ['volume', 1000],
  item: ['count', 1], items: ['count', 1], each: ['count', 1],
};
function packMeasure(pack: NonNullable<CandidateSearch['pack']>) {
  const unit = pack.unit.toLowerCase();
  const [dimension, multiplier] = Object.hasOwn(units, unit) ? units[unit] : [unit, 1];
  const count = pack.label ? reviewedPackParts(pack.label)?.count : undefined;
  return { dimension, quantity: pack.quantity * multiplier, count };
}

function packCompatible(request?: CandidateSearch['pack'], candidate?: CandidateSearch['pack']) {
  if (!request || !candidate) return true;
  const a = packMeasure(request), b = packMeasure(candidate);
  return a.dimension === b.dimension && Number.isFinite(a.quantity) && Number.isFinite(b.quantity)
    && Math.abs(a.quantity - b.quantity) <= Number.EPSILON * 4 * Math.max(a.quantity, b.quantity)
    && (a.count === undefined || b.count === undefined || a.count === b.count);
}

type ObservationRow = {
  id: string;
  name: string;
  brand: string | null;
  variety: string | null;
  productType: string | null;
  packSize: string | null;
};

export function postgresCatalogCandidates(transaction: ShoppingTransaction): ExecuteCatalogCandidates {
  return (digest, search) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    const identity = [search.name, search.brand ?? null, search.variety ?? null];
    const { rows: products } = await query<Omit<ProductRow, 'record_version'>>(`
      SELECT ${productColumns} FROM cheapo.product
      ${identityMatches('name', 'brand', 'variety')}
      WHERE ${compatibleIdentity}
      ORDER BY name_rank, (wanted_brand IS NOT NULL AND stored_brand IS NOT NULL) DESC,
        (wanted_variety IS NOT NULL AND stored_variety IS NOT NULL) DESC, id COLLATE "C"
      LIMIT ($4::int + 1)
    `, [...identity, sourceLimit]);
    const { rows: observations } = await query<ObservationRow>(`
      SELECT resource_id::text AS id, ${observationName} AS name,
        nullif(btrim(review->>'brand'), '') AS brand, nullif(btrim(review->>'variety'), '') AS variety,
        nullif(btrim(review->>'productType'), '') AS "productType", nullif(btrim(review->>'packSize'), '') AS "packSize"
      FROM cheapo.price_observation
      ${identityMatches(observationName, "review->>'brand'", "review->>'variety'")}
      WHERE household_id = $5::uuid AND product_id IS NULL AND status = 'complete'
        AND source_test_shop IS NOT TRUE AND recorded_in_error_reason IS NULL
        AND ${compatibleIdentity}
      ORDER BY name_rank, captured_at DESC, resource_id DESC
      LIMIT ($4::int + 1)
    `, [...identity, sourceLimit, member.household_id]);

    const candidates: CatalogCandidate[] = [];
    for (const row of products.slice(0, sourceLimit)) {
      const product = productFromRow(row);
      if (packCompatible(search.pack, product.pack)) candidates.push({ kind: 'catalog', product });
    }
    for (const row of observations.slice(0, sourceLimit)) {
      const pack = row.packSize ? packFromLabel(row.packSize) : undefined;
      if (packCompatible(search.pack, pack)) candidates.push({
        kind: 'unlinked_observation', observationId: row.id,
        details: { name: row.name, brand: row.brand ?? undefined, variety: row.variety ?? undefined,
          productType: row.productType ?? undefined, pack, packSize: row.packSize ?? undefined },
      });
    }
    return {
      status: 'ok', candidates: candidates.slice(0, catalogCandidateLimit),
      truncated: candidates.length > catalogCandidateLimit || products.length > sourceLimit || observations.length > sourceLimit,
    };
  });
}

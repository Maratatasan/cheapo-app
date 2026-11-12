import type { Shop } from "@cheapo/domain";

function normalizeSearchText(text: string) {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[.,/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(query: string, candidate: string, limit: number) {
  if (Math.abs(query.length - candidate.length) > limit) return Infinity;

  let previous = Array.from({ length: candidate.length + 1 }, (_, index) => index);
  let beforePrevious: number[] = [];

  for (let row = 1; row <= query.length; row++) {
    const current = [row];
    for (let column = 1; column <= candidate.length; column++) {
      const sameLetter = query[row - 1] === candidate[column - 1];
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (sameLetter ? 0 : 1),
      );
      if (
        row > 1 && column > 1 &&
        query[row - 1] === candidate[column - 2] &&
        query[row - 2] === candidate[column - 1]
      ) {
        current[column] = Math.min(current[column], beforePrevious[column - 2] + 1);
      }
    }
    beforePrevious = previous;
    previous = current;
  }

  return previous[candidate.length];
}

function matchRank(query: string, value: string | undefined) {
  if (!value) return Infinity;

  const name = normalizeSearchText(value);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (query.length < 4) return Infinity;

  const limit = query.length < 7 ? 1 : 2;
  const candidates = query.includes(" ") ? [name] : name.split(" ");
  const distance = Math.min(...candidates.map((word) => editDistance(query, word, limit)));
  return distance <= limit ? 3 + distance : Infinity;
}

export function matchShops(shops: readonly Shop[], search: string): readonly Shop[] {
  const query = normalizeSearchText(search);
  if (!query) return shops;

  return shops
    .map((shop, index) => ({
      shop,
      index,
      rank: Math.min(matchRank(query, shop.nickname), matchRank(query, shop.name)),
    }))
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((first, second) => first.rank - second.rank || first.index - second.index)
    .map(({ shop }) => shop);
}

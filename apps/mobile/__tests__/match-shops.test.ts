import { matchShops } from "@/data/match-shops";

test("suggests a saved shop from partial and mistyped names", () => {
  const morden = { id: "morden", nickname: "Morden Lidl", name: "Lidl" };
  const sainsburys = { id: "sainsburys", name: "Sainsbury’s" };
  const shops = [morden, sainsburys];

  expect(matchShops(shops, "morde")).toEqual([morden]);
  expect(matchShops(shops, "synsbury")).toEqual([sainsburys]);
  expect(matchShops(shops, "  LIDL ")).toEqual([morden]);
  expect(matchShops(shops, "butcher")).toEqual([]);
});

test("ranks exact, prefix, partial, and typo matches while preserving saved order for ties", () => {
  const shops = [
    { id: "typo", name: "Mroden" },
    { id: "partial", name: "Central Morden" },
    { id: "prefix1", nickname: "Morden Lidl" },
    { id: "exact", name: "Morden" },
    { id: "prefix2", name: "Morden Market" },
  ];

  expect(matchShops(shops, "morden").map(({ id }) => id)).toEqual([
    "exact", "prefix1", "prefix2", "partial", "typo",
  ]);
  expect(matchShops(shops, " ")).toEqual(shops);
  expect(matchShops(shops, "mor").map(({ id }) => id)).toEqual([
    "prefix1", "exact", "prefix2", "partial",
  ]);
});

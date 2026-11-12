export function normalizeName(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export function shopDisplayName(shop: { name?: string; nickname?: string }): string | undefined {
  return normalizeName(shop.nickname) ?? normalizeName(shop.name);
}

export function normalizeName(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

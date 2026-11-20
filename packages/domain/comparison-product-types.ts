import { normalizeName } from '@cheapo/domain/names';

const eggTypes = ['eggs', 'fresh eggs', 'free-range eggs', 'free range eggs'] as const;

/** These recorded labels share a comparison category. Product identity is unchanged. */
export function comparisonProductTypeAliases(type: string): readonly string[] {
  return eggTypes.some(alias => alias === type.trim().toLowerCase()) ? eggTypes : [type];
}

export function comparisonProductTypeKey(type: unknown): string | undefined {
  const normalized = normalizeName(type)?.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
  return normalized ? comparisonProductTypeAliases(normalized)[0] : undefined;
}

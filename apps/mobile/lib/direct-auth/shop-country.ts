export type PhotoShopCountry = { country: 'United Kingdom'; source: 'address country' | 'postcode pattern' };

const ukCountrySuffix = /(?:^|[,\s])(?:United Kingdom|UK|Great Britain|England|Scotland|Wales|Northern Ireland)$/i;
const ukPostcodeSuffix = /\b(?:GIR\s+0AA|[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2})$/i;

export function photoShopCountry(address?: string): PhotoShopCountry | undefined {
  const text = address?.trim();
  if (!text) return undefined;
  if (ukCountrySuffix.test(text)) return { country: 'United Kingdom', source: 'address country' };
  // A country or any other text after the postcode prevents postcode inference.
  const postcode = ukPostcodeSuffix.exec(text);
  if (postcode?.index && /[A-Z]/i.test(text.slice(0, postcode.index))) {
    return { country: 'United Kingdom', source: 'postcode pattern' };
  }
  return undefined;
}

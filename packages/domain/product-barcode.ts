export function canonicalProductBarcode(value: string): string | undefined {
  const digits = value.trim();
  if (!/^(?:\d{8}|\d{12,14})$/.test(digits) || /^0+$/.test(digits)) return undefined;
  const checksum = [...digits].reverse().reduce((sum, digit, index) =>
    sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return checksum % 10 === 0 ? digits.padStart(14, '0') : undefined;
}

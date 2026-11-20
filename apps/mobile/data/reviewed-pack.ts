export function reviewedPackParts(pack: string) {
  const match = /^(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(pack.trim());
  if (!match) return null;
  const count = Number(match[1] ?? 1);
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return { count, quantity: match[2], unit: match[3] };
}

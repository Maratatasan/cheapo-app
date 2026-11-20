export function localDay(date = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function validObservedDay(day: string, today = localDay()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '0001-01-01' || day > today) return false;
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(`${day}T`);
}

export function originalPhotoDate(dateTime: unknown, offset: unknown, subseconds: unknown, today = localDay()) {
  if (typeof dateTime !== 'string') return;
  const match = /^(\d{4}):(\d{2}):(\d{2}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)$/.exec(dateTime.trim());
  if (!match) return;
  const takenOn = `${match[1]}-${match[2]}-${match[3]}`;
  if (!validObservedDay(takenOn, today)) return;
  if (typeof offset !== 'string' || !/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(offset)) return { takenOn };
  const fractions = typeof subseconds === 'string' && /^\d+$/.test(subseconds) ? subseconds.slice(0, 3).padEnd(3, '0') : '000';
  return { takenOn, takenAt: new Date(`${takenOn}T${match[4]}.${fractions}${offset}`).toISOString() };
}

export function observedDay(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function suggestedObservedDay(takenOn: string | undefined, openedAt: string): string {
  return takenOn && validObservedDay(takenOn) ? takenOn : localDay(new Date(openedAt));
}

/** History reads the UTC day from the existing observation timestamp. */
export function timestampForObservedDay(day: string, baseline: string): string | undefined {
  if (!validObservedDay(day)) return;
  return day === observedDay(baseline) ? baseline : `${day}T12:00:00.000Z`;
}

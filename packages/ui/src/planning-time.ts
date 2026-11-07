/** Calendar spans use date-only UTC values, independent of DST and browser timezone. */
export function calendarDays(start: string, finish: string): number | null {
  const from = Date.parse(`${start}T12:00:00Z`), to = Date.parse(`${finish}T12:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}
export function courseDuration(start: string, finish: string): string | null {
  const difference = calendarDays(start, finish);
  if (difference === null || difference < 0) return null;
  const days = difference + 1;
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `About ${Math.ceil(days / 7)} weeks`;
  const months = Math.round(days / 30.4375 * 10) / 10;
  return `About ${months} months`;
}

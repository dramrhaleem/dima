/** Calendar-month goal shortcuts preserve the day where possible, clamping month ends. */
export function targetAfterMonths(start: string, months: number): string {
  const [year, month, day] = start.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}


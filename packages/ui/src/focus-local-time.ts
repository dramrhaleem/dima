/** datetime-local is interpreted in the browser timezone, which the form names. */
export function localTimeInput(timestamp: string): string {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

/** Reject silent calendar/DST normalization; never save a different wall time. */
export function parseLocalTime(value: string): Date | null {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  return localTimeInput(date.toISOString()) === normalized ? date : null;
}

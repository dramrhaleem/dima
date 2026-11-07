import { describe, expect, it } from 'vitest';
import { localTimeInput, parseLocalTime } from '../../packages/ui/src/focus-local-time';

describe('browser-local manual time parsing', () => {
  it('rejects a nonexistent spring-forward time instead of normalizing it', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(parseLocalTime('2026-03-08T02:30:00')).toBeNull();
      expect(parseLocalTime('2026-03-08T03:30:00')?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
      expect(parseLocalTime('2026-03-08T01:30')?.toISOString()).toBe('2026-03-08T06:30:00.000Z');
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it('rejects invalid calendar dates and preserves a valid local round trip', () => {
    expect(parseLocalTime('')).toBeNull();
    expect(parseLocalTime('2026-02-30T12:00:00')).toBeNull();
    const input = localTimeInput('2026-10-31T12:23:45.000Z');
    expect(parseLocalTime(input)?.toISOString()).toBe('2026-10-31T12:23:45.000Z');
  });
});

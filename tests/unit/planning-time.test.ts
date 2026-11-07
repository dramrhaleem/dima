import { describe, expect, it } from 'vitest';
import { calendarDays, courseDuration } from '../../packages/ui/src/planning-time';
describe('readable calendar forecast spans', () => {
  it('includes the first study day and does not turn short courses into a whole week', () => {
    expect(courseDuration('2026-11-02', '2026-11-02')).toBe('1 day');
    expect(courseDuration('2026-11-02', '2026-11-08')).toBe('7 days');
    expect(courseDuration('2026-11-02', '2026-11-22')).toBe('About 3 weeks');
  });
  it('shows approximate months while retaining an exact calendar difference', () => {
    expect(courseDuration('2026-11-02', '2027-02-01')).toBe('About 3 months');
    expect(calendarDays('2026-11-02', '2027-02-01')).toBe(91);
    expect(calendarDays('2026-03-07', '2026-03-09')).toBe(2);
  });
  it('does not invent a duration for invalid or reversed dates', () => {
    expect(courseDuration('', '2026-11-02')).toBeNull();
    expect(courseDuration('2026-11-03', '2026-11-02')).toBeNull();
  });
});

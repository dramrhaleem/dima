import { describe, expect, it } from 'vitest';
import { targetAfterMonths } from '../../packages/ui/src/planning-goals';

describe('calendar-month course goals', () => {
  it('clamps January 31 to February without spilling into March', () => {
    expect(targetAfterMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(targetAfterMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
  it('uses the chosen start for each shortcut and preserves valid day numbers', () => {
    expect(targetAfterMonths('2027-01-31', 2)).toBe('2027-03-31');
    expect(targetAfterMonths('2027-01-31', 3)).toBe('2027-04-30');
    expect(targetAfterMonths('2027-01-31', 6)).toBe('2027-07-31');
    expect(targetAfterMonths('2026-11-02', 3)).toBe('2027-02-02');
  });
  it('crosses year boundaries using calendar dates', () => {
    expect(targetAfterMonths('2026-12-31', 1)).toBe('2027-01-31');
    expect(targetAfterMonths('2028-08-31', 6)).toBe('2029-02-28');
  });
});

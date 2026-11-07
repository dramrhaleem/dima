import { describe, expect, it } from 'vitest';
import { onboardingEntry } from '../../packages/ui/src/onboarding-entry';

describe('first useful destination after onboarding', () => {
  it('takes generic entry straight to the chosen activity', () => {
    for (const next of ['/app', '/app/', '/app/today']) {
      expect(onboardingEntry(next, 'learning').href).toBe('/app/library');
      expect(onboardingEntry(next, 'work').href).toBe('/app/focus?category=work');
    }
  });
  it('preserves explicit course, friend and room destinations including query and fragment', () => {
    for (const next of ['/app/courses/add?offering=cs50-business', '/app/progress/members/friend-id', '/app/rooms/example?tab=about', '/app/courses/example#module-one']) {
      expect(onboardingEntry(next, 'learning').href).toBe(next);
      expect(onboardingEntry(next, 'work').href).toBe(next);
    }
  });
});

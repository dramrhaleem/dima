/** Receives a same-origin destination already validated by the account router. */
export function onboardingEntry(next: string, intent: 'learning' | 'work') {
  if (!['/app', '/app/', '/app/today'].includes(next)) {
    return { href: next, label: 'Continue to my space', detail: 'Continue to the page you opened. You can use both learning and work features anytime.' };
  }
  return intent === 'work'
    ? { href: '/app/focus?category=work', label: 'Set up my first session', detail: 'Next, choose your focus time. The timer starts only when you start the session.' }
    : { href: '/app/library', label: 'Choose my first course', detail: 'Next, choose a course and see how it fits your time before saving your study plan.' };
}

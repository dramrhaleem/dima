import { expect, it } from 'vitest';
import { followTarget } from '../../packages/ui/src/profile-link';
it('accepts profile links with query or fragment without treating either as the username', () => {
  expect(followTarget('https://dima.study/u/alex?source=share#profile')).toBe('alex');
  expect(followTarget('dima.study/u/alex')).toBe('alex');
  expect(followTarget('/app/progress/members/5a7b?tab=progress')).toBe('5a7b');
  expect(followTarget(' alex-learner ')).toBe('alex-learner');
});
it('rejects non-Dima destinations and links to unrelated Dima pages', () => {
  for (const input of ['https://example.com/u/alex', 'https://dima.study.example.com/u/alex', '//example.com/u/alex', 'https://dima.study/app/settings', '/u/alex/more', '']) expect(followTarget(input)).toBeNull();
});

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AccountData, LearningData, LearningCommand } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(150000);
async function signIn(context: BrowserContext, recipient: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const after = Date.now();
    const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email: recipient, next: '/app/today' } });
    if (sent.status() === 429 && attempt < 19) { await new Promise(resolve => setTimeout(resolve, 4000)); continue; }
    expect(sent.status()).toBe(200);
    const token = await waitForLocalOtp(recipient, { after });
    const result = await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email: recipient, token, next: '/app/today' } });
    expect(result.status()).toBe(200); return;
  }
}
async function profile(context: BrowserContext, appearance: 'light' | 'dark' = 'light') {
  const data = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  const result = await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': data.accountId }, data: { displayName: 'Riley Learner', timezone: 'Africa/Cairo', intent: 'learning', appearance, reducedMotion: true, onboarded: true, expectedRevision: data.profile?.revision ?? 0, operationId: randomUUID() } });
  expect(result.status()).toBe(200);
}
async function learning(context: BrowserContext) { const response = await context.request.get(`${base}/api/v1/learning`); expect(response.status()).toBe(200); return (await response.json()).data as LearningData; }
async function command(context: BrowserContext, data: LearningData, value: Omit<LearningCommand, 'expectedRevision' | 'operationId'> & Record<string, unknown>) {
  const response = await context.request.post(`${base}/api/v1/learning`, { headers: { ...origin, 'X-Dima-Account-Id': data.accountId }, data: { ...value, expectedRevision: data.state.revision, operationId: randomUUID() } });
  expect(response.status()).toBe(200); return (await response.json()).data as LearningData;
}
async function screenshot(page: Page, name: string, width: number, height = 920) {
  await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { window.scrollTo(0, 0); return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`).toBe(true);
  mkdirSync('.impeccable/review', { recursive: true });
  await page.screenshot({ path: `.impeccable/review/b2-${name}.png`, fullPage: true });
}
async function createPrivate(page: Page, title: string, tasks: Array<{ title: string; minutes: number }>) {
  await page.goto('/app/courses/new');
  await page.getByLabel('Course title', { exact: true }).fill(title);
  await page.getByLabel('Course source URL', { exact: true }).fill('https://example.com/learning');
  for (const [index, task] of tasks.entries()) {
    await page.getByRole('button', { name: 'Add activity to module 1', exact: true }).click();
    await page.getByLabel(`Activity ${index + 1} title`, { exact: true }).fill(task.title);
    await page.getByLabel('Effort (minutes)', { exact: true }).nth(index).fill(String(task.minutes));
  }
}

test('private course, explicit prior work, shared plan, real completion retry and second device', async ({ page, context, browser }) => {
  const recipient = `b2-journey-${randomUUID()}@example.test`;
  const browserErrors: string[] = []; page.on('pageerror', error => browserErrors.push(error.message));
  await signIn(context, recipient); await profile(context);
  await createPrivate(page, 'A practical learning path', [{ title: 'Recall the foundations', minutes: 10 }, { title: 'Explore a useful idea', minutes: 30 }, { title: 'Try it for yourself', minutes: 20 }, { title: 'Optional extra reading', minutes: 10 }]);
  await page.getByRole('combobox', { name: 'In this course', exact: true }).nth(3).selectOption('optional');
  let failedSave = false;
  await page.route('**/api/v1/learning', async route => {
    if (!failedSave && route.request().method() === 'POST' && route.request().postDataJSON().type === 'saveDraft') { failedSave = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE' } }) }); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save private draft', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'couldn’t save' })).toContainText('couldn’t save');
  await expect(page.getByLabel('Course title', { exact: true })).toHaveValue('A practical learning path');
  await page.getByRole('button', { name: 'Save private draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.unroute('**/api/v1/learning');
  await page.getByRole('link', { name: 'Personalize this course', exact: true }).click();
  await page.getByText('Already started? Add your progress or customize activities', { exact: true }).click();
  await page.getByRole('button', { name: /Getting started/ }).click();
  const bulkPrior = page.getByRole('checkbox', { name: /Mark selected activities as done before Dima/ });
  await bulkPrior.check();
  await expect(page.getByRole('checkbox', { name: 'Include Optional extra reading', exact: true })).not.toBeChecked();
  await expect(page.getByRole('region', { name: 'Course finish estimate' }).locator('dl > div').filter({ hasText: 'Already completed' }).locator('dd')).toHaveText('3');
  await expect(page.getByRole('checkbox', { name: 'Done before Dima', exact: true })).toHaveCount(3);
  for (const checkbox of await page.getByRole('checkbox', { name: 'Done before Dima', exact: true }).all()) await expect(checkbox).toBeChecked();
  await bulkPrior.uncheck();
  await expect(page.getByRole('region', { name: 'Course finish estimate' }).locator('dl > div').filter({ hasText: 'Already completed' }).locator('dd')).toHaveText('0');
  await expect(page.getByRole('checkbox', { name: 'Done before Dima', exact: true }).first()).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Done before Dima', exact: true }).first().check();
  await page.getByRole('searchbox', { name: 'Search the outline' }).fill('Explore');
  await page.getByRole('searchbox', { name: 'Search the outline' }).press('Enter');
  await expect(page).toHaveURL(/\/app\/courses\/add\?/);
  await page.getByRole('searchbox', { name: 'Search the outline' }).fill('nothing-matches-this-activity');
  await expect(page.getByText('No activities match that search.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search the outline' })).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Include Explore a useful idea', exact: true })).toBeChecked();
  await screenshot(page, 'scope-mobile', 375);
  await page.getByRole('button', { name: 'Add course & continue', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/plan\/setup\?week=/);
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await page.getByLabel(`${day} minutes`, { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Preview my plan', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/plan\/previews\//);
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '← Adjust my week', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/plan\/setup\?preview=/);
  await expect(page.getByLabel('Monday minutes', { exact: true })).toHaveValue('60');
  await page.getByRole('button', { name: 'Preview my plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  await screenshot(page, 'preview-desktop', 1280);
  await page.getByRole('button', { name: 'Save this plan', exact: true }).click();
  await expect(page.getByText('Explore a useful idea', { exact: true })).toBeVisible();
  let state = await learning(context);
  const first = state.state.enrollments[0];
  expect(first.taskIds).toHaveLength(3);
  expect(first.completions.filter(value => value.kind === 'prior' && value.completed)).toHaveLength(1);
  expect(first.completions.filter(value => value.kind === 'new' && value.completed)).toHaveLength(0);
  await page.goto('/app/plan');
  const scheduledActivity = page.locator('a.learning-schedule-open').filter({ hasText: 'Explore a useful idea' }).first();
  await scheduledActivity.click();
  await expect(page.getByRole('heading', { name: 'Explore a useful idea', exact: true })).toBeVisible();
  await page.goto('/app/today');
  await expect(page.getByText('Explore a useful idea', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Continue course', exact: true }).click();
  let lostResponse = false;
  const operationIds: string[] = [];
  await page.route('**/api/v1/learning', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().type === 'complete') {
      operationIds.push(route.request().postDataJSON().operationId);
      if (!lostResponse) { lostResponse = true; const saved = await route.fetch(); expect(saved.status()).toBe(200); await route.abort('failed'); return; }
    }
    await route.continue();
  });
  await page.locator('.learning-task-row').filter({hasText:'Explore a useful idea'}).getByRole('button', { name: 'Mark activity done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quick-completion').getByRole('alert')).toContainText('Couldn’t confirm');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.locator('.quick-completion').getByRole('status')).toHaveText('Completed');
  expect(operationIds).toHaveLength(2); expect(operationIds[0]).toBe(operationIds[1]);
  await screenshot(page, 'quick-completion-desktop', 1280);
  await screenshot(page, 'quick-completion-mobile', 390);
  await page.unroute('**/api/v1/learning');
  state = await learning(context);
  expect(state.state.enrollments[0].completions.filter(value => value.kind === 'new' && value.completed)).toHaveLength(1);
  await page.goto('/app/today');
  await expect(page.getByText('Try it for yourself', { exact: true })).toBeVisible();
  await screenshot(page, 'today-desktop', 1280);
  await screenshot(page, 'today-mobile', 375);
  // Legacy saved preferences must not reactivate dark mode.
  await profile(context, 'dark'); await page.emulateMedia({ colorScheme: 'dark' }); await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByText('Try it for yourself', { exact: true })).toBeVisible();
  await screenshot(page, 'today-light-desktop', 1280);
  await screenshot(page, 'today-light-mobile', 375);
  await screenshot(page, 'today-light-small', 320);
  const second = await browser.newContext({ baseURL: base });
  try { await signIn(second, recipient); const elsewhere = await learning(second); expect(elsewhere.state.enrollments[0].completions).toEqual(state.state.enrollments[0].completions); }
  finally { await second.close(); }
  await page.goto(`/app/courses/${first.id}`);
  const currentModule = page.getByRole('button', { name: /Getting started/ });
  if (await currentModule.getAttribute('aria-expanded') !== 'true') await currentModule.click();
  await screenshot(page, 'course-light-mobile', 375);
  await page.getByRole('button', { name: 'Review completion', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Undo completion', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  state = await learning(context);
  expect(state.state.enrollments[0].completions.filter(value => value.kind === 'new' && value.completed)).toHaveLength(0);
  expect(state.state.enrollments[0].completions.filter(value => value.kind === 'prior' && value.completed)).toHaveLength(1);
  expect(browserErrors).toEqual([]);
});

test('public catalog, private snapshot, two courses share capacity and stale apply is rejected', async ({ page, context }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Google Project Management', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a course', exact: true }).fill('CS50');
  await expect(page.getByRole('heading', { name: 'Google Project Management', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('searchbox', { name: 'Find a course', exact: true })).toHaveValue('CS50');
  await page.getByRole('searchbox', { name: 'Find a course', exact: true }).fill('');
  await screenshot(page, 'library-desktop', 1280);
  await screenshot(page, 'library-mobile', 375);
  await signIn(context, `b2-capacity-${randomUUID()}@example.test`); await profile(context);
  const task = (id: string, title: string) => ({ id, title, position: 0, kind: 'reading', minutes: 45, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.com/learning', prerequisiteIds: [] });
  let state = await learning(context);
  for (const [index, title] of ['First learning path', 'Second learning path'].entries()) {
    const id = `private-${randomUUID()}`; const activity = task(`task-${index}`, `Useful activity ${index + 1}`);
    state = await command(context, state, { type: 'saveDraft', draft: { id, title, sourceUrl: 'https://example.com/learning', courses: [{ id: `course-${index}`, title, position: 0, modules: [{ id: `module-${index}`, title: 'Getting started', position: 0, tasks: [activity] }] }] } });
    state = await command(context, state, { type: 'enroll', offeringId: id, taskIds: [activity.id], priorTaskIds: [], estimates: {}, targetDate: state.localDay });
  }
  await page.goto('/app/plan/setup');
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await page.getByLabel(`${day} minutes`, { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Preview my plan', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/plan\/previews\//);
  state = await learning(context); const preview = state.state.previews.at(-1)!;
  expect(preview.result.status).toBe('late');
  for (const day of preview.result.days) expect(day.used + day.reserve + (day.accepted ?? 0)).toBeLessThanOrEqual(day.ceiling);
  expect(new Set(preview.result.blocks.map(value => value.enrollmentId)).size).toBe(2);
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  const current = state.state.enrollments[0];
  await command(context, state, { type: 'complete', enrollmentId: current.id, taskId: current.taskIds[0], effortMinutes: 45 });
  const staleApply = await context.request.post(`${base}/api/v1/learning`, { headers: { ...origin, 'X-Dima-Account-Id': state.accountId }, data: { type: 'apply', previewId: preview.id, acknowledgeUnscheduled: false, expectedRevision: state.state.revision, operationId: randomUUID() } });
  expect(staleApply.status()).toBe(409);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Update this preview before choosing.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh this preview', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^(Save this plan|Save revised plan)$/ })).toHaveCount(0);
  const final = await learning(context); expect(final.state.plan).toBeNull(); expect(final.state.enrollments[0].completions[0].completed).toBe(true);
});

test('delayed private learning response cannot cross an account switch', async ({ page, context }) => {
  await signIn(context, `b2-owner-a-${randomUUID()}@example.test`); await profile(context);
  let a = await learning(context);
  const draftId = `private-${randomUUID()}`;
  a = await command(context, a, { type: 'saveDraft', draft: { id: draftId, title: 'Private course for account A', sourceUrl: 'https://example.com/a', courses: [{ id: 'a-course', title: 'Private course for account A', position: 0, modules: [{ id: 'a-module', title: 'Private module', position: 0, tasks: [{ id: 'a-task', title: 'Account A private activity', position: 0, kind: 'reading', minutes: 15, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.com/a', prerequisiteIds: [] }] }] }] } });
  await command(context, a, { type: 'enroll', offeringId: draftId, taskIds: ['a-task'], priorTaskIds: [], estimates: {}, targetDate: a.localDay });
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let captured!: () => void; const capturedResponse = new Promise<void>(resolve => { captured = resolve; });
  let intercepted = false;
  await page.route('**/api/v1/learning', async route => {
    if (!intercepted && route.request().method() === 'GET') { intercepted = true; const response = await route.fetch(); expect(response.status()).toBe(200); captured(); await held; await route.fulfill({ response }).catch(() => undefined); }
    else await route.continue();
  });
  await page.goto('/app/courses'); await capturedResponse;
  await signIn(context, `b2-owner-b-${randomUUID()}@example.test`); await profile(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'A little room for something new.', exact: true })).toBeVisible();
  release();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText('Private course for account A', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Account A private activity', { exact: true })).toHaveCount(0);
  const b = await learning(context); expect(b.accountId).not.toBe(a.accountId); expect(b.state.enrollments).toHaveLength(0); expect(b.state.drafts).toHaveLength(0);
});

test('reviewed CS50 public offering survives sign-in and keeps unknown assignments visible', async ({ page, context }) => {
  const recipient = `b2-cs50-${randomUUID()}@example.test`;
  await page.goto('/library/cs50-business');
  await expect(page.getByRole('heading', { name: 'CS50 Business', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Personalize this course', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Dima', exact: true })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(recipient);
  const after = Date.now();
  await page.getByRole('button', { name: 'Send email code', exact: true }).click();
  await expect(page.getByLabel('Email code', { exact: true })).toBeVisible();
  await page.getByLabel('Email code', { exact: true }).fill(await waitForLocalOtp(recipient, { after }));
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\?/);
  await page.getByLabel('What should we call you?', { exact: true }).fill('CS50 Learner');
  await page.getByLabel('Your time zone', { exact: true }).fill('Africa/Cairo');
  await page.getByRole('button', { name: 'Continue to my space', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/courses/add?offering=cs50-business`);
  await expect(page.getByRole('heading', { name: 'Make CS50 Business fit your life.', exact: true })).toBeVisible();
  await expect(page.getByText('9 activities need a time estimate.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Add course & continue', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/plan\/setup\?week=/);
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await page.getByLabel(`${day} minutes`, { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Preview my plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  const data = await learning(context); const enrollment = data.state.enrollments[0]; const preview = data.state.previews.at(-1)!;
  expect(enrollment.offeringId).toBe('cs50-business'); expect(enrollment.taskIds).toHaveLength(18); expect(enrollment.priorTaskIds).toHaveLength(0);
  expect(preview.result.status).toBe('provisional'); expect(preview.result.missingTasks).toBe(9);
  expect(preview.result.unscheduled).toHaveLength(9);
  const selected = enrollment.snapshot.courses.flatMap(course => course.modules.flatMap(module => module.tasks)).filter(task => enrollment.taskIds.includes(task.id));
  expect(selected.every(task => task.requirement === 'required')).toBe(true);
  await expect(page.getByRole('button', { name: 'Apply feasible part', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Your next 7 days', exact: true })).toBeVisible();
  const agendaDays = page.locator('.learning-schedule-day, .plan-agenda-rest');
  const start = preview.availability.startDate > data.localDay ? preview.availability.startDate : data.localDay;
  const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(`${start}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0, 10); });
  await expect(agendaDays).toHaveCount(7);
  for (const [index, day] of weekDays.entries()) await expect(agendaDays.nth(index).locator('strong').first()).toHaveText(day === data.localDay && preview.result.blocks.some(block => block.day === day) ? 'Today' : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)));
  const laterStudyDays = new Set(preview.result.blocks.filter(block => block.day > weekDays[6]).map(block => block.day)).size;
  expect(laterStudyDays).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(agendaDays).toHaveCount(7);
  await page.getByRole('button', { name: 'Back to this week', exact: true }).click();
  await expect(agendaDays).toHaveCount(7);
  await screenshot(page, 'cs50-preview-desktop', 1280);
  await page.getByRole('checkbox', { name: /I understand that 9 activities remain unscheduled/ }).check();
  await page.getByRole('button', { name: 'Apply feasible part', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continue course', exact: true })).toHaveAttribute('href', `/app/courses/${enrollment.id}#module-cs50b-w00`);
  await expect(page.getByText('Lecture · Interpreting Information', { exact: true })).toBeVisible();
  const saved = await learning(context);
  expect(saved.state.enrollments[0].completions).toHaveLength(0);
  expect(saved.state.plan?.result.missingTasks).toBe(9);
  expect(saved.state.plan?.result.unscheduled).toHaveLength(9);
  await screenshot(page, 'cs50-today-mobile', 375);
});

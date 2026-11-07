import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningCommand, LearningData, TimeData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(120000);

async function setup(context: BrowserContext, intent: 'learning' | 'work' = 'learning') {
  const email = `b3-orientation-${randomUUID()}@example.test`, after = Date.now();
  const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/today' } });
  expect(sent.status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/today' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Orientation Learner', timezone: 'Africa/Cairo', intent, appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  return read(context);
}
async function read(context: BrowserContext): Promise<LearningData> {
  const response = await context.request.get(`${base}/api/v1/learning`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function command(context: BrowserContext, data: LearningData, value: Omit<LearningCommand, 'expectedRevision' | 'operationId'> & Record<string, unknown>): Promise<LearningData> {
  const response = await context.request.post(`${base}/api/v1/learning`, { headers: { ...origin, 'X-Dima-Account-Id': data.accountId }, data: { ...value, expectedRevision: data.state.revision, operationId: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
}
async function course(context: BrowserContext, data: LearningData, title: string, extraActivities = 0) {
  const id = `private-${randomUUID()}`;
  data = await command(context, data, { type: 'saveDraft', draft: { id, title, sourceUrl: 'https://example.edu/course', courses: [{ id: 'course', title, position: 0, modules: [{ id: 'module', title: 'Getting started', position: 0, tasks: [{ id: 'practice', title: `${title} practice`, position: 0, kind: 'assignment', minutes: 30, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.edu/course', prerequisiteIds: [] }, ...Array.from({ length: extraActivities }, (_, index) => ({ id: `extra-${index}`, title: `${title} exercise ${index + 1}`, position: index + 1, kind: 'reading', minutes: 5, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.edu/course', prerequisiteIds: [] }))] }] }] } });
  const target = new Date(`${data.localDay}T12:00:00Z`); target.setUTCDate(target.getUTCDate() + 30);
  return command(context, data, { type: 'enroll', offeringId: id, taskIds: ['practice', ...Array.from({ length: extraActivities }, (_, index) => `extra-${index}`)], priorTaskIds: [], targetDate: target.toISOString().slice(0, 10), estimates: {} });
}
async function capture(page: Page, name: string) {
  mkdirSync('.impeccable/review', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/orientation-${name}-${width}.png`, fullPage: true });
  }
}
async function noStartedTime(context: BrowserContext) {
  const response = await context.request.get(`${base}/api/v1/time`);
  expect(response.status()).toBe(200);
  const time = (await response.json()).data as TimeData;
  expect(time.active).toBeNull();
}

test('a new learner gets one clear first step and an actionable empty progress page', async ({ page, context }) => {
  await setup(context);
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'Choose what you want to learn.', exact: true })).toBeVisible();
  const steps = page.getByRole('list', { name: 'Getting started', exact: true });
  await expect(steps.getByRole('listitem')).toHaveCount(3);
  await expect(steps.locator('[aria-current="step"]')).toContainText('Choose a course');
  await expect(page.getByRole('link', { name: 'Choose a course', exact: true })).toHaveAttribute('href', '/app/library');
  await expect(page.locator('.learning-personal-progress')).toHaveCount(0);
  await capture(page, 'today-empty');
  const mobile = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
  await expect(mobile.getByRole('link')).toHaveCount(5);
  await expect(mobile.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Choose a course', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/library`);
  await page.setViewportSize({ width: 1280, height: 920 });
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('href', '/app/today');
  await page.goto('/app/progress');
  await expect(page.getByRole('heading', { name: 'No recorded time this week yet.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a focus session', exact: true })).toHaveAttribute('href', '/app/focus');
  await expect(page.getByText('No plan yet', { exact: true })).toHaveCount(0);
  await capture(page, 'progress-empty');
  expect((await read(context)).state.enrollments).toHaveLength(0);
  await noStartedTime(context);
});

test('Today and My Plan resume the latest unapplied preview without overwriting it', async ({ page, context }) => {
  let data = await course(context, await setup(context), 'Design foundations');
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'Set your weekly study time.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plan my week', exact: true })).toHaveAttribute('href', '/app/plan/setup');
  const makePreview = (minutes: number) => ({ type: 'preview' as const, availability: { startDate: data.localDay, weekdayMinutes: [minutes, minutes, minutes, minutes, minutes, 0, 0], reservePercent: 15 }, targets: Object.fromEntries(data.state.enrollments.map(item => [item.id, item.targetDate])), controls: { useBuffer: false, exceptions: {}, priorities: {}, pins: [], pauses: [] }, mode: 'initial' as const });
  data = await command(context, data, makePreview(30));
  data = await command(context, data, makePreview(60));
  const latest = data.state.previews.at(-1)!;
  const unchanged = { revision: data.state.revision, count: data.state.previews.length };
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'Your plan is ready to review.', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Getting started', exact: true }).locator('[aria-current="step"]')).toContainText('Plan your week');
  await expect(page.getByRole('link', { name: 'Continue planning', exact: true })).toHaveAttribute('href', `/app/plan/previews/${latest.id}`);
  await capture(page, 'today-draft');
  await page.getByRole('link', { name: 'Continue planning', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/plan/previews/${latest.id}`);
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 920 });
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Review plan');
  await breadcrumb.getByRole('link', { name: 'My Plan', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/plan`);
  await expect(page.getByRole('link', { name: 'Continue planning', exact: true })).toHaveAttribute('href', `/app/plan/previews/${latest.id}`);
  data = await read(context);
  expect(data.state.revision).toBe(unchanged.revision);
  expect(data.state.previews).toHaveLength(unchanged.count);
  expect(data.state.plan).toBeNull();
  expect(data.state.enrollments[0].completions).toHaveLength(0);
});

test('work-only learners can focus directly and discover rooms from desktop and mobile navigation', async ({ page, context }) => {
  await setup(context, 'work');
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'Ready for a work session?', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Getting started', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Start work session', exact: true })).toHaveAttribute('href', '/app/focus?category=work');
  await expect(page.getByRole('link', { name: 'Choose a course', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Start work session', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Work', exact: true })).toBeChecked();
  await page.setViewportSize({ width: 1280, height: 920 });
  const main = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const friends = main.getByRole('link', { name: 'Friends', exact: true });
  await friends.click();
  await expect(page).toHaveURL(`${base}/app/progress/circle`);
  await expect(friends).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('link', { name: 'Progress', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#workspace-title')).toHaveText('Friends');
  const rooms = main.getByRole('link', { name: 'Study rooms', exact: true });
  await expect(rooms).toHaveAttribute('aria-describedby', 'nav-rooms-hint');
  await expect(rooms).toHaveAccessibleDescription('Focus with other people');
  await rooms.click();
  await expect(page).toHaveURL(`${base}/app/rooms`);
  await expect(rooms).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('link', { name: 'Focus', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Study together.', exact: true })).toBeVisible();
  const tools = page.locator('.sidebar-tools');
  await expect(tools).not.toHaveAttribute('open');
  await tools.getByText('More tools', { exact: true }).click();
  await expect(tools.getByRole('link', { name: 'Contributions', exact: true })).toBeVisible();
  await tools.getByText('More tools', { exact: true }).click();
  await capture(page, 'rooms-navigation');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Focus', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'More', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/more`);
  await page.locator('.more-links').getByRole('link', { name: /Study rooms/ }).click();
  await expect(page).toHaveURL(`${base}/app/rooms`);
  expect((await read(context)).state.enrollments).toHaveLength(0);
  await noStartedTime(context);
});

test('focus filters activities by course and retains direct activity links without starting a timer', async ({ page, context }) => {
  let data = await course(context, await setup(context), 'Design foundations', 24);
  data = await course(context, data, 'Writing clearly');
  const first = data.state.enrollments.find(item => item.snapshot.title === 'Design foundations')!;
  const second = data.state.enrollments.find(item => item.snapshot.title === 'Writing clearly')!;
  await page.goto('/app/focus?category=learning');
  await expect(page.getByRole('heading', { name: 'Make space for one thing.', exact: true })).toBeVisible();
  await page.getByText('Add session details', { exact: false }).click();
  const coursePicker = page.getByRole('combobox', { name: 'Course', exact: true });
  const activityPicker = page.getByRole('combobox', { name: /Link a course activity/ });
  await expect(coursePicker).toHaveValue('');
  await expect(activityPicker).toBeDisabled();
  await coursePicker.selectOption(first.id);
  await expect(activityPicker).toBeEnabled();
  await expect(activityPicker).toHaveValue('');
  await expect(activityPicker.locator('option')).toHaveCount(26);
  await page.getByLabel('Find an activity', { exact: true }).fill('practice');
  await expect(activityPicker.locator('option')).toHaveText(['Focus without an activity', 'Design foundations practice']);
  await activityPicker.selectOption(JSON.stringify([first.id, 'practice']));
  await coursePicker.selectOption(second.id);
  await expect(activityPicker).toHaveValue('');
  await expect(activityPicker.locator('option')).toHaveText(['Focus without an activity', 'Writing clearly practice']);
  await activityPicker.selectOption(JSON.stringify([second.id, 'practice']));
  await coursePicker.selectOption('');
  await expect(activityPicker).toHaveValue('');
  await expect(activityPicker).toBeDisabled();
  await page.goto(`/app/focus?course=${first.id}&task=practice`);
  await expect(coursePicker).toHaveValue(first.id);
  await expect(activityPicker).toHaveValue(JSON.stringify([first.id, 'practice']));
  await expect(activityPicker).toBeVisible();
  await capture(page, 'focus-course');
  await page.goto(`/app/courses/${first.id}/tasks/practice`);
  await expect(page.getByRole('heading', { name: 'Design foundations practice', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start focus', exact: true })).toHaveAttribute('href', `/app/focus?course=${first.id}&task=practice`);
  await expect(page.getByRole('link', { name: 'Back to Design foundations', exact: true })).toHaveAttribute('href', `/app/courses/${first.id}`);
  await page.setViewportSize({ width: 1280, height: 920 });
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Activity');
  await expect(breadcrumb.getByRole('link', { name: 'My Courses', exact: true })).toHaveAttribute('href', '/app/courses');
  data = await read(context);
  expect(data.state.plan).toBeNull();
  expect(data.state.enrollments.every(item => item.completions.length === 0)).toBe(true);
  await noStartedTime(context);
});

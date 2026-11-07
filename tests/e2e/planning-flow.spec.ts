import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningCommand, LearningData, Offering } from '../../packages/contracts/src/index';
import { PLANNER_VERSION } from '../../packages/contracts/src/policy';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import { seedSyntheticLearningState } from '../helpers/learning-fixture.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
const weekdayMinutes = [60, 60, 60, 60, 60, 0, 0];
const controls = { useBuffer: false, exceptions: {}, priorities: {}, pins: [], pauses: [] };
const artifacts = '/media/amro/Data2/dima-artifacts/planning-clarity-2026-11-02';
test.setTimeout(120000);

function shift(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
async function setup(context: BrowserContext) {
  const email = `b3-planning-${randomUUID()}@example.test`, after = Date.now();
  const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/plan' } });
  expect(sent.status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/plan' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Planning Learner', timezone: 'Africa/Cairo', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
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
async function preview(context: BrowserContext, data: LearningData, days = weekdayMinutes) {
  return command(context, data, { type: 'preview', availability: { startDate: data.localDay, weekdayMinutes: days, reservePercent: 15 }, targets: Object.fromEntries(data.state.enrollments.map(item => [item.id, item.targetDate])), controls, mode: 'initial' });
}
async function privateCourse(context: BrowserContext, data: LearningData, unknown = false, prior = false) {
  const id = `private-${randomUUID()}`;
  const task = (taskId: string, minutes: number | null) => ({ id: taskId, title: taskId === 'start' ? 'Read the introduction' : 'Practice a useful skill', position: taskId === 'start' ? 0 : 1, kind: 'assignment', minutes, estimateSource: minutes === null ? 'missing' : 'user', requirement: 'required', sourceUrl: 'https://example.edu/course', prerequisiteIds: [] });
  data = await command(context, data, { type: 'saveDraft', draft: { id, title: unknown ? 'A course with an unknown estimate' : 'A practical course', sourceUrl: 'https://example.edu/course', courses: [{ id: 'course', title: 'Course', position: 0, modules: [{ id: 'module', title: 'Practice', position: 0, tasks: [task('start', 20), task('practice', unknown ? null : 60)] }] }] } });
  return command(context, data, { type: 'enroll', offeringId: id, taskIds: ['start', 'practice'], priorTaskIds: prior ? ['start'] : [], targetDate: shift(data.localDay, 30), estimates: {} });
}
async function capture(page: Page, name: string) {
  mkdirSync(artifacts, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${artifacts}/planning-${name}-${width}.png`, fullPage: true });
  }
}

test('planning options forecast the whole Google course and only apply a faster pace after review', async ({ page, context }) => {
  let data = await setup(context);
  const catalog = (await (await context.request.get(`${base}/api/v1/catalog`)).json()).data as Offering[];
  const google = catalog.find(item => item.id === 'google-project-management')!;
  const taskIds = google.courses.flatMap(course => course.modules.flatMap(module => module.tasks)).filter(task => task.requirement === 'required').map(task => task.id);
  const target = shift(data.localDay, 90);
  data = await command(context, data, { type: 'enroll', offeringId: google.id, taskIds, priorTaskIds: [], targetDate: target, estimates: {} });
  data = await preview(context, data);
  const first = data.state.previews.at(-1)!;
  expect(first.result.unscheduled).toHaveLength(0);
  expect(first.result.outcomes[0].forecastDate! > shift(target, 90)).toBe(true);
  expect(first.advice?.status).toBe('adjustable');
  expect(first.advice?.suggestedWeekdayMinutes?.slice(5)).toEqual([0, 0]);
  const suggestion = first.advice!.suggestedWeekdayMinutes!;
  await page.goto(`/app/plan/previews/${first.id}`);
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  await expect(page.locator('.plan-forecast-row').filter({ hasText: google.title })).toHaveCount(1);
  const courseForecast = page.locator('.plan-forecast-row').filter({ hasText: google.title });
  const forecastDays = (Date.parse(first.result.outcomes[0].forecastDate!) - Date.parse(first.availability.startDate)) / 86400000 + 1;
  const months = Number((await courseForecast.locator('.plan-duration strong').innerText()).match(/[\d.]+/)?.[0]);
  expect(Math.abs(months - forecastDays / 30.4375)).toBeLessThanOrEqual(.051);
  await expect(courseForecast.locator('.plan-duration')).toContainText('From your plan start');
  const printedFinish = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first.result.outcomes[0].forecastDate}T12:00:00Z`));
  await expect(courseForecast.locator('dl')).toContainText(printedFinish);
  await expect(page.getByText(/target plus 90-day/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Your next 7 days', exact: true })).toBeVisible();
  const option = page.getByRole('region', { name: 'Your proposed pace', exact: true });
  const alternative = page.getByRole('region', { name: 'Faster plan option', exact: true });
  await page.setViewportSize({ width: 1280, height: 920 });
  const mainBox = await option.boundingBox(), alternativeBox = await alternative.boundingBox();
  expect(Math.abs(mainBox!.y - alternativeBox!.y)).toBeLessThan(2);
  const firstDay = page.locator('.learning-schedule-day').first();
  await expect(firstDay).not.toHaveAttribute('open');
  await expect(firstDay.locator('summary')).toContainText('min scheduled');
  await firstDay.locator('summary').click();
  await expect(firstDay.locator('.plan-day-context')).toContainText('60 min available · 9 min kept free');
  await expect(firstDay.locator('li small').filter({ hasText: google.title })).toHaveCount(0);
  await firstDay.locator('summary').click();
  const dates = page.locator('.learning-schedule .learning-section-heading > span');
  const originalDates = await dates.innerText();
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A later week', exact: true })).toBeVisible();
  await expect(dates).not.toHaveText(originalDates);
  await page.getByRole('button', { name: 'Back to this week', exact: true }).click();
  await expect(dates).toHaveText(originalDates);
  expect((await read(context)).state.revision).toBe(data.state.revision);
  expect((await read(context)).state.plan).toBeNull();
  await capture(page, 'choices');
  await page.getByRole('button', { name: 'Preview faster plan', exact: true }).click();
  await expect(page).not.toHaveURL(`${base}/app/plan/previews/${first.id}`);
  data = await read(context);
  expect(data.state.plan).toBeNull();
  const faster = data.state.previews.at(-1)!;
  expect(faster.availability.weekdayMinutes).toEqual(suggestion);
  expect(faster.targets).toEqual(first.targets);
  expect(faster.result.unscheduled).toHaveLength(0);
  expect(faster.result.outcomes.every(outcome => outcome.forecastDate && outcome.forecastDate <= outcome.targetDate)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save this plan', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/today`);
  data = await read(context);
  expect(data.state.plan?.id).toBe(faster.id);
  expect(data.state.availability?.weekdayMinutes).toEqual(suggestion);
  expect(data.state.enrollments[0].completions).toHaveLength(0);
});

test('planning options give actionable zero-time and unknown-work states without a false finish', async ({ page, context }) => {
  let data = await privateCourse(context, await setup(context));
  data = await preview(context, data, [0, 0, 0, 0, 0, 0, 0]);
  const zero = data.state.previews.at(-1)!;
  expect(zero.advice?.status).toBe('no-study-days');
  expect(zero.result.outcomes[0].forecastDate).toBeNull();
  await page.goto(`/app/plan/previews/${zero.id}`);
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview faster plan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Save this plan|Apply feasible part)$/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /remain.*unscheduled/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Adjust your available time · 2', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Confirm remaining work/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Adjust my plan', exact: true })).toHaveAttribute('href', `/app/plan/setup?preview=${zero.id}`);
  await capture(page, 'zero-time');
  data = await privateCourse(context, data, true);
  data = await preview(context, data);
  const unknown = data.state.previews.at(-1)!;
  const unfinished = data.state.enrollments.find(item => item.snapshot.title === 'A course with an unknown estimate')!;
  expect(unknown.result.outcomes.find(item => item.enrollmentId === unfinished.id)?.forecastDate).toBeNull();
  expect(unknown.advice?.status).toBe('needs-input');
  await page.goto(`/app/plan/previews/${unknown.id}`);
  await expect(page.getByRole('heading', { name: 'Activities needing attention', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview faster plan', exact: true })).toHaveCount(0);
  await capture(page, 'unknown-work');
  await page.getByText('View 1 activity', { exact: true }).click();
  await page.getByRole('link', { name: 'Review estimate', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/courses/${unfinished.id}/tasks/practice?action=remaining&plan=${unknown.id}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'What is still left?', exact: true })).toBeVisible();
  await dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true }).fill('45');
  await dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save remaining work', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('45 min remaining', { exact: true })).toBeVisible();
  data = await read(context);
  expect(data.state.plan).toBeNull();
  expect(data.state.previews.at(-1)?.id).toBe(unknown.id);
  expect(data.state.enrollments.every(item => item.completions.length === 0)).toBe(true);
  await page.getByRole('link', { name: 'Return to plan setup', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/plan/setup?preview=${unknown.id}`);
  for (const [index, day] of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].entries()) await expect(page.getByLabel(`${day} minutes`, { exact: true })).toHaveValue(String(unknown.availability.weekdayMinutes[index]));
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue(unknown.availability.startDate);
  for (const course of data.state.enrollments) await expect(page.getByLabel(`Target for ${course.snapshot.title}`, { exact: true })).toHaveValue(unknown.targets[course.id]);
  await capture(page, 'setup');
  await page.getByRole('button', { name: 'Preview my plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  data = await read(context);
  const reviewed = data.state.previews.at(-1)!;
  expect(reviewed.id).not.toBe(unknown.id);
  expect(reviewed.availability).toEqual(unknown.availability);
  expect(reviewed.targets).toEqual(unknown.targets);
  expect(reviewed.controls).toEqual(unknown.controls);
  expect(reviewed.result.unscheduled).toHaveLength(0);
  expect(reviewed.result.blocks.filter(block => block.enrollmentId === unfinished.id && block.taskId === 'practice').reduce((sum, block) => sum + block.minutes, 0)).toBe(45);
  expect(reviewed.result.outcomes.find(item => item.enrollmentId === unfinished.id)?.forecastDate).toBeTruthy();
  expect(data.state.plan).toBeNull();
  expect(data.state.enrollments.every(item => item.completions.length === 0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  await page.goto('/app/plan');
  await expect(page.getByRole('heading', { name: 'Your draft is waiting for you.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue planning', exact: true })).toHaveAttribute('href', `/app/plan/previews/${reviewed.id}`);
  await page.getByRole('link', { name: 'Continue planning', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  expect((await read(context)).state.plan).toBeNull();
});

test('an old planning preview refreshes only on request and preserves availability and prior progress', async ({ page, context }) => {
  let data = await privateCourse(context, await setup(context), false, true);
  data = await preview(context, data);
  const old = data.state.previews.at(-1)!;
  const seeded = structuredClone(data.state);
  seeded.previews.at(-1)!.result.plannerVersion = 'b3-2';
  seeded.previews.at(-1)!.baseRevision = data.state.revision + 1;
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  await seedSyntheticLearningState(data.accountId, seeded, account.profile!.revision);
  let previewWrites = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/learning' && request.method() === 'POST' && request.postDataJSON().type === 'preview') previewWrites++; });
  await page.goto(`/app/plan/previews/${old.id}`);
  await expect(page.getByRole('button', { name: 'Refresh this preview', exact: true })).toBeVisible();
  expect(previewWrites).toBe(0);
  await page.getByRole('button', { name: 'Refresh this preview', exact: true }).click();
  await expect(page).not.toHaveURL(`${base}/app/plan/previews/${old.id}`);
  data = await read(context);
  const refreshed = data.state.previews.at(-1)!;
  expect(previewWrites).toBe(1);
  expect(refreshed.result.plannerVersion).toBe(PLANNER_VERSION);
  expect(refreshed.availability).toEqual(old.availability);
  expect(refreshed.targets).toEqual(old.targets);
  expect(data.state.enrollments[0].completions).toEqual(seeded.enrollments[0].completions);
  expect(data.state.plan).toBeNull();
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  await page.goto('/app/plan');
  await expect(page.getByRole('heading', { name: 'Your draft is waiting for you.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue planning', exact: true })).toHaveAttribute('href', `/app/plan/previews/${refreshed.id}`);
  await page.getByRole('link', { name: 'Continue planning', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save this plan', exact: true })).toBeEnabled();
  expect((await read(context)).state.plan).toBeNull();
});


test('saved plan shows current completion without rewriting saved time or forecasts', async ({ page, context }) => {
  let data = await privateCourse(context, await setup(context));
  data = await preview(context, data, [180, 180, 180, 180, 180, 180, 180]);
  const proposed = data.state.previews.at(-1)!;
  data = await command(context, data, { type: 'apply', previewId: proposed.id, acknowledgeUnscheduled: false });
  const savedPlan = structuredClone(data.state.plan!);
  const enrollment = data.state.enrollments[0];
  data = await command(context, data, { type: 'complete', enrollmentId: enrollment.id, taskId: 'start', effortMinutes: 20 });
  await page.goto('/app/plan');
  await expect(page.getByRole('link', { name: 'Study today', exact: true })).toHaveAttribute('href', '/app/today');
  await expect(page.getByRole('link', { name: 'Adjust study plan', exact: true })).toHaveAttribute('href', '/app/plan/recovery');
  const day = page.locator('.learning-schedule-day').first();
  await expect(day.locator('summary')).toContainText('1 of 2 activities completed');
  await expect(day.locator('summary')).toContainText('80 min scheduled');
  await expect(day.getByRole('link', { name: /^Review activity\s*:\s*Read the introduction$/ })).toBeVisible();
  await expect(page.locator('.plan-forecasts.is-saved')).toContainText('Estimated finish when saved');
  expect((await read(context)).state.plan).toEqual(savedPlan);
  await capture(page, 'saved-current-completion');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await capture(page, 'saved-current-completion-dark');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await command(context, data, { type: 'complete', enrollmentId: enrollment.id, taskId: 'practice', effortMinutes: 60 });
  await page.reload();
  await expect(page.locator('.learning-schedule-day').first().locator('summary')).toContainText('All activities completed');
  expect((await read(context)).state.plan).toEqual(savedPlan);
});

test('planning setup explains capacity, preserves rest days and previews goals before saving', async ({ page, context }) => {
  let data = await privateCourse(context, await setup(context));
  await page.goto('/app/plan/setup');
  const summary = page.getByRole('region', { name: 'Your planning estimate', exact: true });
  await expect(summary).toContainText('5h · 5 days');
  await expect(summary).toContainText('4h 15m');
  await page.getByLabel('Monday minutes', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Set study days to 90 minutes', exact: true }).click();
  for (const day of ['Sunday', 'Tuesday', 'Wednesday', 'Thursday']) await expect(page.getByLabel(`${day} minutes`, { exact: true })).toHaveValue('90');
  for (const day of ['Monday', 'Friday', 'Saturday']) await expect(page.getByLabel(`${day} minutes`, { exact: true })).toHaveValue('0');
  await expect(summary).toContainText('6h · 4 days');
  await expect(summary).toContainText('5h 4m');
  await page.getByRole('button', { name: 'Set study days to 60 minutes', exact: true }).click();
  await expect(summary).toContainText('4h · 4 days');
  await expect(summary).toContainText('3h 24m');
  for (const day of ['Monday', 'Friday', 'Saturday']) await expect(page.getByLabel(`${day} minutes`, { exact: true })).toHaveValue('0');
  const year = Number(data.localDay.slice(0, 4)) + 1;
  const start = `${year}-01-31`, target = `${year}-04-30`;
  await page.getByLabel('Start date', { exact: true }).fill(start);
  const goal = page.getByRole('button', { name: '3 months goal for A practical course', exact: true });
  await goal.click();
  await expect(goal).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Target for A practical course', { exact: true })).toHaveValue(target);
  expect((await read(context)).state.revision).toBe(data.state.revision);
  expect((await read(context)).state.plan).toBeNull();
  const minutesField = page.getByLabel('Sunday minutes', { exact: true });
  await minutesField.fill('720');
  for (const width of [2160, 1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await minutesField.evaluate(element => {
      const style = getComputedStyle(element), canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const contentWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return contentWidth >= context.measureText('720').width + 18;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 2160) await page.screenshot({ path: '/media/amro/Data2/dima-artifacts/planning-clarity-2026-11-02/planning-input-2160.png', fullPage: true });
  }
  await minutesField.fill('60');
  await capture(page, 'setup-capacity-goal');
  await page.getByRole('button', { name: 'Preview my plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  data = await read(context);
  const draft = data.state.previews.at(-1)!;
  expect(draft.availability.startDate).toBe(start);
  expect(draft.availability.weekdayMinutes).toEqual([60, 0, 60, 60, 60, 0, 0]);
  expect(draft.targets[data.state.enrollments[0].id]).toBe(target);
  expect(data.state.plan).toBeNull();
  await page.getByRole('button', { name: 'Save this plan', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/today`);
  expect((await read(context)).state.plan?.id).toBe(draft.id);
});

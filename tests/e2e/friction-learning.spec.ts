import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningCommand, LearningData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(120000);

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
async function setup(context: BrowserContext) {
  const email = `ux-learning-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/courses' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/courses' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Clarity Learner', timezone: 'Africa/Cairo', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  let data = await read(context);
  const id = `private-${randomUUID()}`;
  const task = (id: string, title: string) => ({ id, title, position: 0, kind: 'reading', minutes: 20, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.edu/course', prerequisiteIds: [] });
  data = await command(context, data, { type: 'saveDraft', draft: { id, title: 'Practical foundations', sourceUrl: 'https://example.edu/course', courses: [
    { id: 'design', title: 'Design basics', position: 0, modules: [{ id: 'design-module', title: 'Design introduction', position: 0, tasks: [task('design-task', 'Explore layout')] }] },
    { id: 'writing', title: 'Writing clearly', position: 1, modules: [{ id: 'writing-module', title: 'Writing introduction', position: 0, tasks: [task('writing-task', 'Practice paragraphs')] }] },
  ] } });
  const target = new Date(`${data.localDay}T12:00:00Z`); target.setUTCDate(target.getUTCDate() + 30);
  return command(context, data, { type: 'enroll', offeringId: id, taskIds: ['design-task', 'writing-task'], priorTaskIds: [], targetDate: target.toISOString().slice(0, 10), estimates: {} });
}
async function capture(page: Page, name: string) {
  mkdirSync('.impeccable/review', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/friction-${name}-${width}.png`, fullPage: true });
  }
}

test('outline search keeps only matching courses, supports collapse, and review links resume the latest draft', async ({ page, context }) => {
  let data = await setup(context);
  const enrollment = data.state.enrollments[0];
  for (const minutes of [30, 60]) data = await command(context, data, { type: 'preview', availability: { startDate: data.localDay, weekdayMinutes: [minutes, minutes, minutes, minutes, minutes, 0, 0], reservePercent: 15 }, targets: { [enrollment.id]: enrollment.targetDate }, controls: { useBuffer: false, exceptions: {}, priorities: {}, pins: [], pauses: [] }, mode: 'initial' });
  const latest = data.state.previews.at(-1)!;
  const revision = data.state.revision;
  await page.goto(`/app/courses/${enrollment.id}`);
  const outline = page.getByRole('region', { name: 'Course outline', exact: true });
  const search = outline.getByRole('searchbox', { name: 'Search the outline', exact: true });
  const design = outline.getByRole('button', { name: /Design introduction/ });
  const writing = outline.getByRole('button', { name: /Writing introduction/ });
  await expect(design).toHaveAttribute('aria-expanded', 'true');
  await expect(writing).toHaveAttribute('aria-expanded', 'false');
  await search.fill('  paragraphs  ');
  await expect(outline.locator('.learning-outline-course')).toHaveCount(1);
  await expect(outline.locator('.learning-outline-course > h3')).toContainText('Writing clearly');
  await expect(outline.getByText('Practice paragraphs', { exact: true })).toBeVisible();
  await expect(writing).toHaveAttribute('aria-expanded', 'true');
  await writing.click(); await expect(writing).toHaveAttribute('aria-expanded', 'false');
  await expect(outline.getByText('Practice paragraphs', { exact: true })).toHaveCount(0);
  await writing.click(); await expect(writing).toHaveAttribute('aria-expanded', 'true');
  await writing.click();
  await search.fill('practice');
  await expect(writing).toHaveAttribute('aria-expanded', 'true');
  await capture(page, 'outline-search');
  await search.fill('');
  await expect(design).toHaveAttribute('aria-expanded', 'true');
  await expect(writing).toHaveAttribute('aria-expanded', 'false');
  await search.fill('no-such-learning-activity');
  await expect(outline.getByText('No activities match that search.', { exact: true })).toBeVisible();
  await expect(outline.locator('.learning-outline-course')).toHaveCount(0);
  await outline.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(design).toHaveAttribute('aria-expanded', 'true');
  await expect(writing).toHaveAttribute('aria-expanded', 'false');
  const review = page.getByRole('link', { name: 'View study plan', exact: true });
  await expect(review).toHaveAttribute('href', '/app/plan'); await review.click();
  await expect(page.getByRole('link', { name: 'Continue planning', exact: true })).toHaveAttribute('href', `/app/plan/previews/${latest.id}`);
  await page.getByRole('link', { name: 'Continue planning', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/plan/previews/${latest.id}`);
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  await page.goto('/app/progress');
  const weekly = page.getByRole('link', { name: 'Review my weekly plan', exact: true });
  await expect(weekly).toHaveAttribute('href', '/app/plan'); await weekly.click();
  await expect(page.getByRole('link', { name: 'Continue planning', exact: true })).toHaveAttribute('href', `/app/plan/previews/${latest.id}`);
  data = await read(context);
  expect(data.state.revision).toBe(revision);
  expect(data.state.plan).toBeNull();
  expect(data.state.previews).toHaveLength(2);
  expect(data.state.enrollments[0].completions).toHaveLength(0);
});

test('course estimates reject visible and hidden invalid values, preserve failed edits, and allow clearing an override', async ({ page, context }) => {
  let data = await setup(context);
  const enrollment = data.state.enrollments[0];
  let writes = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/learning' && request.method() === 'POST' && request.postDataJSON().type === 'setEstimates') writes++; });
  await page.goto(`/app/courses/${enrollment.id}`);
  await page.getByText('Course options', { exact: true }).click();
  await page.getByRole('button', { name: 'Review effort estimates', exact: true }).click();
  const form = page.getByRole('form', { name: 'Course effort estimates', exact: true });
  const module = form.getByRole('button', { name: /Design introduction/ });
  await module.click();
  const input = form.locator('input[name="estimate-design-task"]');
  const save = form.getByRole('button', { name: 'Save estimates', exact: true });
  for (const value of ['0', '10001', '1.5']) {
    await input.fill(value); await save.click();
    await expect(form.getByRole('alert')).toContainText('Enter whole minutes from 1 to 10,000');
    expect(await input.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
    expect(writes).toBe(0);
  }
  await input.fill('0'); await module.click();
  await expect(input).toHaveCount(0);
  await save.click();
  await expect(form.getByRole('alert')).toContainText('Explore layout: enter whole minutes');
  expect(writes).toBe(0);
  await module.click(); await input.fill('45');
  let rejectFirst = true;
  await page.route('**/api/v1/learning', async route => {
    if (rejectFirst && route.request().method() === 'POST' && route.request().postDataJSON().type === 'setEstimates') {
      rejectFirst = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE' } }) });
    } else await route.continue();
  });
  await save.click();
  await expect(form.getByRole('alert')).toHaveText('Estimates were not saved. Your edits are still here.');
  await expect(input).toHaveValue('45');
  expect(writes).toBe(1);
  await capture(page, 'estimate-retry');
  await save.click();
  await expect(page.getByText('Estimates saved. Preview a new plan to apply their effect.', { exact: true })).toBeVisible();
  await expect(form).toHaveCount(0);
  expect(writes).toBe(2);
  data = await read(context); expect(data.state.enrollments[0].estimates['design-task']).toBe(45);
  await page.unroute('**/api/v1/learning');
  await page.getByRole('button', { name: 'Review effort estimates', exact: true }).click();
  await module.click(); await input.fill(''); await save.click();
  await expect(form).toHaveCount(0);
  expect(writes).toBe(3);
  data = await read(context);
  expect(Object.hasOwn(data.state.enrollments[0].estimates, 'design-task')).toBe(false);
  expect(data.state.enrollments[0].snapshot.courses[0].modules[0].tasks[0].minutes).toBe(20);
  expect(data.state.plan).toBeNull();
  expect(data.state.enrollments[0].completions).toHaveLength(0);
});

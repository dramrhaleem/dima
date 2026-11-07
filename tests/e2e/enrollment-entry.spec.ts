import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { LearningData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const artifacts = '/media/amro/Data2/dima-artifacts/enrollment-entry-2026-11-02';
test.setTimeout(120000);

async function read(context: BrowserContext): Promise<LearningData> {
  const response = await context.request.get(`${base}/api/v1/learning`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function capture(page: Page, name: string, widths = [2160, 1280, 390]) {
  mkdirSync(artifacts, { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`).toBe(true);
    await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: true });
  }
}

test('first-time learner sees a full course forecast and carries the same choices through to a saved plan', async ({ page, context }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const email = `enrollment-entry-${randomUUID()}@example.test`;
  await page.goto('/auth');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  const after = Date.now();
  await page.getByRole('button', { name: 'Send email code', exact: true }).click();
  await expect(page.getByLabel('Email code', { exact: true })).toBeVisible();
  await page.getByLabel('Email code', { exact: true }).fill(await waitForLocalOtp(email, { after }));
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\?/);
  await page.getByLabel('What should we call you?', { exact: true }).fill('First course learner');
  await page.getByLabel('Your time zone', { exact: true }).fill('Africa/Cairo');
  await page.getByRole('button', { name: 'Choose my first course', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/library`);
  await page.getByRole('link', { name: 'CS50 Business', exact: true }).click();
  await page.getByRole('link', { name: 'Personalize this course', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make CS50 Business fit your life.', exact: true })).toBeVisible();

  const initial = await read(context);
  expect(initial.state.enrollments).toHaveLength(0);
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/learning')) writes.push(request.postDataJSON().type);
  });
  const forecast = page.getByRole('region', { name: 'Course finish estimate', exact: true });
  await expect(forecast).toContainText('9 activities need a time estimate');
  await expect(forecast).not.toContainText('Estimated finish');
  await capture(page, 'missing-estimates', [1280]);

  const missing = page.getByRole('region', { name: 'Missing activity estimates', exact: true });
  await missing.locator('input').fill('120');
  await missing.getByRole('button', { name: 'Apply estimate', exact: true }).click();
  await expect(missing).toHaveCount(0);
  await page.getByRole('button', { name: '90 min', exact: true }).click();
  await page.getByRole('button', { name: '1 month', exact: true }).click();
  await expect(page.getByLabel('Minutes per study day', { exact: true })).toHaveValue('90');
  await expect(page.getByRole('group', { name: 'Study days' }).getByRole('button', { name: 'Fri', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(forecast).toContainText('Estimated finish');
  await expect(forecast.getByRole('status')).toContainText(/weeks|months|days/);
  const joinedForecastDate = await forecast.locator('b').innerText();
  const goal = await page.getByLabel('Target finish date', { exact: true }).inputValue();
  await capture(page, 'course-forecast');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add course & continue', exact: true })).toBeEnabled();
  await capture(page, 'course-forecast-dark', [1280]);
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add course & continue', exact: true })).toBeEnabled();
  expect(writes).toEqual([]);
  expect((await read(context)).state.revision).toBe(initial.state.revision);

  await page.getByRole('button', { name: 'Add course & continue', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/plan\/setup\?week=/);
  await expect(page.getByLabel('Sunday minutes', { exact: true })).toHaveValue('90');
  await expect(page.getByLabel('Friday minutes', { exact: true })).toHaveValue('0');
  let data = await read(context);
  expect(data.state.enrollments).toHaveLength(1);
  const enrollment = data.state.enrollments[0];
  expect(enrollment.targetDate).toBe(goal);
  expect(enrollment.taskIds).toHaveLength(18);
  expect(Object.keys(enrollment.estimates)).toHaveLength(9);
  expect(Object.values(enrollment.estimates)).toEqual(Array(9).fill(120));
  expect(data.state.plan).toBeNull();
  await page.getByRole('button', { name: 'Preview my plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible();
  data = await read(context);
  const preview = data.state.previews.at(-1)!;
  const outcome = preview.result.outcomes.find(value => value.enrollmentId === enrollment.id)!;
  expect(preview.availability.weekdayMinutes).toEqual([90, 90, 90, 90, 90, 0, 0]);
  expect(preview.result.missingTasks).toBe(0);
  expect(outcome.forecastDate).toBeTruthy();
  const formattedDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${outcome.forecastDate}T12:00:00Z`));
  expect(joinedForecastDate).toBe(formattedDate);
  await page.getByRole('button', { name: 'Save this plan', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/today`);
  await expect(page.getByRole('link', { name: 'Continue course', exact: true })).toBeVisible();
  data = await read(context);
  expect(data.state.plan?.id).toBe(preview.id);
  expect(data.state.enrollments[0].estimates).toEqual(enrollment.estimates);
  expect(writes).toEqual(['enroll', 'preview', 'apply']);
  expect(failures).toEqual([]);
});

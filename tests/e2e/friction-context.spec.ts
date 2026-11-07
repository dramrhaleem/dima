import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { AccountData, RoomMe, RoomOptions, TimeData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(120000);

async function setup(context: BrowserContext) {
  const email = `friction-context-${randomUUID()}@example.test`, after = Date.now();
  const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/today' } });
  expect(sent.status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/today' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, {
    headers: { ...origin, 'X-Dima-Account-Id': account.accountId },
    data: { displayName: 'Context Learner', timezone: 'Africa/Cairo', intent: 'work', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() },
  })).status()).toBe(200);
}

async function noRecordedTime(context: BrowserContext) {
  const response = await context.request.get(`${base}/api/v1/time`);
  expect(response.status()).toBe(200);
  const time = (await response.json()).data as TimeData;
  expect(time.active).toBeNull();
  expect(time.sessions).toHaveLength(0);
}

test('filtered activity keeps its category without overwriting an open manual draft', async ({ page, context }) => {
  await setup(context);
  await page.goto('/app/progress/activity?category=learning');
  await expect(page.getByRole('heading', { name: 'No learning sessions match this view.', exact: true })).toBeVisible();
  const focus = page.getByRole('link', { name: 'Set up focus', exact: true });
  await expect(focus).toHaveAttribute('href', '/app/focus?category=learning');
  await expect(page.getByRole('link', { name: 'Show all activity', exact: true })).toHaveAttribute('href', '/app/progress/activity');
  await focus.click();
  await expect(page.getByRole('radio', { name: 'Learning', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Work', exact: true })).not.toBeChecked();
  await noRecordedTime(context);

  await page.goto('/app/progress/activity?category=learning');
  await page.getByRole('button', { name: 'Add manual time', exact: true }).click();
  const manual = page.locator('.focus-manual');
  await expect(manual.getByRole('combobox', { name: 'Kind of activity', exact: true })).toHaveValue('learning');
  await manual.getByRole('textbox', { name: 'Title optional, private', exact: true }).fill('Keep this learning entry');
  await page.getByRole('combobox', { name: 'Show activity', exact: true }).selectOption('work');
  await expect(page).toHaveURL(`${base}/app/progress/activity?category=work`);
  await expect(page.getByRole('heading', { name: 'No work sessions match this view.', exact: true })).toBeVisible();
  await expect(manual.getByRole('textbox', { name: 'Title optional, private', exact: true })).toHaveValue('Keep this learning entry');
  await expect(manual.getByRole('combobox', { name: 'Kind of activity', exact: true })).toHaveValue('learning');
  await noRecordedTime(context);
});

test('room creation carries a valid course filter but keeps an existing room draft', async ({ page, context, browser }) => {
  await setup(context);
  const response = await context.request.get(`${base}/api/v1/rooms/options`);
  expect(response.status()).toBe(200);
  const options = (await response.json()).data as RoomOptions;
  const google = options.offerings.find(item => item.id === 'google-project-management');
  const other = options.offerings.find(item => item.id !== 'google-project-management');
  expect(google).toBeDefined();
  expect(other).toBeDefined();
  const courseId = google!.id, otherId = other!.id;

  await page.goto(`/app/rooms?offeringId=${encodeURIComponent(courseId)}`);
  const create = page.locator('.rooms-intro').getByRole('link', { name: 'Create a room', exact: true });
  await expect(create).toHaveAttribute('href', `/app/rooms/new?offeringId=${encodeURIComponent(courseId)}`);
  await create.click();
  await expect(page.getByRole('combobox', { name: 'Shared course', exact: true })).toHaveValue(courseId);
  await expect(page.getByRole('textbox', { name: 'Room title', exact: true })).toHaveValue('');
  await expect(page.locator('.room-form').getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('textbox', { name: 'Room title', exact: true }).fill('My course room draft');

  // Client navigation retains the in-progress draft; a new filter is only a default.
  await page.getByRole('link', { name: 'Back to rooms', exact: true }).click();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption(otherId);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/rooms?offeringId=${encodeURIComponent(otherId)}`);
  await expect(create).toHaveAttribute('href', `/app/rooms/new?offeringId=${encodeURIComponent(otherId)}`);
  await create.click();
  await expect(page.getByRole('textbox', { name: 'Room title', exact: true })).toHaveValue('My course room draft');
  await expect(page.getByRole('combobox', { name: 'Shared course', exact: true })).toHaveValue(courseId);
  await expect(page.locator('.room-form').getByRole('checkbox')).not.toBeChecked();
  const ownResponse = await context.request.get(`${base}/api/v1/rooms/me`);
  expect(ownResponse.status()).toBe(200);
  expect(((await ownResponse.json()).data as RoomMe).membership).toBeNull();
  await noRecordedTime(context);

  const fresh = await browser.newContext({ baseURL: base });
  try {
    await setup(fresh);
    const invalidPage = await fresh.newPage();
    await invalidPage.goto('/app/rooms/new?offeringId=not-a-public-course');
    await expect(invalidPage.getByRole('combobox', { name: 'Shared course', exact: true })).toHaveValue('');
    await expect(invalidPage.getByRole('textbox', { name: 'Room title', exact: true })).toHaveValue('');
    await expect(invalidPage.locator('.room-form').getByRole('checkbox')).not.toBeChecked();
    await noRecordedTime(fresh);
  } finally {
    await fresh.close();
  }
});

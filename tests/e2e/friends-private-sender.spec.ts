import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import type { CircleData, SocialSettings } from '../../packages/contracts/src/index';

const base = 'http://127.0.0.1:8787';

async function learner(context: BrowserContext, displayName: string) {
  const email = `private-friend-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, {
    headers: { Origin: base }, data: { email, next: '/app/progress/circle' },
  })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, {
    headers: { Origin: base }, data: { email, token, next: '/app/progress/circle' },
  })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data;
  const headers = { Origin: base, 'X-Dima-Account-Id': account.accountId };
  expect((await context.request.patch(`${base}/api/v1/me`, {
    headers, data: {
      displayName, timezone: 'UTC', intent: 'learning', appearance: 'light',
      reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0,
      operationId: randomUUID(),
    },
  })).status()).toBe(200);
  return { id: account.accountId as string, headers };
}

async function circle(context: BrowserContext): Promise<CircleData> {
  const response = await context.request.get(`${base}/api/v1/circle`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

async function sharing(context: BrowserContext): Promise<SocialSettings> {
  const response = await context.request.get(`${base}/api/v1/sharing`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

async function setSharing(context: BrowserContext, actor: Awaited<ReturnType<typeof learner>>, changes: Partial<Omit<SocialSettings, 'revision'>>) {
  const { revision, ...previous } = await sharing(context);
  expect((await context.request.post(`${base}/api/v1/sharing`, {
    headers: actor.headers,
    data: { type: 'setSharing', ...previous, ...changes, expectedRevision: revision, operationId: randomUUID() },
  })).status()).toBe(200);
}

async function sharedProfile(context: BrowserContext, targetId: string) {
  const response = await context.request.get(`${base}/api/v1/profiles/${targetId}/shared`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

function expectNoProgress(profile: Record<string, unknown>) {
  expect(profile.weeklyTimeSeconds).toBeUndefined();
  expect(profile.courses).toBeUndefined();
}

test('explicitly private request senders remain reachable without granting follow-back or sharing private progress', async ({ page, context, browser }) => {
  test.setTimeout(150000);
  const senderContext = await browser.newContext({ baseURL: base });
  const strangerContext = await browser.newContext({ baseURL: base });
  try {
    const owner = await learner(context, 'Owner Study Partner');
    const sender = await learner(senderContext, 'Private Study Partner');
    await learner(strangerContext, 'Unconnected Learner');
    expect(await sharing(senderContext)).toMatchObject({ publicProfile: true, allowFollow: true, weeklyTime: true, courseProgress: true });
    await setSharing(senderContext, sender, { publicProfile: false, allowFollow: false, weeklyTime: false, courseProgress: false, bio: 'Private biography sentinel' });
    const privateSettings = await sharing(senderContext);

    expect((await senderContext.request.post(`${base}/api/v1/follow-requests`, {
      headers: sender.headers,
      data: { type: 'follow', targetId: owner.id, expectedRevision: 0, operationId: randomUUID() },
    })).status()).toBe(200);
    expect((await circle(context)).incoming).toEqual([
      expect.objectContaining({ profileId: sender.id, status: 'pending', canRequestFollow: false }),
    ]);
    const pendingProfile = await sharedProfile(context, sender.id);
    expect(pendingProfile).toMatchObject({ displayName: 'Private Study Partner', bio: '', canRequestFollow: false });
    expectNoProgress(pendingProfile);
    expect((await strangerContext.request.get(`${base}/api/v1/profiles/${sender.id}/shared`)).status()).toBe(404);

    await page.goto('/app/progress/circle');
    await page.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(page.getByText('Not accepting follow requests', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Follow back', exact: true })).toHaveCount(0);
    const accepted = await circle(context);
    expect(accepted.followers).toEqual([
      expect.objectContaining({ profileId: sender.id, status: 'accepted', canRequestFollow: false }),
    ]);
    expect(accepted.following).toHaveLength(0);
    expect(accepted.outgoing).toHaveLength(0);
    expect(await sharing(senderContext)).toEqual(privateSettings);

    await page.getByRole('link', { name: 'Private Study Partner', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Private Study Partner', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request to follow', exact: true })).toHaveCount(0);
    expectNoProgress(await sharedProfile(context, sender.id));
    // A known relationship permits a limited profile, not a bypass of the sender's request setting.
    expect((await context.request.post(`${base}/api/v1/follow-requests`, {
      headers: owner.headers,
      data: { type: 'follow', targetId: sender.id, expectedRevision: 0, operationId: randomUUID() },
    })).status()).toBe(404);

    await setSharing(senderContext, sender, { allowFollow: true });
    expect(await sharing(senderContext)).toMatchObject({ publicProfile: false, allowFollow: true, weeklyTime: false, courseProgress: false });
    expect((await strangerContext.request.get(`${base}/api/v1/profiles/${sender.id}/shared`)).status()).toBe(404);
    await page.goto('/app/progress/circle');
    await expect(page.getByRole('button', { name: 'Follow back', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Follow back', exact: true }).click();
    await expect.poll(async () => (await circle(context)).outgoing.length).toBe(1);
    expect((await circle(context)).following).toHaveLength(0);
    expectNoProgress(await sharedProfile(context, sender.id));

    const senderPage = await senderContext.newPage();
    await senderPage.goto('/app/progress/circle');
    await senderPage.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(senderPage.getByText('You follow each other', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh friends', exact: true }).click();
    await expect(page.getByText('You follow each other', { exact: true })).toBeVisible();
    expectNoProgress(await sharedProfile(context, sender.id));

    // Sharing flags and the accepted direction are both required; a private bio stays hidden.
    await setSharing(senderContext, sender, { bio: 'Private biography sentinel', weeklyTime: true, courseProgress: true });
    const mutualProfile = await sharedProfile(context, sender.id);
    expect(mutualProfile).toMatchObject({ bio: '', weeklyTimeSeconds: 0, courses: [] });
    expect((await strangerContext.request.get(`${base}/api/v1/profiles/${sender.id}/shared`)).status()).toBe(404);
    const followed = (await circle(context)).following.find(row => row.profileId === sender.id)!;
    expect(followed).toBeDefined();
    expect((await context.request.post(`${base}/api/v1/relationships/${followed.id}/revoke`, {
      headers: owner.headers,
      data: { type: 'revoke', relationshipId: followed.id, expectedRevision: followed.revision, operationId: randomUUID() },
    })).status()).toBe(200);
    const revokedProfile = await sharedProfile(context, sender.id);
    expect(revokedProfile.bio).toBe('');
    expectNoProgress(revokedProfile);
    expect((await circle(context)).followers).toHaveLength(1);

    // Blocking takes precedence over the remaining inbound connection and public visibility.
    expect((await senderContext.request.post(`${base}/api/v1/blocks`, {
      headers: sender.headers,
      data: { type: 'block', targetId: owner.id, expectedRevision: 0, operationId: randomUUID() },
    })).status()).toBe(200);
    expect((await context.request.get(`${base}/api/v1/profiles/${sender.id}/shared`)).status()).toBe(404);
    expect((await senderContext.request.get(`${base}/api/v1/profiles/${owner.id}/shared`)).status()).toBe(404);
    expect(await circle(context)).toEqual({ incoming: [], outgoing: [], following: [], followers: [] });
    expect(await circle(senderContext)).toEqual({ incoming: [], outgoing: [], following: [], followers: [] });
  } finally {
    await senderContext.close();
    await strangerContext.close();
  }
});

test('new accounts can follow back by default but progress still waits for acceptance', async ({ page, context, browser }) => {
  test.setTimeout(100000);
  const senderContext = await browser.newContext({ baseURL: base });
  try {
    const owner = await learner(context, 'Open Owner');
    const sender = await learner(senderContext, 'Open Sender');
    const defaults = { publicProfile: true, allowFollow: true, weeklyTime: true, courseProgress: true };
    expect(await sharing(context)).toMatchObject(defaults);
    expect(await sharing(senderContext)).toMatchObject(defaults);
    expectNoProgress(await sharedProfile(context, sender.id));
    expect((await senderContext.request.post(`${base}/api/v1/follow-requests`, {
      headers: sender.headers,
      data: { type: 'follow', targetId: owner.id, expectedRevision: 0, operationId: randomUUID() },
    })).status()).toBe(200);
    expect((await circle(context)).incoming).toEqual([
      expect.objectContaining({ profileId: sender.id, status: 'pending', canRequestFollow: true }),
    ]);

    await page.goto('/app/progress/circle');
    await page.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Follow back', exact: true })).toBeVisible();
    const accepted = await circle(context);
    expect(accepted.followers).toHaveLength(1);
    expect(accepted.following).toHaveLength(0);
    expectNoProgress(await sharedProfile(context, sender.id));
    // A rejected action must leave the existing connection visible and usable.
    await page.route('**/api/v1/follow-requests', route => route.fulfill({
      status: 404, json: { error: { code: 'NOT_FOUND' } },
    }));
    await page.getByRole('button', { name: 'Follow back', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Sender', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Follow back', exact: true })).toBeEnabled();
    expect((await circle(context)).followers).toHaveLength(1);
    expect((await circle(context)).outgoing).toHaveLength(0);
    await page.unroute('**/api/v1/follow-requests');
    await page.getByRole('button', { name: 'Follow back', exact: true }).click();
    await expect.poll(async () => (await circle(context)).outgoing.length).toBe(1);
    expect((await circle(context)).following).toHaveLength(0);
    expectNoProgress(await sharedProfile(context, sender.id));

    const senderPage = await senderContext.newPage();
    await senderPage.goto('/app/progress/circle');
    await senderPage.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(senderPage.getByText('You follow each other', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh friends', exact: true }).click();
    await expect(page.getByText('You follow each other', { exact: true })).toBeVisible();
    expect(await sharedProfile(context, sender.id)).toMatchObject({ weeklyTimeSeconds: 0, courses: [] });
    await page.getByRole('link', { name: 'Open Sender', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open Sender', exact: true })).toBeVisible();
    expect(await sharing(senderContext)).toMatchObject(defaults);
  } finally {
    await senderContext.close();
  }
});

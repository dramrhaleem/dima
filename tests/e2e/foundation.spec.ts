import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const accounts = JSON.parse(readFileSync(resolve(process.env.DIMA_BACKEND_ROOT ?? resolve(homedir(), '.local/state/dima-b0'), 'test-accounts.json'), 'utf8')) as {email:string;password:string}[];

test('real web login, persistent save, account switch, shared client and responsive views', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/dev/foundation');
  await expect(page.getByRole('heading', { name: 'Check the connection' })).toBeVisible();
  await page.getByLabel('Test email').fill(accounts[0].email);
  await page.getByLabel('Test password').fill(accounts[0].password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save check' })).toBeVisible();
  const label = `Browser persistence ${Date.now()}`;
  await page.getByLabel('Check label').fill(label);
  await page.getByRole('button', { name: 'Save check' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: label })).toBeVisible();
  await page.reload();
  // B0 intentionally keeps auth in memory: reauthenticate, then read durable data.
  await page.getByLabel('Test email').fill(accounts[0].email);
  await page.getByLabel('Test password').fill(accounts[0].password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Check label')).toHaveValue('My first saved check');
  await page.getByRole('button', { name: 'Reload saved checks' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: label })).toBeVisible();
  await page.getByLabel('Check label').fill('Account A unsaved private draft');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Test email').fill(accounts[1].email);
  await page.getByLabel('Test password').fill(accounts[1].password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Check label')).toHaveValue('My first saved check');
  await page.getByRole('button', { name: 'Reload saved checks' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: label })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Signed out');

  mkdirSync('.impeccable/review', { recursive: true });
  for (const [name,width,height] of [['desktop',1280,900],['mobile',375,920]] as const) {
    await page.setViewportSize({width,height});
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`.impeccable/review/${name}.png`,fullPage:true});
  }
  await page.setViewportSize({width:320,height:850});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.keyboard.press('Tab');

  await page.goto('http://127.0.0.1:4174');
  await expect(page.getByText('Standalone React client', {exact:true})).toBeVisible();
  await page.getByLabel('Test email').fill(accounts[0].email);
  await page.getByLabel('Test password').fill(accounts[0].password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Reload saved checks' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: label })).toBeVisible();
  expect(failures).toEqual([]);
});

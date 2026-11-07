import { expect, test, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const artifacts = process.env.DIMA_LANDING_ARTIFACTS ?? '/media/amro/Data2/dima-artifacts/landing-passive-2026-11-02';
const running = (locator: Locator) => locator.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length);

test('recovery is a finite journey that preserves the completed path through replay', async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const path = page.locator('[data-recovery-path]');
  await path.scrollIntoViewIfNeeded();
  await expect(path.locator('svg[role="img"]')).toBeVisible();
  await expect(path.locator('ol, ul, [data-recovery-choice]')).toHaveCount(0);
  const kept = await path.locator('.recovery-path-kept').getAttribute('d');
  const replay = path.getByRole('button', { name: 'Replay the journey' });
  await replay.focus();
  await page.keyboard.press('Enter');
  await expect(replay).toBeFocused();
  await expect.poll(() => running(path)).toBeGreaterThan(0);
  for (let index = 0; index < 3; index++) {
    await replay.click();
    expect(await running(path)).toBeLessThanOrEqual(2);
    expect(await path.locator('.recovery-path-kept').getAttribute('d')).toBe(kept);
  }
  expect(await path.evaluate(element => element.getAnimations({ subtree: true }).every(animation => {
    const timing = animation.effect?.getComputedTiming();
    return timing && timing.iterations === 1 && Number(timing.duration) <= 4000;
  }))).toBe(true);
  await expect.poll(() => running(path), { timeout: 8000 }).toBe(0);
  await replay.click();
  await expect.poll(() => running(path)).toBeGreaterThan(0);
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => running(path)).toBe(0);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test('ambient paths move only in view, respond subtly to the mouse and honor a saved pause', async ({ page }) => {
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const sections = page.locator('main > section');
  const first = sections.first();
  const layer = first.locator('.dima-ambient-layer');
  const field = first.locator('.dima-ambient-field');
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
  await expect(layer).toHaveCSS('pointer-events', 'none');
  await expect(layer).toHaveAttribute('data-ambient-active', 'true');
  const traveler = first.locator('.dima-ambient-traveler').first();
  const offset = await traveler.evaluate(element => getComputedStyle(element).strokeDashoffset);
  await expect.poll(() => traveler.evaluate(element => getComputedStyle(element).strokeDashoffset)).not.toBe(offset);
  const lastLayer = sections.last().locator('.dima-ambient-layer');
  await expect(lastLayer).toHaveAttribute('data-ambient-active', 'false');
  expect(await running(lastLayer)).toBe(0);
  const box = await first.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .1, Math.min(700, box!.y + box!.height * .35));
  await expect.poll(() => field.evaluate(element => getComputedStyle(element).transform)).not.toBe('none');
  const translation = await field.evaluate(element => { const matrix = new DOMMatrix(getComputedStyle(element).transform); return [matrix.e, matrix.f]; });
  expect(translation.some(value => Math.abs(value) > .05)).toBe(true);
  expect(translation.every(value => Math.abs(value) <= 6)).toBe(true);
  await page.mouse.move(10, 10);
  await expect(field).toHaveCSS('transform', 'none');
  const pause = page.locator('[data-ambient-toggle]');
  await pause.scrollIntoViewIfNeeded();
  await expect(layer).toHaveAttribute('data-ambient-active', 'false');
  expect(await running(layer)).toBe(0);
  await pause.click();
  await expect(pause).toHaveText('Resume background motion');
  await expect(page.locator('.dima-ambient-layer[data-ambient-active="true"]')).toHaveCount(0);
  expect(await page.locator('.dima-ambient-layer').evaluateAll(layers => layers.flatMap(layer => layer.getAnimations({ subtree: true })).filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ambient-paused', 'true');
  await expect(pause).toHaveText('Resume background motion');
  await pause.click();
  await page.evaluate(() => scrollTo(0, 0));
  await expect(layer).toHaveAttribute('data-ambient-active', 'true');
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('path and backgrounds stay readable in both themes, reduced motion and without scripts', async ({ page, browser }) => {
  mkdirSync(artifacts, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const path = page.locator('[data-recovery-path]');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Dark mode', exact: true }).first().click();
      await path.scrollIntoViewIfNeeded();
      await expect(path.locator('svg[role="img"]')).toBeVisible();
      await path.getByRole('button', { name: 'Replay the journey' }).click();
      expect(await running(path)).toBe(0);
      await expect(page.locator('.dima-ambient-layer[data-ambient-active="true"]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `${artifacts}/recovery-${width}-${theme}.png` });
    }
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
  try {
    const fallback = await context.newPage();
    await fallback.goto('http://127.0.0.1:8787/');
    const staticPath = fallback.locator('[data-recovery-path]');
    await staticPath.scrollIntoViewIfNeeded();
    await expect(staticPath.locator('svg[role="img"]')).toBeVisible();
    await expect(staticPath).toContainText('What you’ve done stays.');
    await expect(staticPath.locator('[data-path-replay]')).toBeHidden();
    await expect(staticPath.locator('.recovery-path-ahead')).toHaveCSS('stroke-dashoffset', '0px');
    expect(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});

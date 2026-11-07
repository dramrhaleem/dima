import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const artifacts = process.env.DIMA_LANDING_ARTIFACTS ?? '/media/amro/Data2/dima-artifacts/landing-refresh-2026-11-02';

async function expectNoOverflow(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: horizontal overflow`).toBe(true);
  const clipped = await page.locator('main button, .site-header a, .hero-actions a').evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    // Measure the visible label, excluding decorative icons that may rotate past the button box.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || node.parentElement?.closest('[aria-hidden="true"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(rect => rect.width > 0 && (rect.left < box.left - 2 || rect.right > box.right + 2))) return true;
    }
    return false;
  }).map(element => element.textContent?.trim()));
  expect(clipped, `${label}: clipped control labels`).toEqual([]);
}

test('landing reflows at 100% and remains readable on a wide display', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 2160, height: 1215 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoOverflow(page, String(viewport.width));
    const sizes = await page.evaluate(() => {
      const fontSize = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
      return {
        zoom: getComputedStyle(document.body).zoom,
        scale: window.visualViewport?.scale,
        body: fontSize('.hero-copy > p'),
        nav: fontSize('.site-header nav a[href="/library"]'),
        button: fontSize('.hero-actions .button'),
        sample: fontSize('.dp-task strong'),
      };
    });
    expect(sizes.zoom).toBe('1');
    expect(sizes.scale).toBe(1);
    if (viewport.width === 2160) {
      expect(sizes.body).toBeGreaterThanOrEqual(18);
      expect(sizes.nav).toBeGreaterThanOrEqual(16);
      expect(sizes.button).toBeGreaterThanOrEqual(16);
      expect(sizes.sample).toBeGreaterThanOrEqual(14);
    }
    await page.screenshot({ path: `${artifacts}/landing-${viewport.width}.png`, fullPage: true });
  }
});

test('landing samples respond to real actions and keyboard tab navigation', async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const hero = page.locator('dima-preview-switcher');
  await hero.getByRole('checkbox', { name: /Explore the project life cycle/ }).check();
  await expect(hero.locator('[data-progress-label]')).toHaveText('1 of 2 sample tasks complete');
  await expect(page.locator('[data-hero-win]')).toHaveText('One small step. A real start.');
  await hero.getByRole('tab', { name: 'Learn', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(hero.getByRole('tab', { name: 'Plan', exact: true })).toBeFocused();
  await hero.getByRole('checkbox', { name: 'Tuesday', exact: true }).check();
  await expect(hero.locator('[data-days-count]')).toHaveText('4 days');

  const community = page.locator('[data-social-demo]');
  await community.scrollIntoViewIfNeeded();
  await expect(community.locator('[data-you-percent]')).toHaveText('25%');
  for (const value of [50, 75, 100]) {
    await community.getByRole('button', { name: 'Complete a sample step', exact: true }).click();
    await expect(community.locator('[data-you-percent]')).toHaveText(`${value}%`);
  }
  await expect(community.locator('[data-ensemble-step]')).toBeDisabled();
  await expect(community.locator('[data-ensemble-status]')).toContainText('Example complete');
  await community.getByRole('button', { name: 'Reset example', exact: true }).click();
  await expect(community.locator('[data-you-percent]')).toHaveText('25%');
  await expect(community.locator('[data-ensemble-step]')).toBeEnabled();
  await community.getByRole('tab', { name: 'Course progress', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(community.getByRole('tab', { name: 'Shared focus', exact: true })).toBeFocused();
  await expect(community.getByRole('tabpanel', { name: 'Shared focus', exact: true })).toBeVisible();
  await community.getByRole('button', { name: 'Start 30-second preview', exact: true }).click();
  await expect(community.getByRole('button', { name: 'Pause preview', exact: true })).toBeVisible();
  await expect(community.locator('[data-ensemble-clock]')).toHaveText(/00:2\d/);
  await community.getByRole('tab', { name: 'Shared focus', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(community.getByRole('tab', { name: 'Course progress', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(community.getByRole('button', { name: 'Resume preview', exact: true })).toBeVisible();
  await expect(community.locator('[data-ensemble-timer-status]')).toContainText('Preview paused');
  await community.getByRole('button', { name: 'Reset timer', exact: true }).click();
  await expect(community.locator('[data-ensemble-clock]')).toHaveText('00:30');
  await expectNoOverflow(page, 'community focus');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => {
    const effect = animation.effect;
    const target = effect instanceof KeyframeEffect ? effect.target : null;
    return effect?.getComputedTiming().iterations === Infinity && !(target instanceof Element && target.closest('.dima-ambient-layer'));
  }).length)).toBe(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('landing examples and navigation remain usable with reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-dima-motion-allowed', 'false');
  const hero = page.locator('dima-preview-switcher');
  await hero.getByRole('tab', { name: 'Recover', exact: true }).click();
  await hero.getByRole('button', { name: 'Preview this change', exact: true }).click();
  await expect(hero.locator('[data-recovery-status]')).toContainText('target moved by one day');
  const community = page.locator('[data-social-demo]');
  await community.getByRole('button', { name: 'Complete a sample step', exact: true }).click();
  await expect(community.locator('[data-you-percent]')).toHaveText('50%');
  await community.getByRole('tab', { name: 'Shared focus', exact: true }).click();
  await community.getByRole('button', { name: 'Start 30-second preview', exact: true }).click();
  await community.getByRole('button', { name: 'Pause preview', exact: true }).click();
  await expect(community.getByRole('button', { name: 'Resume preview', exact: true })).toBeVisible();
  await expectNoOverflow(page, 'mobile recovery');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  await expect(page.getByRole('link', { name: 'Explore study rooms', exact: true })).toHaveAttribute('href', '/app/rooms');
  await expect(page.getByRole('link', { name: 'Find study partners', exact: true })).toHaveAttribute('href', '/app/progress/circle');
  await page.getByRole('link', { name: 'Browse the library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

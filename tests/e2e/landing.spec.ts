import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';

const artifacts = process.env.DIMA_LANDING_ARTIFACTS ?? '/media/amro/Data2/dima-artifacts/landing-refresh-2026-11-02';

test('landing: keyboard sample journey, finite default motion, reduced motion and responsive links', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await expect(page.locator('dima-preview-switcher [role="tab"]')).toHaveCount(3);
  await expect(page.locator('[data-motion-toggle]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-dima-motion-allowed','true');
  await expect(page.locator('.hero-stage')).toHaveAttribute('data-arrived','true');
  await page.getByRole('checkbox', {name:/Explore the project life cycle/}).check();
  await expect(page.getByText('1 of 2 sample tasks complete')).toBeVisible();
  await page.getByRole('tab',{name:'Learn',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Plan',exact:true})).toBeFocused();
  await page.getByLabel('Tuesday',{exact:true}).check();
  await expect(page.getByText('4 days',{exact:true})).toBeVisible();
  await page.keyboard.press('Tab');
  await page.getByRole('tab',{name:'Plan',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button',{name:'Preview this change'}).click();
  await expect(page.getByRole('status')).toContainText('target moved by one day');
  await page.getByRole('tab',{name:'Learn',exact:true}).click();
  await expect(page.getByText('1 of 2 sample tasks complete')).toBeVisible();
  await expect(page.locator('[data-library-link]').nth(0)).toHaveAttribute('href','/library/google-project-management');
  await expect(page.locator('[data-library-link]').nth(1)).toHaveAttribute('href','/library/cs50-business');
  await expect(page.getByText('Seed offering · Outline review pending')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Explore study rooms'})).toHaveAttribute('href','/app/rooms');
  await expect(page.getByRole('link',{name:'Find study partners'})).toHaveAttribute('href','/app/progress/circle');
  await expect(page.locator('.dima-origin blockquote [lang="ar"]')).toHaveText('«كَانَ عَمَلُهُ دِيمَةً»');
  await expect(page.locator('.dima-origin figcaption')).toContainText('ʿAisha, describing the Prophet');
  await expect(page.locator('.dima-origin a')).toHaveAttribute('href','https://sunnah.com/bukhari:6466');
  // A no-toggle landing must not leave decorative animations repeating forever.
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(artifacts,{recursive:true});
  await page.locator('.hero').screenshot({path:`${artifacts}/landing-hero-desktop.png`});
  await page.locator('.together-demo').scrollIntoViewIfNeeded();
  await expect(page.locator('.together-demo [data-you-percent]')).toHaveText('25%');
  await page.locator('.together-section').screenshot({path:`${artifacts}/landing-together-desktop.png`});
  await page.locator('.closing-section').screenshot({path:`${artifacts}/landing-origin-desktop.png`});
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({path:`${artifacts}/landing-hero-${width}.png`,fullPage:true});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dima-motion-allowed','false');
  await page.getByRole('tab',{name:'Recover',exact:true}).click();
  await page.getByRole('button',{name:'Preview this change'}).click();
  await expect(page.getByRole('status')).toContainText('Sample updated');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.goto('/library/google-project-management');
  const signIn = page.locator('header').getByRole('link', {name:'Sign in', exact:true});
  await expect(signIn).toHaveAttribute('href', '/auth?next=%2Flibrary%2Fgoogle-project-management');
  await signIn.click();
  await expect(page.getByRole('heading', {name:'Welcome to Dima', exact:true})).toBeVisible();
  await expect(page).toHaveURL(/next=%2Flibrary%2Fgoogle-project-management/);
  expect(errors).toEqual([]);
});

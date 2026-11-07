import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
const base='http://127.0.0.1:8787';
test('B6 essential UI: navigation, private sharing choices, empty states and compact layouts',async({page,context})=>{
 test.setTimeout(100000);
 const email=`b6-ui-${randomUUID()}@example.test`,after=Date.now();
 const sent=await context.request.post(`${base}/api/v1/auth/otp`,{headers:{Origin:base},data:{email,next:'/app/progress'}});expect(sent.status()).toBe(200);
 const token=await waitForLocalOtp(email,{after});
 expect((await context.request.post(`${base}/api/v1/auth/verify`,{headers:{Origin:base},data:{email,token,next:'/app/progress'}})).status()).toBe(200);
 const account=(await(await context.request.get(`${base}/api/v1/me`)).json()).data;
 expect((await context.request.patch(`${base}/api/v1/me`,{headers:{Origin:base,'X-Dima-Account-Id':account.accountId},data:{displayName:'Alex Learning',timezone:'Africa/Cairo',intent:'learning',appearance:'light',reducedMotion:true,onboarded:true,expectedRevision:account.profile?.revision??0,operationId:randomUUID()}})).status()).toBe(200);
 mkdirSync('.impeccable/review',{recursive:true});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 for(const [path,selector,name] of [
  ['/app/progress','.community-root','progress'],
  ['/app/progress/circle','.community-root','circle'],
  ['/app/progress/leaderboards','.community-root','leaderboards'],
  ['/app/progress/sharing','.community-root','sharing'],
  ['/app/contributions','.community-root','contributions'],
  ['/app/notifications','.community-root','notifications'],
  ['/app/settings','.settings-layout','settings'],
 ] as const){
  await page.goto(path);await expect(page.locator(selector)).toBeVisible();
  await expect(page.locator('.community-pending')).toHaveCount(0);
  await page.evaluate(async()=>{await document.fonts.ready;});
  await expect(page.getByRole('alert').filter({hasText:/\S/})).toHaveCount(0);
  if(name==='circle'){
   await expect(page.getByRole('textbox',{name:'Your personal link',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Enable requests & copy link',exact:true})).toBeVisible();
   await expect(page.getByRole('heading',{name:'Requests for you',exact:true})).toHaveCount(0);
  }
  if(name==='sharing'){
   const visible=page.getByLabel('Let signed-in people find my name and bio',{exact:true});
   await visible.check();await page.getByRole('button',{name:'Save sharing choices',exact:true}).click();
   await expect(page.getByText('Sharing choices saved.',{exact:true})).toBeVisible();
   expect((await(await context.request.get(`${base}/api/v1/sharing`)).json()).data.publicProfile).toBe(true);
   await page.reload();await expect(visible).toBeChecked();
   await visible.uncheck();await page.getByRole('button',{name:'Save sharing choices',exact:true}).click();
   await expect(page.getByText('Sharing choices saved.',{exact:true})).toBeVisible();
  }
  if(name==='leaderboards'){
   await expect(page.getByText('Leaderboard visibility is on',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Hide me from this leaderboard',exact:true}).click();
   await expect(page.getByText('You’re hidden from this leaderboard',{exact:true})).toBeVisible();
   await page.reload();
   await expect(page.getByRole('button',{name:'Show me on this leaderboard',exact:true})).toBeVisible();
   await page.getByRole('combobox',{name:'Window',exact:true}).selectOption('month');
   await expect(page.getByText('You’re hidden from this leaderboard',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Show me on this leaderboard',exact:true}).click();
   await expect(page.getByRole('button',{name:'Hide me from this leaderboard',exact:true})).toBeVisible();
  }
  await page.setViewportSize({width:1280,height:920});await page.screenshot({path:`.impeccable/review/b6-${name}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.impeccable/review/b6-${name}-compact.png`,fullPage:true});
 }
 // A period change inside a course board must retain that course, not silently show global time.
 const discovery = (await (await context.request.get(`${base}/api/v1/leaderboards/time?period=week&category=all`)).json()).data;
 const scope = discovery.scopes.find((value: { offeringId: string }) => value.offeringId === 'google-project-management');
 expect(scope).toBeTruthy();
 await page.goto(`/app/progress/leaderboards?offering=${scope.offeringId}`);
 await expect(page.getByRole('combobox', { name: 'Leaderboard', exact: true })).toHaveValue(scope.id);
 await expect(page.getByRole('combobox', { name: 'Window', exact: true })).toHaveValue('overall');
 await page.getByRole('combobox', { name: 'Window', exact: true }).selectOption('week');
 await page.getByRole('combobox', { name: 'Window', exact: true }).selectOption('overall');
 await expect(page).toHaveURL(new RegExp(`scope=${encodeURIComponent(scope.id)}`));
 await expect(page.getByRole('combobox', { name: 'Leaderboard', exact: true })).toHaveValue(scope.id);
 await expect(page.getByRole('combobox', { name: 'Window', exact: true })).toHaveValue('overall');
 await expect(page.getByRole('combobox', { name: 'Activity', exact: true })).toHaveCount(0);
 await page.reload();
 await expect(page.getByRole('combobox', { name: 'Leaderboard', exact: true })).toHaveValue(scope.id);
 await page.getByRole('combobox', { name: 'Leaderboard', exact: true }).selectOption('');
 await expect(page.getByRole('combobox', { name: 'Activity', exact: true })).toBeVisible();
 await expect(page.getByRole('combobox', { name: 'Window', exact: true })).toHaveValue('week');
 // Course intent must never expose the global opt-in while its scope is unresolved.
 let release!: () => void;
 const held = new Promise<void>(resolve => { release = resolve; });
 await page.route('**/api/v1/leaderboards/time?**', async route => { await held; await route.continue(); });
 await page.goto('/app/progress/leaderboards?offering=missing-course');
 await expect(page.getByRole('heading', { name: 'Course leaderboard', exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Show me on this leaderboard' })).toHaveCount(0);
 release();
 await expect(page.getByText(/This course has no comparable public scope yet/)).toBeVisible();
 await expect(page.getByRole('button', { name: 'Show me on this leaderboard' })).toHaveCount(0);
 await page.unroute('**/api/v1/leaderboards/time?**');
 const memberId = randomUUID();
 const pending = { id: randomUUID(), profileId: memberId, displayName: 'Practice Partner', status: 'pending', revision: 1 };
 await page.route(`**/api/v1/profiles/${memberId}/shared`, route => route.fulfill({ json: { data: { profileId: memberId, displayName: 'Practice Partner', bio: '', courses: [{ scopeId: scope.id, title: 'Google Project Management', completedWeight: 25, requiredWeight: 100 }] } } }));
 await page.route('**/api/v1/circle', route => route.fulfill({ json: { data: { incoming: [], outgoing: [pending], following: [], followers: [] } } }));
 await page.goto(`/app/progress/members/${memberId}`);
 await expect(page.getByRole('link', { name: 'Request pending · Manage in Friends' })).toBeVisible();
 await expect(page.getByText('25% complete',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Compare course progress',exact:true})).toHaveAttribute('href',`/app/progress/leaderboards?scope=${encodeURIComponent(scope.id)}&period=overall`);
 await expect(page.getByRole('button', { name: 'Request to follow', exact: true })).toHaveCount(0);
 expect(errors).toEqual([]);
});

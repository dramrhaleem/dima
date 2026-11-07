import {test,expect,type BrowserContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {waitForLocalOtp} from '../helpers/local-mail.mjs';
const base='http://127.0.0.1:8787',origin={Origin:base};
async function setup(context:BrowserContext){const email=`avatar-${randomUUID()}@example.test`,after=Date.now();expect((await context.request.post(`${base}/api/v1/auth/otp`,{headers:origin,data:{email,next:'/app/settings'}})).status()).toBe(200);const token=await waitForLocalOtp(email,{after});expect((await context.request.post(`${base}/api/v1/auth/verify`,{headers:origin,data:{email,token,next:'/app/settings'}})).status()).toBe(200);const initial=(await(await context.request.get(`${base}/api/v1/me`)).json()).data;expect((await context.request.patch(`${base}/api/v1/me`,{headers:{...origin,'X-Dima-Account-Id':initial.accountId},data:{displayName:'Photo Learner',timezone:'UTC',intent:'learning',appearance:'light',reducedMotion:true,onboarded:true,expectedRevision:0,operationId:randomUUID()}})).status()).toBe(200);return{id:initial.accountId as string,email};}
function fixture(id:string,email:string,sql:string){expect(id).toMatch(/^[a-f0-9-]{36}$/);expect(email).toMatch(/^avatar-[a-f0-9-]+@example\.test$/);const container=spawnSync('docker',['inspect','dima-b0-db','--format','{{index .Config.Labels "com.docker.compose.project"}}'],{encoding:'utf8'});expect(container.stdout.trim()).toBe('dima-b0');const result=spawnSync('docker',['exec','-i','dima-b0-db','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],{encoding:'utf8',input:`DO $test$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${id}' AND email='${email}') THEN RAISE EXCEPTION 'Synthetic account required';END IF; ${sql} END $test$;`});expect(result.status,result.stderr).toBe(0);}
test('profile name, Google default, custom photo replay, and removal persist safely',async({page,context,browser})=>{
 test.setTimeout(120000);const account=await setup(context);
 fixture(account.id,account.email,`UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{"avatar_url":"https://lh3.googleusercontent.com/a/synthetic-photo"}'::jsonb WHERE id='${account.id}';`);
 let me=(await(await context.request.get(`${base}/api/v1/me`)).json()).data;
 expect(me.profile.avatarMode).toBe('google');expect(me.profile.avatarUrl).toContain(`/profiles/${account.id}/avatar`);
 const google=await context.request.get(`${base}${me.profile.avatarUrl}`,{maxRedirects:0});expect(google.status()).toBe(302);expect(google.headers().location).toBe('https://lh3.googleusercontent.com/a/synthetic-photo');
 await page.route('https://lh3.googleusercontent.com/**',route=>route.abort());
 await page.goto('/app/settings#profile');
 await expect(page.getByRole('heading',{name:'Your profile photo',exact:true})).toBeVisible();
 await page.getByLabel('What should we call you?',{exact:true}).fill('Updated Learner');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByText('Changes saved.',{exact:true})).toBeVisible();
 const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d')!;x.fillStyle='#004cff';x.fillRect(0,0,64,64);return c.toDataURL('image/jpeg');});
 await page.getByLabel('Choose profile photo',{exact:true}).setInputFiles({name:'avatar.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpeg.split(',')[1],'base64')});
 const operationIds:string[]=[];let lost=false;
 await page.route('**/api/v1/me/avatar',async route=>{if(route.request().method()==='PATCH'){operationIds.push(route.request().postDataJSON().operationId);if(!lost){lost=true;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');return;}}await route.continue();});
 await page.getByRole('button',{name:'Save photo',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'Save photo',exact:true}).click();
 await expect(page.getByText('Profile photo saved.',{exact:true})).toBeVisible();expect(operationIds).toHaveLength(2);expect(operationIds[0]).toBe(operationIds[1]);await page.unroute('**/api/v1/me/avatar');
 me=(await(await context.request.get(`${base}/api/v1/me`)).json()).data;expect(me.profile.avatarMode).toBe('custom');expect(me.profile.avatarRevision).toBe(1);expect(me.profile.displayName).toBe('Updated Learner');
 const photo=await context.request.get(`${base}${me.profile.avatarUrl}`);expect(photo.status()).toBe(200);expect(photo.headers()['content-type']).toBe('image/jpeg');
 expect((await context.request.get(`${base}${me.profile.avatarUrl}`,{headers:{'If-None-Match':photo.headers().etag}})).status()).toBe(304);
 const peerContext=await browser.newContext();try{const peer=await setup(peerContext);expect(peer.id).toMatch(/^[a-f0-9-]{36}$/);expect((await peerContext.request.get(`${base}${me.profile.avatarUrl}`)).status()).toBe(200);fixture(account.id,account.email,`INSERT INTO public.user_blocks(blocker_id,blocked_id,created_at) VALUES('${account.id}','${peer.id}',now());`);expect((await peerContext.request.get(`${base}${me.profile.avatarUrl}`,{headers:{'If-None-Match':photo.headers().etag}})).status()).toBe(404);}finally{await peerContext.close();}
 const anonymous=await browser.newContext();try{expect((await anonymous.request.get(`${base}${me.profile.avatarUrl}`)).status()).toBe(401);}finally{await anonymous.close();}
 expect((await context.request.patch(`${base}/api/v1/me/avatar`,{headers:{...origin,'X-Dima-Account-Id':account.id},data:{mode:'custom',data:'https://example.com/image',expectedRevision:1,operationId:randomUUID()}})).status()).toBe(422);
 fixture(account.id,account.email,`UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{"avatar_url":"https://lh3.googleusercontent.com/a/changed-photo"}'::jsonb WHERE id='${account.id}';`);
 await page.reload();await expect(page.getByRole('heading',{name:'Your profile photo'})).toBeVisible();me=(await(await context.request.get(`${base}/api/v1/me`)).json()).data;expect(me.profile.avatarMode).toBe('custom');
 mkdirSync('.impeccable/review',{recursive:true});for(const width of[1280,390]){await page.setViewportSize({width,height:920});await page.screenshot({path:`.impeccable/review/profile-avatar-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.getByRole('button',{name:'Remove photo',exact:true}).click();await page.getByRole('button',{name:'Save photo',exact:true}).click();await expect(page.getByText('Profile photo saved.',{exact:true})).toBeVisible();await page.reload();me=(await(await context.request.get(`${base}/api/v1/me`)).json()).data;expect(me.profile.avatarMode).toBe('none');expect(me.profile.avatarUrl).toBe(null);
 expect((await context.request.get(`${base}/api/v1/profiles/${account.id}/avatar`)).status()).toBe(404);
});

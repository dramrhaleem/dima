// Bounded local RPC acceptance for public consent, blocks, unique handles and future rhythm goals.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readEnv,runtimeRoot,clientEnvPath} from '../../scripts/local-backend/env.mjs';
const env=readEnv(clientEnvPath),admin=readEnv(resolve(runtimeRoot,'server.env')).SUPABASE_SERVICE_ROLE_KEY;
assert.equal(env.SUPABASE_URL,'http://127.0.0.1:54321');
const fixtures=[],results=[],run=randomUUID();
const ah={apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json'};
function sql(query){const r=spawnSync('docker',['exec','-i','dima-b0-db','psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
async function rpc(actor,name,args={},status=200){const r=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:`Bearer ${actor?.token??env.SUPABASE_ANON_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(args)});const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;}
const command=(type,rest={})=>({operationId:randomUUID(),expectedRevision:0,type,...rest});
try{
 for(const label of ['a','b']){
  const email=`profile-rhythm-${run}-${label}@example.test`,password=randomBytes(24).toString('base64url');
  const cr=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers:ah,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(cr.status,200);const u=await cr.json();
  fixtures.push({id:u.id,email});
  const r=await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);fixtures.at(-1).token=(await r.json()).access_token;
  assert.match(u.id,/^[a-f0-9-]{36}$/);sql(`INSERT INTO public.account_profiles(user_id,display_name,onboarded,timezone,intent,revision) SELECT '${u.id}','Profile fixture ${label}',true,'Pacific/Kiritimati','learning',1 WHERE EXISTS(SELECT 1 FROM auth.users WHERE id='${u.id}' AND email='${email}');`);
 }
 const [a,b]=fixtures;const handle=`test-${run.slice(0,12)}`;
 let prefs=await rpc(a,'read_profile_settings');assert.equal(prefs.publicLink,false);assert.equal(prefs.currentGoal,null);
 await rpc(null,'read_public_profile',{p_handle:handle},404);
 // Old signed-in discovery choice cannot grant anonymous consent.
 sql(`INSERT INTO public.social_settings(user_id,public_profile,bio) VALUES('${a.id}',true,'Signed-in bio');`);
 await rpc(null,'read_public_profile',{p_handle:handle},404);
 const c=command('setPublicLink',{handle:handle.toUpperCase(),publicLink:true,bio:'A chosen public introduction.',consentVersion:1});
 prefs=(await rpc(a,'execute_profile_settings',{p_command:c})).data;
 assert.equal(prefs.handle,handle);const visible=await rpc(null,'read_public_profile',{p_handle:handle});assert.deepEqual(Object.keys(visible).sort(),['bio','displayName','handle']);
 const replay=await rpc(a,'execute_profile_settings',{p_command:c});assert.equal(replay.replayed,true);assert.equal(replay.data.revision,1);
 await rpc(b,'execute_profile_settings',{p_command:command('setPublicLink',{handle,publicLink:true,bio:'',consentVersion:1})},409);
 await rpc(b,'execute_profile_settings',{p_command:command('setPublicLink',{handle:'admin',publicLink:true,bio:'',consentVersion:1})},422);
 results.push('Public link defaults off, explicit consent returns only three public fields; handles normalized, unique and reserved names rejected');
 sql(`UPDATE public.social_settings SET public_profile=false,allow_follow=true WHERE user_id='${a.id}';`);
 const followed=await rpc(b,'follow_public_handle',{p_command:command('follow',{targetId:handle.toUpperCase()})});assert.equal(followed.data.outgoing[0].profileId,a.id);
 results.push('Public handle resolves a Circle follow request without anonymous ID disclosure; separate follow permission is preserved');
 await rpc(a,'execute_social',{p_command:command('block',{targetId:b.id})});await rpc(b,'read_public_profile',{p_handle:handle},404);await rpc(b,'follow_public_handle',{p_command:command('follow',{targetId:handle})},404);assert.equal((await rpc(null,'read_public_profile',{p_handle:handle})).handle,handle);
 prefs=(await rpc(a,'execute_profile_settings',{p_command:command('setPublicLink',{expectedRevision:prefs.revision,handle,publicLink:false,bio:'',consentVersion:1})})).data;
 await rpc(null,'read_public_profile',{p_handle:handle},404);results.push('Signed-in blocks enforced; revoking public consent immediately returns unavailable');
 prefs=(await rpc(a,'execute_profile_settings',{p_command:command('setRhythmGoal',{expectedRevision:prefs.revision,days:4})})).data;
 assert.equal(prefs.currentGoal,null);assert.equal(prefs.nextGoal.days,4);assert.equal(prefs.nextGoal.effectiveWeek,prefs.nextEffectiveWeek);
 await rpc(a,'execute_profile_settings',{p_command:command('setRhythmGoal',{expectedRevision:prefs.revision,days:0})},422);
 sql(`INSERT INTO public.rhythm_goal_versions(user_id,effective_week,days) VALUES('${a.id}',(date_trunc('week',now() AT TIME ZONE 'UTC'))::date,2);`);
 prefs=await rpc(a,'read_profile_settings');assert.equal(prefs.currentGoal.days,2);
 prefs=(await rpc(a,'execute_profile_settings',{p_command:command('setRhythmGoal',{expectedRevision:prefs.revision,days:null})})).data;
 assert.equal(prefs.currentGoal.days,2);assert.equal(prefs.nextGoal.days,null);assert.equal((await rpc(b,'read_profile_settings')).currentGoal,null);
 const source=readFileSync('apps/web/src/server/progress.ts','utf8');assert.ok(source.includes('c.firstCompletedAt.slice(0,10)'));
 const def=sql("SELECT pg_get_functiondef('public.read_progress_time(timestamptz,timestamptz)'::regprocedure);");assert.ok(def.includes("tz='UTC'"));
 const start=new Date();start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));const end=new Date(start);end.setUTCDate(end.getUTCDate()+7);
 const time=await rpc(a,'read_progress_time',{p_start:start.toISOString(),p_end:end.toISOString()});assert.ok(time.activeDays.length<=7);
 results.push('Weekly goal changes only next UTC week; current historical target remains unchanged and another account sees no goal');
 for(const table of ['profile_preferences','rhythm_goal_versions']){
  const r=await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`,{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:`Bearer ${b.token}`}});assert.ok([401,403].includes(r.status));
 }
 results.push('Direct table reads denied; owner-scoped authenticated RPCs only');
 console.log(JSON.stringify({ok:true,results}));
 writeFileSync('docs/evidence/B6_PROFILE_RHYTHM.json',JSON.stringify({at:new Date().toISOString(),run,ok:true,scope:'Focused local Auth/PostgREST database checks; UI and hosted checks separate',results},null,2)+'\n');
}finally{for(const a of fixtures){const r=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${a.id}`,{method:'DELETE',headers:ah});assert.ok(r.ok,'Synthetic account cleanup');}}

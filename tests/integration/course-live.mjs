// Local-only cohort acceptance: real learning commands, explicit sharing and current-policy reads.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
const base=process.env.DIMA_TEST_API??'http://127.0.0.1:8787';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const env=readEnv(clientEnvPath);assert.equal(env.SUPABASE_URL,'http://127.0.0.1:54321');
const admin=readEnv(resolve(runtimeRoot,'server.env')).SUPABASE_SERVICE_ROLE_KEY;
const headers={apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json'};
const run=randomUUID(),fixtures=[],passed=[];
async function req(actor,path,method='GET',body,status=200,extra={}){
 const r=await fetch(`${base}/api/v1/${path}`,{method,headers:{...(actor?{Authorization:`Bearer ${actor.token}`,'X-Dima-Account-Id':actor.id}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const value=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(value)}`);return value;
}
const command=(type,rest={})=>({type,operationId:randomUUID(),expectedRevision:0,...rest});
const check=label=>{passed.push(label);console.log(`PASS ${label}`);};
try{
 for(const label of ['a','b','outsider']){
  const email=`course-live-${run}-${label}@example.test`,password=randomBytes(24).toString('base64url');
  const created=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);const u=await created.json();assert.equal(u.email,email);
  const f={id:u.id,email};fixtures.push(f);
  const login=await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);f.token=(await login.json()).access_token;
  await req(f,'me','PATCH',{displayName:`Course live ${label}`,timezone:'UTC',intent:'learning',appearance:'light',reducedMotion:true,onboarded:true,expectedRevision:0,operationId:randomUUID()});
 }
 const [a,b,outsider]=fixtures;
 const course=(await req(null,'catalog/google-project-management')).data;
 const tasks=course.courses.flatMap(c=>c.modules.flatMap(m=>m.tasks)).filter(t=>t.requirement==='required').slice(0,3);
 const target=new Date();target.setUTCDate(target.getUTCDate()+60);
 let learningA=(await req(a,'learning','POST',command('enroll',{offeringId:course.id,taskIds:tasks.map(t=>t.id),priorTaskIds:[],targetDate:target.toISOString().slice(0,10)}))).data;
 await req(b,'learning','POST',command('enroll',{offeringId:course.id,taskIds:tasks.map(t=>t.id),priorTaskIds:[tasks[0].id],targetDate:target.toISOString().slice(0,10)}));
 const path=`courses/${course.id}/live?version=${encodeURIComponent(course.version)}`;
 await req(null,path,'GET',undefined,401);await req(outsider,path,'GET',undefined,404);
 await req(a,path,'GET',undefined,409,{'X-Dima-Account-Id':b.id});
 await req(a,`courses/${course.id}/live?version=unrelated-version`,'GET',undefined,404);
 let snapshot=(await req(a,path)).data;assert.equal(snapshot.sharing.enabled,false);assert.deepEqual(snapshot.rows,[]);
 check('Unauthenticated, unrelated-course, wrong-version and changed-account reads blocked; granular sharing defaults off');
 const aConsent=command('setCourseLiveSharing',{enabled:true});
 snapshot=(await req(a,path,'POST',aConsent)).data;assert.equal(snapshot.sharing.revision,1);assert.deepEqual(snapshot.rows.map(r=>r.profileId),[a.id]);
 const replay=await req(a,path,'POST',aConsent);assert.equal(replay.replayed,true);assert.equal(replay.data.sharing.revision,1);
 await req(a,path,'POST',{...aConsent,enabled:false},409);
 await req(a,path,'POST',command('setCourseLiveSharing',{enabled:false}),409);
 await req(a,path,'POST',command('setCourseLiveSharing',{enabled:false,expectedRevision:1}),403,{Origin:'https://foreign.example'});
 await req(b,path,'POST',command('setCourseLiveSharing',{enabled:true}));
 snapshot=(await req(a,path)).data;assert.equal(snapshot.totalParticipants,2);assert.equal(snapshot.truncated,false);
 const other=snapshot.rows.find(r=>r.profileId===b.id);assert.equal(other.completedCount,1);assert.ok(other.totalCount>tasks.length);assert.ok(other.percent<100/3);assert.ok(other.avatarUrl===null||other.avatarUrl.startsWith(`/api/v1/profiles/${b.id}/avatar`));
 assert.equal('email' in other,false);assert.equal('enrollment' in other,false);
 check('Explicit consent is revisioned/idempotent; only shared peer rows, canonical denominator, no private task state');
 const enrollment=learningA.state.enrollments[0];
 learningA=(await req(a,'learning','POST',command('complete',{expectedRevision:learningA.state.revision,enrollmentId:enrollment.id,taskId:tasks[0].id,effortMinutes:4}))).data;
 const first=(await req(b,path)).data.rows.find(r=>r.profileId===a.id);assert.equal(first.completedCount,1);assert.equal(first.latest.taskId,tasks[0].id);assert.equal(first.latest.kind,'new');assert.ok(first.latest.completedAt);assert.equal(first.modules.find(m=>m.moduleId===first.latest.moduleId).completedCount,1);
 learningA=(await req(a,'learning','POST',command('complete',{expectedRevision:learningA.state.revision,enrollmentId:enrollment.id,taskId:tasks[1].id,effortMinutes:4}))).data;
 const moved=(await req(b,path)).data.rows.find(r=>r.profileId===a.id);assert.equal(moved.completedCount,2);assert.ok(moved.percent>first.percent);assert.equal(moved.latest.taskId,tasks[1].id);
 learningA=(await req(a,'learning','POST',command('undo',{expectedRevision:learningA.state.revision,enrollmentId:enrollment.id,taskId:tasks[1].id}))).data;
 assert.equal((await req(b,path)).data.rows.find(r=>r.profileId===a.id).completedCount,1);
 check('Real saved completions advance latest required activity, module counts and course percentage; undo is reflected');
 await req(b,'leaderboards/participation','POST',command('setParticipation',{board:'course',scopeId:snapshot.scopeId,enabled:false}));
 assert.equal((await req(a,path)).data.rows.some(r=>r.profileId===b.id),false);
 await req(b,'leaderboards/participation','POST',command('setParticipation',{board:'course',scopeId:snapshot.scopeId,enabled:true,expectedRevision:1}));
 await req(a,'blocks','POST',command('block',{targetId:b.id}));
 assert.equal((await req(a,path)).data.rows.some(r=>r.profileId===b.id),false);assert.equal((await req(b,path)).data.rows.some(r=>r.profileId===a.id),false);
 snapshot=(await req(a,path,'POST',command('setCourseLiveSharing',{enabled:false,expectedRevision:1}))).data;assert.equal(snapshot.sharing.enabled,false);assert.equal(snapshot.rows.some(r=>r.profileId===a.id),false);
 const table=await fetch(`${env.SUPABASE_URL}/rest/v1/course_live_sharing?select=*`,{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:`Bearer ${a.token}`}});assert.ok([401,403].includes(table.status));
 const exported=await req(a,'account/export');assert.equal(exported.courseLiveSharing.length,1);assert.equal(exported.courseLiveSharing[0].enabled,false);assert.equal('user_id' in exported.courseLiveSharing[0],false);
 check('Leaderboard opt-out, blocks in either direction and granular withdrawal immediately remove rows; direct table access denied and owner export retained');
 writeFileSync('docs/evidence/COURSE_LIVE_API.json',JSON.stringify({at:new Date().toISOString(),run,scope:'Local synthetic accounts; real API commands; no production writes',passed,ok:true},null,2)+'\n');
}finally{
 for(const f of fixtures){const r=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${f.id}`,{method:'DELETE',headers});assert.ok(r.ok,'Only this run’s synthetic fixture cleanup');}
}

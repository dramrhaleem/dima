import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv,clientEnvPath,runtimeRoot } from '../../scripts/local-backend/env.mjs';
const base=process.env.DIMA_TEST_API??'http://127.0.0.1:8787';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const env=readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL,'http://127.0.0.1:54321','Synthetic account creation is restricted to the local backend');
const admin=readEnv(resolve(runtimeRoot,'server.env')).SUPABASE_SERVICE_ROLE_KEY;
assert.ok(admin,'Local server test credential is configured');
// Every run gets isolated synthetic accounts. Existing B0/B1 fixtures and user accounts are untouched.
// Credentials stay in process memory; no token, password or admin key is logged or written to evidence.
const runId=randomUUID();
const fixtures=['a','b'].map(tag=>({email:`b2-api-${runId}-${tag}@example.test`,password:randomBytes(24).toString('base64url')}));
for(const f of fixtures){
 const created=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers:{apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password,email_confirm:true}),signal:AbortSignal.timeout(10000)});
 assert.equal(created.status,200,'Isolated synthetic account creation must succeed');
 const user=await created.json();assert.equal(user.email,f.email,'Created identity must match the unique synthetic address');
}
const results=[];const pass=name=>results.push({name,status:'passed'});
for(const f of fixtures){const r=await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password})});assert.equal(r.status,200);f.token=(await r.json()).access_token;}
const [a,b]=fixtures;
const req=(path,method='GET',body,actor=a,extra={})=>fetch(`${base}/api/v1/${path}`,{method,headers:{...(actor?{Authorization:`Bearer ${actor.token}`} :{}),...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
for(const f of [a,b]){let r=await req('me','GET',undefined,f);assert.equal(r.status,200);const data=(await r.json()).data;f.userId=data.accountId;if(!data.profile?.onboarded){const profile=data.profile??{displayName:'B2 Test',timezone:'UTC',intent:'learning',appearance:'light',reducedMotion:false};const {revision,...fields}=profile;r=await req('me','PATCH',{...fields,displayName:fields.displayName||'B2 Test',onboarded:true,expectedRevision:revision??0,operationId:randomUUID()},f);assert.equal(r.status,200);}}
let r=await req('catalog','GET',undefined,null);assert.equal(r.status,200);const catalog=(await r.json()).data;assert.equal(catalog.length,2);pass('Public reviewed catalog without authentication');
r=await req(`catalog/${catalog[0].id}`,'GET',undefined,null);assert.equal(r.status,200);assert.equal((await r.json()).data.id,catalog[0].id);
r=await req('catalog','GET',undefined,null,{Origin:'http://127.0.0.1:4174'});assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:4174');
r=await req('catalog','GET',undefined,null,{Origin:'https://foreign.example'});assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);pass('Actual public catalog GET allows approved client origin and rejects foreign origin');
r=await req('learning','GET',undefined,null);assert.equal(r.status,401);pass('Private learning rejects missing identity');
async function load(actor=a){const r=await req('learning','GET',undefined,actor);assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);return(await r.json()).data;}
let data=await load();const initial=data.state.revision;
const send=async(body,status=200,extra={})=>{const r=await req('learning','POST',body,a,extra);assert.equal(r.status,status);return r.json();};
const command=(body)=>({...body,expectedRevision:data.state.revision,operationId:randomUUID()});
const id=`private-b2-${randomUUID().slice(0,8)}`;const source='https://example.edu/course';
const task=(id,minutes,position)=>({id,title:`Activity ${id}`,position,kind:'reading',minutes,estimateSource:'user',requirement:'required',sourceUrl:source,prerequisiteIds:[]});
const draft={id,title:'B2 integration course',sourceUrl:source,courses:[{id:'c',title:'Course',position:0,modules:[{id:'m',title:'Module',position:0,tasks:[task('prior',30,0),task('new',60,1),task('last',60,2)]}]}]};
let body=command({type:'saveDraft',draft});const saved=await send(body);data=saved.data;assert.equal(data.state.revision,initial+1);
let replay=await send(body);assert.equal(replay.data.state.revision,data.state.revision);pass('Private draft saves and exact retry does not duplicate');
await send({...body,draft:{...draft,title:'Altered retry'}},409);pass('Changed operation retry rejected');
await send({...body,operationId:randomUUID()},409);pass('Stale expected revision rejected');
const target=new Date(`${data.localDay}T12:00:00Z`);target.setUTCDate(target.getUTCDate()+3);const targetDate=target.toISOString().slice(0,10);
data=(await send(command({type:'enroll',offeringId:id,taskIds:['prior','new','last'],priorTaskIds:['prior'],targetDate}))).data;
const enrollment=data.state.enrollments.find(e=>e.offeringId===id);assert.ok(enrollment);const baseline=enrollment.completions[0];assert.equal(baseline.kind,'prior');assert.equal(baseline.firstCompletedAt,null);assert.equal(baseline.localDay,null);pass('Enrollment freezes scope and prior progress without weekly claim');
data=(await send(command({type:'saveDraft',draft:{...draft,title:'Revised draft'}}))).data;assert.equal(data.state.enrollments.find(e=>e.id===enrollment.id).snapshot.title,'B2 integration course');pass('Editing draft does not mutate enrolled snapshot');
let other=await load(b);assert.ok(!other.state.enrollments.some(e=>e.id===enrollment.id));pass('Other account cannot read private learning state');
await send(command({type:'undo',enrollmentId:enrollment.id,taskId:'prior'}),409,{'X-Dima-Account-Id':b.userId});
await send(command({type:'undo',enrollmentId:enrollment.id,taskId:'prior'}),403,{Origin:'https://foreign.example'});pass('Account precondition and origin guards');
const d2={...draft,id:`${id}-second`,title:'Second course'};data=(await send(command({type:'saveDraft',draft:d2}))).data;data=(await send(command({type:'enroll',offeringId:d2.id,taskIds:['new'],priorTaskIds:[],targetDate}))).data;
const availability={startDate:data.localDay,weekdayMinutes:[60,60,60,60,60,60,60],reservePercent:15};
const targets=()=>Object.fromEntries(data.state.enrollments.map(e=>[e.id,e.targetDate]));
const preview=await send(command({type:'preview',availability,targets:targets()}));data=preview.data;
let p=data.state.previews.find(p=>p.id===preview.previewId);assert.ok(p);assert.ok(p.result.days.every(d=>d.used<=d.ceiling-d.reserve-(d.accepted??0)));assert.ok(p.result.blocks.some(b=>b.enrollmentId===enrollment.id));pass('Both courses share one capacity in real preview');
data=(await send(command({type:'complete',enrollmentId:enrollment.id,taskId:'new',effortMinutes:40}))).data;await send(command({type:'apply',previewId:p.id,acknowledgeUnscheduled:false}),409);pass('Progress from another request invalidates stale preview');
const preview2=await send(command({type:'preview',availability,targets:targets()}));data=preview2.data;p=data.state.previews.find(p=>p.id===preview2.previewId);assert.equal(p.result.days[0].accepted,40);assert.ok(p.result.days[0].used<=11);
data=(await send(command({type:'apply',previewId:p.id,acknowledgeUnscheduled:true}))).data;assert.equal(data.state.plan.id,p.id);pass('Apply persists plan and respects already accepted effort today');
const completion=data.state.enrollments.find(e=>e.id===enrollment.id).completions.find(c=>c.taskId==='new');
data=(await send(command({type:'undo',enrollmentId:enrollment.id,taskId:'new'}))).data;
body=command({type:'complete',enrollmentId:enrollment.id,taskId:'new',effortMinutes:20});data=(await send(body)).data;replay=await send(body);assert.equal(replay.data.state.revision,data.state.revision);const claims=data.state.enrollments.find(e=>e.id===enrollment.id).completions.filter(c=>c.taskId==='new');assert.equal(claims.length,1);assert.equal(claims[0].claimId,completion.claimId);assert.equal(claims[0].firstCompletedAt,completion.firstCompletedAt);pass('Undo and recomplete retain one first-completion claim');
const expected=data.state.revision;const race=await Promise.all([req('learning','POST',{type:'setEstimates',enrollmentId:enrollment.id,estimates:{last:45},expectedRevision:expected,operationId:randomUUID()}),req('learning','POST',{type:'setEstimates',enrollmentId:enrollment.id,estimates:{last:50},expectedRevision:expected,operationId:randomUUID()})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);data=await load();assert.equal(data.state.revision,expected+1);pass('Concurrent commands commit exactly once');
replay=await send(body);assert.equal(replay.data.state.revision,data.state.revision);pass('Old retry returns currentstate without replaying progress');
const rest=(path,method='GET',body,actor=a)=>fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:`Bearer ${actor.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
r=await rest(`learning_workspaces?user_id=eq.${a.userId}&select=user_id`,'GET',undefined,b);assert.equal(r.status,200);assert.deepEqual(await r.json(),[]);
r=await rest('learning_workspaces','POST',{user_id:a.userId,revision:999,state:{}});assert.ok([401,403].includes(r.status));
r=await rest('rpc/commit_learning_command','POST',{p_actor:a.userId,p_expected:0,p_profile_revision:1,p_command:{},p_result:{}});assert.ok([401,403].includes(r.status));pass('RLS isolates reads and direct table/RPC writes cannot bypass server');
r=await rest(`learning_operations?user_id=eq.${a.userId}&select=result&limit=10`);assert.equal(r.status,200);const receipts=await r.json();assert.ok(receipts.every(x=>!('state'in x.result)));pass('Command receipts do not duplicate full curriculum snapshots');
writeFileSync('docs/evidence/B2_LEARNING_API_RESULTS.json',JSON.stringify({checkedAt:new Date().toISOString(),base,results,credentialsPrinted:false},null,2)+'\n');
console.log(JSON.stringify({passed:results.length,failed:0,credentialsPrinted:false}));

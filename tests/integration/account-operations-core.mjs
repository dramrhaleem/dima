import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base=process.env.DIMA_TEST_API??'http://127.0.0.1:8787';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const env=readEnv(clientEnvPath);assert.equal(env.SUPABASE_URL,'http://127.0.0.1:54321');
const admin=readEnv(resolve(runtimeRoot,'server.env')).SUPABASE_SERVICE_ROLE_KEY;
const runId=randomUUID(),started=Date.now(),results=[],actors=[];
const pass=name=>{results.push({name,status:'passed'});console.log(`PASS ${name}`);};
const authHeaders={apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json'};
async function authAdmin(path,method='GET',body){const r=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/${path}`,{method,headers:authHeaders,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});return {status:r.status,body:await r.json().catch(()=>null)};}
async function request(actor,path,method='GET',body,extra={}){
 const r=await fetch(`${base}/api/v1/${path}`,{method,headers:{...(actor?{Authorization:`Bearer ${actor.token}`,'X-Dima-Account-Id':actor.id}:{}),'Content-Type':'application/json',...(actor?.cookie?{Cookie:actor.cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(actor){const secret=r.headers.getSetCookie().find(x=>x.startsWith('dima-deletion='));if(secret)actor.cookie=secret.split(';')[0];}
 return {status:r.status,body:await r.json(),headers:r.headers};
}
async function ok(actor,path,method='GET',body,extra={}){const r=await request(actor,path,method,body,extra);assert.equal(r.status,200,`${path}: ${JSON.stringify(r.body)}`);return r.body.data??r.body;}
async function rows(table,column,id){
 assert.match(table,/^[a-z_]+$/);assert.match(column,/^[a-z_]+$/);assert.match(id,/^[a-f0-9-]{36}$/);
 const sql=`SELECT coalesce(json_agg(row_to_json(record)), '[]') FROM (SELECT * FROM public.${table} WHERE ${column}='${id}'::uuid) record`;
 return JSON.parse(execFileSync('docker',['exec','dima-b0-db','psql','-U','postgres','-d','postgres','-Atc',sql],{encoding:'utf8'}));
}
async function actor(tag){
 const email=`b6-ops-${runId}-${tag}@example.test`,password=randomBytes(24).toString('base64url');
 const created=await authAdmin('users','POST',{email,password,email_confirm:true});assert.equal(created.status,200);
 const a={id:created.body.id,email,deviceId:randomUUID()};actors.push(a);
 const login=await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});assert.equal(login.status,200);a.token=(await login.json()).access_token;
 await ok(a,'me','PATCH',{displayName:`Ops ${tag}`,timezone:'UTC',intent:'learning',appearance:'light',reducedMotion:false,onboarded:true,expectedRevision:0,operationId:randomUUID()});
 const privateTitle=`Private ${tag} ${runId}`;a.privateTitle=privateTitle;
 await ok(a,'learning','POST',{type:'saveDraft',expectedRevision:0,operationId:randomUUID(),draft:{id:'my-private-course',title:privateTitle,sourceUrl:'https://example.org/course',courses:[{id:'course',title:'Course',position:1,modules:[{id:'module',title:'Module',position:1,tasks:[{id:'task',title:'Private task',position:1,kind:'reading',minutes:10,estimateSource:'user',requirement:'required',sourceUrl:'https://example.org/course',prerequisiteIds:[]}]}]}]}});
 return a;
}
const consent={acknowledgeVisibility:true,visibilityVersion:1};
async function roomCommand(a,command){const state=await ok(a,'rooms/me');return ok(a,'rooms','POST',{operationId:randomUUID(),expectedRevision:state.revision,...command});}
async function round(a,roomId){const time=await ok(a,'time'),snapshot=await ok(a,`rooms/${roomId}/snapshot`);await roomCommand(a,{type:'joinRound',roomId,deviceId:a.deviceId,controlVersion:snapshot.me.membership.controlVersion,runId:snapshot.room.run.id,roundIndex:snapshot.room.phase.roundIndex,expectedTimeRevision:time.revision,category:'work',enrollmentId:null,taskId:null});}
try{
 const owner=await actor('owner'),peer=await actor('peer');
 const exported=await request(owner,'account/export');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);assert.match(exported.headers.get('cache-control'),/no-store/);
 assert.equal(exported.body.accountId,owner.id);assert.equal(exported.body.email,owner.email);assert.ok(JSON.stringify(exported.body).includes(owner.privateTitle));assert.ok(!JSON.stringify(exported.body).includes(peer.privateTitle));assert.ok(!JSON.stringify(exported.body).includes(peer.email));
 const wrongOwner=await request(peer,'account/export','GET',undefined,{'X-Dima-Account-Id':owner.id});assert.equal(wrongOwner.status,409);pass('Owner JSON download contains own draft and rejects switched-account header');
 const created=await roomCommand(owner,{type:'create',deviceId:owner.deviceId,title:'Synthetic deletion focus',description:'Temporary account operations smoke',language:'en',topic:'Synthetic deletion',offeringId:null,presetId:'classic',...consent});
 const roomId=created.membership.roomId;
 await roomCommand(peer,{type:'join',roomId,deviceId:peer.deviceId,...consent});
 const snapshot=await ok(owner,`rooms/${roomId}/snapshot`);
 await roomCommand(owner,{type:'startRun',roomId,deviceId:owner.deviceId,controlVersion:snapshot.me.membership.controlVersion,roomVersion:snapshot.room.version});
 await round(owner,roomId);await round(peer,roomId);pass('Real owner-host and another member have active focus sessions');
 const sentAt=Date.now(),challenge=await ok(owner,'account/deletion','POST',{type:'start',operationId:randomUUID()});assert.equal(challenge.status,'codeSent');assert.ok(owner.cookie);
 const token=await waitForLocalOtp(owner.email,{after:sentAt,timeoutMs:12000});
 const wrong=await request(owner,'account/deletion','POST',{type:'confirm',requestId:challenge.requestId,code:token==='000000'?'111111':'000000',confirmation:'DELETE'});assert.equal(wrong.status,401);assert.equal(wrong.body.error.code,'CODE_INVALID');
 assert.equal((await authAdmin(`users/${owner.id}`)).status,200);pass('Wrong fresh-mail code cannot delete the account');
 const removed=await ok(owner,'account/deletion','POST',{type:'confirm',requestId:challenge.requestId,code:token,confirmation:'DELETE'});assert.equal(removed.status,'done');assert.ok(removed.completedAt);pass('Actual emailed OTP confirms deletion after fresh proof verification');
 const status=await request(null,`account/deletion?requestId=${challenge.requestId}`,'GET',undefined,{Cookie:owner.cookie});assert.equal(status.status,200);assert.equal(status.body.data.status,'done');
 const hidden=await request(null,`account/deletion?requestId=${challenge.requestId}`);assert.equal(hidden.status,404);
 assert.equal((await authAdmin(`users/${owner.id}`)).status,404);
 for(const table of ['account_profiles','learning_workspaces','time_sessions','time_intervals','room_memberships','first_credit_claims'])assert.deepEqual(await rows(table,'user_id',owner.id),[],table);
 assert.deepEqual(await rows('rooms','owner_id',owner.id),[]);pass('Done status is browser-bound and Auth/private owner rows are actually gone');
 const room=(await rows('rooms','id',roomId))[0];assert.equal(room.status,'closed');assert.equal(room.owner_id,null);assert.equal(room.current_host_membership_id,null);
 const runs=await rows('room_runs','room_id',roomId);assert.equal(runs[0].status,'cancelled');assert.equal(runs[0].current_host_membership_id,null);
 const peerTime=await ok(peer,'time');assert.equal(peerTime.active,null);const sessions=await rows('time_sessions','user_id',peer.id);assert.equal(sessions.length,1);assert.equal(sessions[0].status,'finalized');assert.ok(Date.parse(sessions[0].finalized_at)<=Date.parse(runs[0].cancelled_at));assert.equal((await authAdmin(`users/${peer.id}`)).status,200);pass('Owned room closes, host references clear and surviving member stops at run cutoff');
 writeFileSync('docs/evidence/B6_ACCOUNT_OPERATIONS_CORE.json',JSON.stringify({checkedAt:new Date().toISOString(),base,elapsedMs:Date.now()-started,results,limits:['Local Mailpit delivery only; hosted SMTP not verified','One owned active-room deletion; no expanded fault matrix'],credentialsPrinted:false},null,2)+'\n');
 console.log(JSON.stringify({passed:results.length,elapsedMs:Date.now()-started,credentialsPrinted:false}));
}finally{
 for(const a of actors){const current=await authAdmin(`users/${a.id}`);if(current.status===200){const cleanup=await authAdmin(`users/${a.id}`,'DELETE');if(cleanup.status!==200)console.error(JSON.stringify({cleanupFailed:true,syntheticUserId:a.id,status:cleanup.status}));}}
}

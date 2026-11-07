// Focused B6 launch smoke: real local API, isolated synthetic accounts, no load test.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
const base=process.env.DIMA_TEST_API??'http://127.0.0.1:8787';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const env=readEnv(clientEnvPath);assert.equal(env.SUPABASE_URL,'http://127.0.0.1:54321');
const admin=readEnv(resolve(runtimeRoot,'server.env')).SUPABASE_SERVICE_ROLE_KEY;
const runId=randomUUID(),results=[],fixtures=[];
const adminHeaders={apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json'};
async function req(f,path,method='GET',body,status=200,extra={}){
 const r=await fetch(`${base}/api/v1/${path}`,{method,headers:{...(f?{Authorization:`Bearer ${f.token}`,'X-Dima-Account-Id':f.id}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const p=await r.json().catch(()=>null);assert.equal(r.status,status,`${method} ${path} ${p?.error?.code??''}`);return p?.data;
}
const cmd=(type,rest={})=>({type,operationId:randomUUID(),expectedRevision:0,...rest});
const pass=name=>{results.push(name);console.log(`PASS ${name}`);};
let publicId;
try{
 for(const label of ['A','B','Reviewer']){
  const email=`b6-${runId}-${label.toLowerCase()}@example.test`,password=randomBytes(24).toString('base64url');
  const cr=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers:adminHeaders,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(cr.status,200);const u=await cr.json();
  const ar=await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(ar.status,200);const f={id:u.id,token:(await ar.json()).access_token,label};fixtures.push(f);
  await req(f,'me','PATCH',{displayName:`B6 ${label}`,timezone:'UTC',intent:'learning',appearance:'light',reducedMotion:false,onboarded:true,expectedRevision:0,operationId:randomUUID()});
 }
 const [a,b,reviewer]=fixtures;
 assert.match(reviewer.id,/^[a-f0-9-]{36}$/i);
 const grant=spawnSync('docker',['exec','-i','dima-b0-db','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],{encoding:'utf8',input:`DO $fixture$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${reviewer.id}' AND email='b6-${runId}-reviewer@example.test') THEN RAISE EXCEPTION 'Synthetic reviewer required'; END IF; INSERT INTO public.account_roles(user_id,role) VALUES('${reviewer.id}','admin'); END $fixture$;`});
 assert.equal(grant.status,0,'Grant only isolated synthetic reviewer');
 assert.equal((await req(a,'sharing')).publicProfile,false);await req(a,'sharing','GET',undefined,409,{'X-Dima-Account-Id':b.id});
 await req(null,'sharing','GET',undefined,401);pass('Private defaults, authentication and account boundary');
 const source='https://example.edu/course';
 const task=(id,kind)=>({id,title:id,kind,position:id==='read'?0:1,minutes:15,estimateSource:'user',requirement:'required',sourceUrl:source,prerequisiteIds:[]});
 const draft={id:`b6-${runId}`,title:'B6 isolated learning',sourceUrl:source,courses:[{id:'course',title:'Course',position:0,modules:[{id:'module',title:'Module',position:0,tasks:[task('read','reading'),task('project','project')]}]}]};
 let learning=await req(a,'learning','POST',cmd('saveDraft',{draft}));
 const today=new Date();today.setUTCDate(today.getUTCDate()+30);
 learning=await req(a,'learning','POST',cmd('enroll',{expectedRevision:learning.state.revision,offeringId:draft.id,taskIds:['read','project'],priorTaskIds:[],targetDate:today.toISOString().slice(0,10)}));
 const enrollment=learning.state.enrollments[0];
 learning=await req(a,'learning','POST',cmd('complete',{expectedRevision:learning.state.revision,enrollmentId:enrollment.id,taskId:'read',effortMinutes:10}));
 const progress=await req(a,'progress');assert.equal(progress.courses[0].requiredWeight,9);assert.equal(progress.courses[0].completedWeight,1);assert.equal(progress.courses[0].percentage,11.1);assert.equal((await req(b,'progress')).courses.length,0);pass('Weighted progress saved and private');
 const submitted=await req(a,'publication-requests','POST',cmd('submit',{expectedRevision:learning.state.revision,draftId:draft.id,provider:'Synthetic test',summary:'A small test outline.',language:'English',scopeLabel:'All required activities',orderPolicy:'Source order',sourceNotes:'Original synthetic metadata.',rightsAttested:true}));
 publicId=submitted.offeringId;
 await req(b,'admin/reviews','GET',undefined,403);
 assert.equal((await req(b,'publication-requests')).requests.length,0);
 const reviewList=await req(reviewer,'admin/reviews');const request=reviewList.requests.find(r=>r.id===submitted.requestId);assert.ok(request);assert.equal('completions' in request.snapshot,false);
 await req(reviewer,'admin/reviews','POST',cmd('review',{requestId:request.id,expectedRevision:request.revision,decision:'approve',reason:'Synthetic outline verified.'}));
 const published=await req(null,`catalog/${publicId}`);assert.equal(published.title,draft.title);pass('Outline-only approval, role checks and real public catalog');
 await req(b,'learning','POST',cmd('enroll',{offeringId:publicId,taskIds:['read','project'],priorTaskIds:[],targetDate:today.toISOString().slice(0,10)}));
 await req(a,'people/visibility','POST',cmd('setPeople',{offeringId:publicId,visible:true}));
 assert.ok((await req(b,`offerings/${publicId}/people`)).rows.some(p=>p.profileId===a.id));
 await req(a,'sharing','POST',cmd('setSharing',{publicProfile:false,bio:'',allowFollow:true,weeklyTime:false,courseProgress:false}));
 await req(b,'follow-requests','POST',cmd('follow',{targetId:a.id}));
 const incoming=(await req(a,'circle')).incoming[0];assert.ok(incoming);
 await req(a,`follow-requests/${incoming.id}/accept`,'POST',cmd('accept',{relationshipId:incoming.id,expectedRevision:incoming.revision}));
 const shared=await req(b,`profiles/${a.id}/shared`);assert.equal(shared.weeklyTimeSeconds,undefined);assert.equal(shared.courses,undefined);assert.ok((await req(a,'notifications')).rows.length);pass('People opt-in, follow approval and independent metric permission');
 const time=await req(a,'leaderboards/time');const scope=time.scopes.find(s=>s.offeringId===publicId);assert.ok(scope);
 await req(a,'leaderboards/participation','POST',cmd('setParticipation',{board:'course',scopeId:scope.id,enabled:true}));
 let board=await req(b,`leaderboards/course/${encodeURIComponent(scope.id)}?period=overall`);assert.equal(board.rows.find(r=>r.profileId===a.id).score,1);
 learning=await req(a,'learning','POST',cmd('undo',{expectedRevision:learning.state.revision,enrollmentId:enrollment.id,taskId:'read'}));
 board=await req(b,`leaderboards/course/${encodeURIComponent(scope.id)}?period=overall`);assert.equal(board.rows.find(r=>r.profileId===a.id).score,0);
 learning=await req(a,'learning','POST',cmd('complete',{expectedRevision:learning.state.revision,enrollmentId:enrollment.id,taskId:'read',effortMinutes:10}));
 board=await req(b,`leaderboards/course/${encodeURIComponent(scope.id)}?period=overall`);assert.equal(board.rows.find(r=>r.profileId===a.id).score,1);pass('Publication preserves credits; undo and recomplete never double score');
 await req(a,'blocks','POST',cmd('block',{targetId:b.id}));await req(b,`profiles/${a.id}/shared`,'GET',undefined,404);assert.equal((await req(b,'circle')).following.length,0);pass('Blocking immediately revokes visibility and follow');
 const adminCatalog=await req(reviewer,'admin/catalog');const item=adminCatalog.offerings.find(o=>o.id===publicId);
 await req(reviewer,'admin/catalog','POST',cmd('setPublication',{offeringId:publicId,published:false,expectedRevision:item.revision,reason:'End of isolated test.'}));await req(null,`catalog/${publicId}`,'GET',undefined,404);
 assert.equal((await req(b,'learning')).state.enrollments[0].snapshot.title,draft.title);pass('Unpublish removes catalog source and preserves existing private learning');
}finally{
 // This run's synthetic accounts only; no existing user or global shared seed changed.
 for(const f of fixtures){const r=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${f.id}`,{method:'DELETE',headers:adminHeaders});if(!r.ok)console.log(`Fixture cleanup deferred for ${f.label}: HTTP ${r.status}`);}
 writeFileSync(`docs/evidence/B6_CORE_${runId}.json`,JSON.stringify({runId,checkedAt:new Date().toISOString(),base,passed:results,complete:results.length===7,syntheticPublishedOffering:publicId??null,credentialsPrinted:false},null,2)+'\n');
}
assert.equal(results.length,7);console.log(JSON.stringify({passed:results.length,credentialsPrinted:false}));

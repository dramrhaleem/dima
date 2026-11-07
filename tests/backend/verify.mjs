import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
const env=readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL,'http://127.0.0.1:54321','This proof must only run against the local backend');
const base=env.SUPABASE_URL;
const request=(path,token,options={})=>fetch(`${base}${path}`,{...options,headers:{apikey:env.SUPABASE_ANON_KEY,...(token?{Authorization:`Bearer ${token}`}:{'Authorization':`Bearer ${env.SUPABASE_ANON_KEY}`}),...options.headers},signal:AbortSignal.timeout(5000)});
const fixturePath=resolve(runtimeRoot,'test-accounts.json');
let accounts=existsSync(fixturePath)?JSON.parse(readFileSync(fixturePath,'utf8')):null;
if(!accounts) {
  accounts=[];
  for(const name of ['a','b']) {
    const email=`dima-b0-${name}-${randomBytes(5).toString('hex')}@example.test`; const password=randomBytes(24).toString('base64url');
    const sentAt=Date.now();
    const response=await request('/auth/v1/signup',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    assert.equal(response.status,200,`Synthetic signup ${name} failed (status only)`);
    let data=await response.json();
    if(!data.access_token) {
      const token=await waitForLocalOtp(email,{after:sentAt});
      const verified=await request('/auth/v1/verify',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,token,type:'signup'})});
      assert.equal(verified.status,200,'Synthetic email confirmation failed (status only)');
      data=await verified.json();
    }
    assert.ok(data.access_token,'Real Auth must issue access token after verification');
    accounts.push({email,password,userId:data.user.id,accessToken:data.access_token});
  }
} else {
  for(const account of accounts) {
    const response=await request('/auth/v1/token?grant_type=password',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});
    assert.equal(response.status,200,'Synthetic login failed (status only)');const data=await response.json();account.accessToken=data.access_token;account.userId=data.user.id;
  }
}
writeFileSync(fixturePath,JSON.stringify(accounts,null,2)+'\n',{mode:0o600});
const [a,b]=accounts;const id=randomUUID();const results=[];
const record=(name)=>results.push({name,status:'passed'});
let r=await request('/auth/v1/user',a.accessToken);assert.equal(r.status,200);assert.equal((await r.json()).id,a.userId);record('Real Auth verifies caller identity');
r=await request('/auth/v1/user','invalid-token');assert.equal(r.status,403);record('Invalid user token rejected');
r=await request('/rest/v1/foundation_checks',a.accessToken,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({id,owner_id:a.userId,label:'B0 persistence fixture'})});assert.equal(r.status,201);assert.equal((await r.json())[0].id,id);record('Owner insert persists in Postgres');
r=await request(`/rest/v1/foundation_checks?id=eq.${id}`,a.accessToken);assert.equal(r.status,200);assert.equal((await r.json()).length,1);record('Owner can read persisted row');
r=await request(`/rest/v1/foundation_checks?id=eq.${id}`,b.accessToken);assert.equal(r.status,200);assert.equal((await r.json()).length,0);record('Other authenticated account cannot read owner row');
r=await request('/rest/v1/foundation_checks',b.accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner_id:a.userId,label:'forged owner'})});assert.equal(r.status,403);record('Other account cannot forge owner_id');
r=await request('/rest/v1/foundation_checks',null);assert.equal(r.status,401);record('Anonymous read denied');
r=await request('/rest/v1/foundation_checks',a.accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner_id:a.userId,label:'x'.repeat(121)})});assert.equal(r.status,400);record('Database enforces label length');
r=await request(`/rest/v1/foundation_checks?id=eq.${id}`,a.accessToken,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'unexpected update'})});assert.equal(r.status,403);record('Unimplemented update capability denied');
r=await request('/rest/v1/foundation_checks',a.accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,owner_id:a.userId,label:'duplicate'})});assert.equal(r.status,409);record('Duplicate primary key cannot create second row');
r=await fetch(`${base}/rest/v1/foundation_checks`,{headers:{apikey:env.SUPABASE_ANON_KEY,Origin:'https://untrusted.example'},signal:AbortSignal.timeout(5000)});assert.equal(r.status,403);record('Development gateway rejects unlisted origin');
r=await fetch(`${base}/auth/v1/token`,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4174','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-supabase-api-version,apikey,content-type'},signal:AbortSignal.timeout(5000)});assert.equal(r.status,204);assert.ok(r.headers.get('Access-Control-Allow-Headers').split(',').includes('x-supabase-api-version'));record('Standalone SDK Auth preflight supports the API version header');
writeFileSync(resolve(runtimeRoot,'backend-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),environment:'isolated local Auth/Postgres/PostgREST',results},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({passed:results.length,failed:0,environment:'local real Auth + Postgres + RLS',credentialsPrinted:false}));

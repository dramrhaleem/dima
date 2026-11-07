// Local test fixture support only. This is not an application route or a production clock override.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readEnv,clientEnvPath,runtimeRoot } from '../../scripts/local-backend/env.mjs';
export async function seedSyntheticLearningState(userId,state,profileRevision) {
 const env=readEnv(clientEnvPath);assert.equal(env.SUPABASE_URL,'http://127.0.0.1:54321');
 assert.match(userId,/^[a-f0-9-]{36}$/i);
 const admin=readEnv(resolve(runtimeRoot,'server.env')).SUPABASE_SERVICE_ROLE_KEY;
 const headers={apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json'};
 const identity=await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`,{headers,signal:AbortSignal.timeout(10000)});assert.equal(identity.status,200);
 assert.match((await identity.json()).email,/^b3-[a-z0-9-]+@example\.test$/i,'Fixture writer accepts only explicitly named B3 synthetic users');
 const current=await fetch(`${env.SUPABASE_URL}/rest/v1/learning_workspaces?user_id=eq.${userId}&select=revision`,{headers,signal:AbortSignal.timeout(10000)});assert.equal(current.status,200);const expected=(await current.json())[0]?.revision??0;
 const seeded={...globalThis.structuredClone(state),revision:expected+1};
 const response=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/commit_learning_command`,{method:'POST',headers,body:JSON.stringify({p_actor:userId,p_expected:expected,p_profile_revision:profileRevision,p_command:{type:'local-b3-test-fixture',expectedRevision:expected,operationId:randomUUID()},p_result:{state:seeded}}),signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,200,'Scoped synthetic fixture transaction must succeed');return seeded;
}

import { mkdirSync, existsSync, writeFileSync, readFileSync, chmodSync, openSync, statSync, readdirSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeRoot, clientEnvPath, readEnv } from './env.mjs';
import { ensureLocalRealtime, prepareRealtimeSecrets } from './realtime.mjs';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
mkdirSync(runtimeRoot, {recursive:true,mode:0o700});
chmodSync(runtimeRoot, 0o700);
if ((statSync(runtimeRoot).mode & 0o077) !== 0) throw new Error('Runtime directory must support private POSIX permissions; use a Linux filesystem, not NTFS.');
const dockerEnv = resolve(runtimeRoot,'docker.env');
if (!existsSync(dockerEnv)) {
  const password=randomBytes(24).toString('hex'); const secret=randomBytes(32).toString('hex');
  writeFileSync(dockerEnv,`DIMA_BACKEND_ROOT=${runtimeRoot}\nDIMA_REPO_ROOT=${repoRoot}\nPOSTGRES_PASSWORD=${password}\nJWT_SECRET=${secret}\n`,{mode:0o600});
}
const credentials = readEnv(dockerEnv);
if (credentials.DIMA_REPO_ROOT !== repoRoot || credentials.DIMA_BACKEND_ROOT !== runtimeRoot) throw new Error('Runtime belongs to a different path; inspect manually without resetting data.');
if (!existsSync(clientEnvPath)) {
  const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const now=Math.floor(Date.now()/1000);
  const body=`${b64({alg:'HS256',typ:'JWT'})}.${b64({role:'anon',iss:'supabase',iat:now,exp:now+365*86400})}`;
  const anon=`${body}.${createHmac('sha256',credentials.JWT_SECRET).update(body).digest('base64url')}`;
  writeFileSync(clientEnvPath,`SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_ANON_KEY=${anon}\n`,{mode:0o600});
}
// Server-only development credential; never include it in client.env or browser bundles.
const serverEnv = resolve(runtimeRoot, 'server.env');
if (!existsSync(serverEnv)) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', iss: 'supabase', iat: now, exp: now + 365 * 86400 })}`;
  const token = `${body}.${createHmac('sha256', credentials.JWT_SECRET).update(body).digest('base64url')}`;
  writeFileSync(serverEnv, `SUPABASE_SERVICE_ROLE_KEY=${token}\n`, { mode: 0o600 });
}
chmodSync(serverEnv, 0o600);
function run(args, input) {
  const p=spawnSync('docker',args,{encoding:'utf8',input,maxBuffer:2e6});
  if (p.status !== 0) throw new Error(`Docker operation failed (${args.slice(0,3).join(' ')}). Inspect local container health; credentials are not printed.`);
  return p.stdout;
}
for (const name of ['dima-b0-db','dima-b0-auth','dima-b0-rest','dima-b0-mailpit','dima-b0-templates','dima-b0-realtime']) {
  const p=spawnSync('docker',['inspect',name,'--format','{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}'],{encoding:'utf8'});
  if (p.status===0 && p.stdout.trim()!==`dima-b0|${resolve(repoRoot,'scripts/local-backend/compose.yaml')}`) throw new Error(`Refusing to change foreign container ${name}`);
}
const volume=spawnSync('docker',['volume','inspect','dima-b0-postgres-data','--format','{{index .Labels "com.docker.compose.project"}}'],{encoding:'utf8'});
if(volume.status===0 && volume.stdout.trim()!=='dima-b0') throw new Error('Refusing foreign data volume');
prepareRealtimeSecrets();
run(['compose','--env-file',dockerEnv,'-f',resolve(repoRoot,'scripts/local-backend/compose.yaml'),'up','-d']);
async function wait(url) {
  for(let n=0;n<60;n++) {
    try { const r=await fetch(url,{signal:AbortSignal.timeout(1500)}); if(r.ok)return; } catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error(`Local readiness failed: ${url}`);
}
await wait('http://127.0.0.1:54323/health');
await ensureLocalRealtime();
run(['exec','-i','dima-b0-db','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],`CREATE SCHEMA IF NOT EXISTS dima_local; REVOKE ALL ON SCHEMA dima_local FROM PUBLIC; CREATE TABLE IF NOT EXISTS dima_local.migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());`);
for (const file of readdirSync(resolve(repoRoot,'supabase/migrations')).filter(x=>/^\d{14}_[a-z0-9_]+\.sql$/.test(x)).sort()) {
  const version=file.slice(0,14);
  // Early B4 receipts used the complete filename stem. Preserve those receipts
  // and recognize the exact migration instead of replaying its non-idempotent DDL.
  const legacyVersion=file.slice(0,-4);
  const done=run(['exec','dima-b0-db','psql','-U','postgres','-d','postgres','-Atc',`SELECT EXISTS (SELECT 1 FROM dima_local.migrations WHERE version IN ('${version}', '${legacyVersion}'))`]).trim()==='t';
  if(!done) {
    const migration=readFileSync(resolve(repoRoot,'supabase/migrations',file),'utf8');
    run(['exec','-i','dima-b0-db','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],`BEGIN;\n${migration}\nINSERT INTO dima_local.migrations(version) VALUES ('${version}');\nCOMMIT;\nNOTIFY pgrst, 'reload schema';`);
  }
}
let gatewayUp=false;
try { const r=await fetch('http://127.0.0.1:54321/health',{signal:AbortSignal.timeout(1000)}); const data=await r.json().catch(()=>null); gatewayUp=r.ok && data?.service==='dima-b0-local-gateway'; if(!gatewayUp)throw new Error('Port 54321 belongs to another service'); } catch(e) {if(e.message.includes('belongs'))throw e;}
if(!gatewayUp) {
  const log=openSync(resolve(runtimeRoot,'gateway.log'),'a',0o600);
  const child=spawn(process.execPath,[resolve(repoRoot,'scripts/local-backend/gateway.mjs')],{detached:true,stdio:['ignore',log,log],env:{...process.env,DIMA_BACKEND_ROOT:runtimeRoot}});
  writeFileSync(resolve(runtimeRoot,'gateway.pid'),String(child.pid),{mode:0o600}); child.unref();
}
await wait('http://127.0.0.1:54321/health');
const client=readEnv(clientEnvPath);
for(let n=0;n<30;n++) {
  const r=await fetch(`${client.SUPABASE_URL}/rest/v1/`,{headers:{apikey:client.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(1500)}).catch(()=>null);
  if(r?.ok)break;
  if(n===29)throw new Error('Local REST readiness failed');
  await new Promise(r=>setTimeout(r,1000));
}
console.log('Local B0 backend ready: real Auth + Postgres + PostgREST. Credentials saved outside Git; no remote service used.');

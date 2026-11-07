// Local official Realtime setup. Never resets the application database or stock-seeds a tenant.
import { chmodSync, existsSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv, runtimeRoot } from './env.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const composeFile = resolve(repoRoot, 'scripts/local-backend/compose.yaml');
const secretFile = resolve(runtimeRoot, 'realtime.env');

export function prepareRealtimeSecrets() {
  const credentials = readEnv(resolve(runtimeRoot, 'docker.env'));
  if (credentials.DIMA_REPO_ROOT !== repoRoot || credentials.DIMA_BACKEND_ROOT !== runtimeRoot) throw new Error('Local runtime ownership mismatch.');
  if ((statSync(runtimeRoot).mode & 0o077) !== 0) throw new Error('Private POSIX runtime storage is required.');
  if (!/^[a-f0-9]{48}$/.test(credentials.POSTGRES_PASSWORD ?? '') || !/^[a-f0-9]{64}$/.test(credentials.JWT_SECRET ?? '')) throw new Error('Existing local credential format requires inspection.');
  if (!existsSync(secretFile)) {
    writeFileSync(secretFile, `SECRET_KEY_BASE=${randomBytes(64).toString('hex')}\nDB_ENC_KEY=${randomBytes(8).toString('hex')}\nDB_ENC_KEY_GCM=${randomBytes(24).toString('base64')}\nDB_ENC_WRITE_GCM=true\n`, { mode: 0o600, flag: 'wx' });
  }
  chmodSync(secretFile, 0o600);
  const keys = readEnv(secretFile);
  if ((statSync(secretFile).mode & 0o077) !== 0 || keys.SECRET_KEY_BASE?.length !== 128 || keys.DB_ENC_KEY?.length !== 16 || keys.DB_ENC_KEY_GCM?.length !== 32 || keys.DB_ENC_WRITE_GCM !== 'true') throw new Error('Realtime secret configuration requires inspection.');
  return credentials;
}

function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 3e6 });
  if (result.status !== 0) {
    const log = resolve(runtimeRoot, 'realtime-setup.log');
    appendFileSync(log, `${new Date().toISOString()}\n${result.stdout ?? ''}\n${result.stderr ?? ''}\n`, { mode: 0o600 });
    chmodSync(log, 0o600);
    throw new Error('Local Realtime operation failed; diagnostic output retained in the private runtime log.');
  }
  return result.stdout;
}
function verifyContainer(name, required = false) {
  const result = spawnSync('docker', ['inspect', name, '--format', '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}'], { encoding: 'utf8' });
  if (result.status !== 0) { if (required) throw new Error('Local database must be started first.'); return; }
  if (result.stdout.trim() !== `dima-b0|${composeFile}`) throw new Error('Refusing a container owned by another checkout.');
}

export async function ensureLocalRealtime() {
  const credentials = prepareRealtimeSecrets();
  verifyContainer('dima-b0-db', true);
  verifyContainer('dima-b0-realtime');
  const sql = query => docker(['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], query);
  if (sql('SHOW wal_level;').trim() !== 'logical') throw new Error('Restart the owned local database with the reviewed Compose logical-WAL configuration first.');
  sql(`BEGIN;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin LOGIN REPLICATION INHERIT; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_realtime_admin') THEN CREATE ROLE supabase_realtime_admin NOLOGIN NOINHERIT; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
    END $$;
    ALTER ROLE supabase_admin PASSWORD '${credentials.POSTGRES_PASSWORD}';
    ALTER ROLE supabase_realtime_admin NOINHERIT;
    GRANT anon TO supabase_admin;
    GRANT anon, authenticated, service_role TO supabase_realtime_admin WITH INHERIT FALSE;
    GRANT SET ON PARAMETER log_min_messages TO supabase_admin, supabase_realtime_admin;
    GRANT supabase_realtime_admin TO supabase_admin WITH ADMIN OPTION;
    GRANT CREATE ON DATABASE postgres TO supabase_admin;
    CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
    CREATE SCHEMA IF NOT EXISTS realtime AUTHORIZATION supabase_admin;
    ALTER SCHEMA realtime OWNER TO supabase_admin;
    GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
    REVOKE ALL ON FUNCTION auth.jwt() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
    COMMIT;`);
  docker(['compose', '--env-file', resolve(runtimeRoot, 'docker.env'), '-f', composeFile, '--profile', 'realtime', 'up', '-d', '--no-deps', 'realtime']);
  const service = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
  if (!service) throw new Error('Local service credential is missing.');
  const headers = { Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
  const endpoint = 'http://127.0.0.1:54326/api/tenants/realtime-dev';
  let response;
  for (let attempt = 0; attempt < 60; attempt++) {
    response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (response && [200, 404].includes(response.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!response || ![200, 404].includes(response.status)) throw new Error('Realtime management endpoint is not ready.');
  if (response.status === 404) {
    response = await fetch(endpoint, { method: 'PUT', headers, signal: AbortSignal.timeout(30000), body: JSON.stringify({ tenant: {
      name: 'realtime-dev', external_id: 'realtime-dev', jwt_secret: credentials.JWT_SECRET,
      private_only: true, presence_enabled: false,
      max_concurrent_users: 200, max_channels_per_client: 1, max_events_per_second: 100, max_bytes_per_second: 100000,
      extensions: [{ type: 'postgres_cdc_rls', settings: {
        db_name: 'postgres', db_host: 'db', db_user: 'supabase_admin', db_password: credentials.POSTGRES_PASSWORD,
        db_port: '5432', region: 'local', poll_interval_ms: 100, poll_max_record_bytes: 1048576,
        ssl_enforced: false, db_pool: 2, subs_pool_size: 1,
      } }],
    } }) });
    if (!response.ok) throw new Error(`Realtime tenant initialization failed (${response.status}); inspect private service diagnostics.`);
  }
  const current = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5000) });
  const body = await current.json();
  const tenant = body.data;
  if (!current.ok || tenant?.private_only !== true || tenant?.presence_enabled !== false || tenant?.max_concurrent_users !== 200 || tenant?.max_channels_per_client !== 1) {
    throw new Error('Existing Realtime tenant differs from the reviewed private-only configuration; it was not overwritten.');
  }
  for (let attempt = 0; attempt < 45; attempt++) {
    const health = await fetch(`${endpoint}/health`, { headers, signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (health?.ok) {
      console.log('Local official Realtime ready; private-only tenant, Presence disabled, configured limit200 (capacity still requires measurement).');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Realtime tenant health did not become ready.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await ensureLocalRealtime();

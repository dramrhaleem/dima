// Hosted Supabase only. Read-only preflight unless --apply is explicitly supplied.
import { readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (!args.includes('--config') || args.some((arg, i) => !['--apply', '--config'].includes(arg) && args[i - 1] !== '--config')) {
  throw new Error('Usage: node scripts/production-migrate.mjs --config /private/connection.json [--apply]');
}
const configPath = resolve(args[args.indexOf('--config') + 1] ?? '');
function privateFile(path) {
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('Connection and credential files must be private (0600).');
  return readFileSync(path, 'utf8');
}
const config = JSON.parse(privateFile(configPath));
if (!/^[a-z]{20}$/.test(config.projectRef ?? '') || config.database !== 'postgres' || Number(config.port) !== 5432) {
  throw new Error('Require explicit hosted projectRef, database postgres and direct/session port 5432.');
}
const direct = config.host === `db.${config.projectRef}.supabase.co` && config.user === 'postgres';
const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(config.host ?? '') && config.user === `postgres.${config.projectRef}`;
if (!direct && !pooler) throw new Error('Connection host/user must identify the selected hosted Supabase project.');
const password = privateFile(resolve(config.passwordFile)).trim();
if (password.length < 16 || /[\r\n\0]/.test(password)) throw new Error('Invalid password file.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realtimeAdapter = readFileSync(resolve(root, 'supabase/deployment/hosted_realtime_policy.sql'), 'utf8');
const adapterHash = createHash('sha256').update(realtimeAdapter).digest('hex');
const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => {
  const source = readFileSync(resolve(root, 'supabase/migrations', name), 'utf8');
  let sql = source;
  const adapted = name === '20261101024000_rooms_jobs.sql';
  if (adapted) {
    const installer = /CREATE FUNCTION public\.install_room_realtime_policy\(\) RETURNS boolean\n[\s\S]*?END \$\$;(?=\nSELECT public\.install_room_realtime_policy\(\);)/g;
    if ([...source.matchAll(installer)].length !== 1) throw new Error('Hosted Realtime adapter no longer matches the reviewed installer.');
    sql = source.replace(installer, () => realtimeAdapter.trimEnd());
  }
  return { name, version: name.slice(0, 14), sql, hash: createHash('sha256').update(source).digest('hex'), effectiveHash: createHash('sha256').update(sql).digest('hex'), adapterHash: adapted ? adapterHash : null, disposition: name === '20261031180000_foundation_checks.sql' ? 'skipped-development-probe' : adapted ? 'applied-hosted-realtime-policy' : 'applied' };
});
if (new Set(migrations.map(item => item.version)).size !== migrations.length) throw new Error('Duplicate migration version.');
const env = {
  ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user,
  PGDATABASE: config.database, PGPASSWORD: password, PGSSLMODE: 'require',
  PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'dima-production-migrations',
  PGOPTIONS: '-c search_path=public,extensions -c statement_timeout=120000 -c lock_timeout=15000',
};
const clientArgs = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
const native = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
const container = config.psqlContainer;
if (!native && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container ?? '')) throw new Error('Install psql or configure an existing psqlContainer.');
const logPath = resolve(dirname(configPath), 'migration-private.log');
const envKeys = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'PGSSLMODE', 'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGOPTIONS'];
function sql(query, operation) {
  const argv = native ? clientArgs : ['exec', '-i', ...envKeys.flatMap(key => ['-e', key]), container, 'psql', ...clientArgs];
  const result = spawnSync(native ? 'psql' : 'docker', argv, { input: query, env, encoding: 'utf8', maxBuffer: 5e6, timeout: 180000 });
  if (result.status !== 0) {
    // Error text can contain connection details or SQL values; it stays outside Git.
    writeFileSync(logPath, `${operation}\n${result.stdout ?? ''}\n${result.stderr ?? ''}\n`, { mode: 0o600 });
    throw new Error(`${operation} failed; private diagnostics saved beside the connection config.`);
  }
  return result.stdout.trim();
}
const userObjects = `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`;
const snapshot = JSON.parse(sql(`BEGIN READ ONLY; SELECT json_build_object(
  'roles', (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
  'authUsers', to_regclass('auth.users') IS NOT NULL,
  'authUid', to_regprocedure('auth.uid()') IS NOT NULL,
  'realtimeMessages', to_regclass('realtime.messages') IS NOT NULL,
  'realtimeTopic', to_regprocedure('realtime.topic()') IS NOT NULL,
  'btreeGistAvailable', EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='btree_gist'),
  'receipts', to_regclass('dima_deploy.migrations') IS NOT NULL,
  'userObjects', (SELECT count(*) FROM (${userObjects}) found)); COMMIT;`, 'Hosted preflight'));
if (snapshot.roles !== 3 || !snapshot.authUsers || !snapshot.authUid || !snapshot.realtimeMessages || !snapshot.realtimeTopic || !snapshot.btreeGistAvailable) {
  throw new Error('Hosted prerequisites are not ready; require Auth, Realtime, btree_gist and standard API roles.');
}
const receipts = snapshot.receipts ? JSON.parse(sql("SELECT coalesce(json_agg(row_to_json(r)), '[]'::json) FROM (SELECT version,sha256,disposition,coalesce(to_jsonb(m)->>'effective_sha256',sha256) AS effective_sha256 FROM dima_deploy.migrations m ORDER BY version) r;", 'Read migration receipts')) : [];
if (snapshot.userObjects && !receipts.length) throw new Error('Refusing a nonempty public schema without recognized Dima deployment receipts.');
for (const receipt of receipts) {
  const source = migrations.find(item => item.version === receipt.version);
  if (!source || source.hash !== receipt.sha256 || source.disposition !== receipt.disposition || source.effectiveHash !== receipt.effective_sha256) throw new Error(`Migration receipt mismatch: ${receipt.version}.`);
}
if (receipts.some((receipt, index) => receipt.version !== migrations[index]?.version)) throw new Error('Migration receipts must form an ordered prefix; manual reconciliation required.');
const completed = new Set(receipts.map(item => item.version));
const pending = migrations.filter(item => !completed.has(item.version));
console.log(JSON.stringify({ projectRef: config.projectRef, mode: args.includes('--apply') ? 'apply' : 'read-only', prerequisites: snapshot, recorded: receipts.length, pending: pending.map(item => ({ file: item.name, disposition: item.disposition })) }, null, 2));
if (!args.includes('--apply')) process.exit(0);
const lock = "SELECT pg_advisory_xact_lock(hashtextextended('dima-hosted-migration-v1',0));";
sql(`BEGIN; ${lock}
DO $$ BEGIN
 IF to_regclass('dima_deploy.migrations') IS NULL AND EXISTS(${userObjects}) THEN
  RAISE EXCEPTION 'Unreceipted public schema changed since preflight';
 END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS dima_deploy;
REVOKE ALL ON SCHEMA dima_deploy FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS dima_deploy.migrations(version text PRIMARY KEY, filename text NOT NULL, sha256 text NOT NULL, disposition text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE dima_deploy.migrations ADD COLUMN IF NOT EXISTS effective_sha256 text;
ALTER TABLE dima_deploy.migrations ADD COLUMN IF NOT EXISTS adapter_sha256 text;
UPDATE dima_deploy.migrations SET effective_sha256=sha256 WHERE effective_sha256 IS NULL;
ALTER TABLE dima_deploy.migrations ALTER COLUMN effective_sha256 SET NOT NULL;
REVOKE ALL ON dima_deploy.migrations FROM PUBLIC,anon,authenticated,service_role;
-- Match local explicit-grant semantics rather than legacy Supabase auto exposure.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
COMMIT;`, 'Initialize isolated deployment receipts and explicit defaults');
for (const migration of pending) {
  sql(`BEGIN; ${lock}
DO $$ BEGIN IF EXISTS(SELECT 1 FROM dima_deploy.migrations WHERE version='${migration.version}') THEN RAISE EXCEPTION 'Migration recorded concurrently; rerun preflight'; END IF; END $$;
${migration.disposition !== 'skipped-development-probe' ? migration.sql : '-- The B0 development-only probe is deliberately not installed.'}
INSERT INTO dima_deploy.migrations(version,filename,sha256,effective_sha256,adapter_sha256,disposition) VALUES('${migration.version}','${migration.name}','${migration.hash}','${migration.effectiveHash}',${migration.adapterHash ? `'${migration.adapterHash}'` : 'NULL'},'${migration.disposition}');
NOTIFY pgrst,'reload schema'; COMMIT;`, `Migration ${migration.name}`);
  console.log(`${migration.disposition}: ${migration.name}`);
}
const verification = JSON.parse(sql(`BEGIN READ ONLY; SELECT json_build_object(
 'receipts',(SELECT count(*) FROM dima_deploy.migrations),
 'developmentProbeAbsent',to_regclass('public.foundation_checks') IS NULL,
 'realtimePolicy',EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='dima_room_broadcast_read'),
 'realtimeRlsEnabled',(SELECT relrowsecurity FROM pg_class WHERE oid='realtime.messages'::regclass),
 'realtimeClientWriteDenials',(SELECT count(*)=3 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND permissive='RESTRICTIVE' AND policyname IN ('dima_room_no_client_insert','dima_room_no_client_update','dima_room_no_client_delete')),
 'anonCannotMutateTime',NOT has_function_privilege('anon','public.execute_time_command(uuid,jsonb)','EXECUTE'),
 'authenticatedCannotForgeTimeActor',NOT has_function_privilege('authenticated','public.execute_time_command(uuid,jsonb)','EXECUTE'),
 'serviceCanMutateTime',has_function_privilege('service_role','public.execute_time_command(uuid,jsonb)','EXECUTE'),
 'serviceCannotReadRolesDirectly',NOT has_table_privilege('service_role','public.account_roles','SELECT'),
 'publicCatalogCount',(SELECT count(*) FROM public.catalog_offerings WHERE status='published')
 ); COMMIT;`, 'Read final deployment state'));
const success = verification.receipts === migrations.length && verification.developmentProbeAbsent && verification.realtimePolicy && verification.realtimeRlsEnabled && verification.realtimeClientWriteDenials && verification.anonCannotMutateTime && verification.authenticatedCannotForgeTimeActor && verification.serviceCanMutateTime && verification.serviceCannotReadRolesDirectly;
mkdirSync(resolve(root, 'docs/evidence'), { recursive: true });
writeFileSync(resolve(root, 'docs/evidence/B7_HOSTED_MIGRATIONS.json'), JSON.stringify({ checkedAt: new Date().toISOString(), projectRef: config.projectRef, success, verification, migrations: migrations.map(({ name, version, hash, effectiveHash, adapterHash, disposition }) => ({ name, version, sha256: hash, effectiveSha256: effectiveHash, adapterSha256: adapterHash, disposition })) }, null, 2) + '\n');
console.log(JSON.stringify({ success, verification }, null, 2));
if (!success) throw new Error('Deployment verification failed; inspect the scoped evidence.');

import { existsSync, lstatSync, readFileSync, writeFileSync, rmSync, chmodSync, statSync } from 'node:fs';

export function isRegularBuildFile(path) {
  try { return lstatSync(path).isFile(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function syncLocalVariables(source, target) {
  if (!existsSync(source)) {
    // The caller has already verified the build mirror's ownership marker.
    rmSync(target, { force: true });
    return;
  }
  const whitelist = new Set(['DIMA_B0_ENABLED', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DIMA_CLIENT_ORIGINS', 'DIMA_APP_ORIGIN', 'DIMA_GOOGLE_ENABLED', 'SUPABASE_SERVICE_ROLE_KEY', 'DIMA_JOBS_TOKEN', 'DIMA_REALTIME_SIGNING_SECRET']);
  const values = readFileSync(source, 'utf8').split('\n').filter(line => whitelist.has(line.split('=')[0]));
  writeFileSync(target, values.join('\n') + '\n', { mode: 0o600 });
  chmodSync(target, 0o600);
  if ((statSync(target).mode & 0o077) !== 0) { rmSync(target, { force: true }); throw new Error('Worker environment requires private POSIX file permissions'); }
}

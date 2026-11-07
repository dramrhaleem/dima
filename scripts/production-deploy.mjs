// Repeatable deployment of the already-built, source-matched Dima Worker.
// Never reads/uploads secrets and never changes local development configuration.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRegularBuildFile } from './worker-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/production-deploy.mjs [--dry-run | --deploy]\nDefault: verify build fingerprint and run Wrangler dry-run. Existing Worker secrets are reused; none are read or uploaded.');
  process.exit(0);
}
if (args.length > 1 || args.some(arg => !['--dry-run', '--deploy'].includes(arg))) throw new Error('Expected --dry-run or --deploy; no other deployment target is accepted.');
const deploy = args.includes('--deploy');
const mirrorConfigPath = resolve(root, '.local/worker-build.json');
if (!existsSync(mirrorConfigPath)) throw new Error('A verified Worker build mirror is required; configure .local/worker-build.json through the existing build workflow.');
const mirror = JSON.parse(readFileSync(mirrorConfigPath, 'utf8'));
const buildRoot = resolve(mirror.directory);
if (!isAbsolute(mirror.directory) || buildRoot === root || root.startsWith(buildRoot + '/')) throw new Error('Unsafe build mirror path.');
const ownerPath = resolve(buildRoot, '.dima-build-owner');
const manifestPath = resolve(buildRoot, '.dima-build-inputs.json');
if (!existsSync(ownerPath) || readFileSync(ownerPath, 'utf8') !== root || !existsSync(manifestPath)) throw new Error('Missing project-owned build receipt; run pnpm build.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
if (git.status !== 0) throw new Error('Cannot inventory current build inputs.');
// This is the same inventory/digest contract used by scripts/worker.mjs.
const files = [...new Set(git.stdout.split('\0').filter(path => /^(apps\/|packages\/|assets\/reference-ui\/|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|tsconfig.json$|\.npmrc$)/.test(path)))].filter(path => isRegularBuildFile(resolve(root, path))).sort();
const hash = createHash('sha256');
for (const file of files) { hash.update(file); hash.update(readFileSync(resolve(root, file))); }
const fingerprint = hash.digest('hex');
if (manifest.source !== root || manifest.fingerprint !== fingerprint || JSON.stringify(manifest.files) !== JSON.stringify(files)) throw new Error('Build inputs changed or receipt differs; run pnpm build before deployment.');
const main = resolve(buildRoot, 'apps/web/.open-next/worker.js');
const assets = resolve(buildRoot, 'apps/web/.open-next/assets');
if (!isRegularBuildFile(main) || !existsSync(assets)) throw new Error('Compiled Worker/assets missing; run pnpm build.');

const outputRoot = resolve(root, '.local/production-deploy');
mkdirSync(outputRoot, { recursive: true });
const configPath = resolve(outputRoot, 'wrangler.json');
const config = {
  name: 'dima-web',
  account_id: '2d027cf73931dd1e69aedaddcf801700',
  main,
  compatibility_date: '2026-10-23',
  compatibility_flags: ['nodejs_compat'],
  assets: { directory: assets, binding: 'ASSETS' },
  services: [{ binding: 'WORKER_SELF_REFERENCE', service: 'dima-web' }],
  workers_dev: false,
  preview_urls: false,
  routes: [{ pattern: 'dima.study', custom_domain: true }],
  vars: { DIMA_B0_ENABLED: 'false', DIMA_APP_ORIGIN: 'https://dima.study', DIMA_GOOGLE_ENABLED: 'true' },
  observability: { enabled: true },
};
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ mode: deploy ? 'deploy' : 'dry-run', worker: config.name, accountId: config.account_id, domain: 'dima.study', fingerprint, builtAt: manifest.builtAt, secrets: 'Existing Worker secrets reused; no upload performed by this script.' }, null, 2));
const command = ['--filter', '@dima/web', 'exec', 'wrangler', 'deploy', '--config', configPath, '--keep-vars'];
if (!deploy) command.push('--dry-run', '--outdir', resolve(outputRoot, 'dry-run'));
const result = spawnSync('pnpm', command, { cwd: buildRoot, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(resolve(outputRoot, deploy ? 'last-deploy.json' : 'last-dry-run.json'), JSON.stringify({ completedAt: new Date().toISOString(), mode: deploy ? 'deploy' : 'dry-run', worker: config.name, accountId: config.account_id, domain: 'dima.study', fingerprint, builtAt: manifest.builtAt, cliExitCode: 0, liveOperationVerified: false }, null, 2) + '\n');
console.log(deploy ? 'Deployment command succeeded. Check the new version and essential HTTPS flows before claiming live operation.' : 'Dry-run succeeded. Nothing was uploaded.');

// Optional build mirror for machines whose dependency store is outside the repo.
// The standard path (including CI) builds in this repository without a mirror.
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isRegularBuildFile, syncLocalVariables } from './worker-files.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['build', 'preview'].includes(mode)) throw new Error('Expected build or preview');
const localConfig = resolve(root, '.local/worker-build.json');
const config = existsSync(localConfig) ? JSON.parse(readFileSync(localConfig, 'utf8')) : null;
const sourceFiles = () => {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (git.status !== 0) throw new Error('Cannot inventory project build inputs');
  return [...new Set(git.stdout.split('\0').filter(path => /^(apps\/|packages\/|assets\/reference-ui\/|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|tsconfig.json$|\.npmrc$)/.test(path)))].filter(path => isRegularBuildFile(resolve(root, path))).sort();
};
const digest = files => {
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file); hash.update(readFileSync(resolve(root, file))); }
  return hash.digest('hex');
};
function run(args, cwd) {
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
let buildRoot = root;
if (config) {
  buildRoot = resolve(config.directory);
  if (!isAbsolute(config.directory) || buildRoot === root || root.startsWith(buildRoot + '/')) throw new Error('Unsafe build mirror path');
  const marker = resolve(buildRoot, '.dima-build-owner');
  if (existsSync(buildRoot) && (!existsSync(marker) || readFileSync(marker, 'utf8') !== root)) throw new Error('Build mirror not owned by this project');
  mkdirSync(buildRoot, { recursive: true });
  writeFileSync(marker, root);
  const files = sourceFiles();
  const manifestPath = resolve(buildRoot, '.dima-build-inputs.json');
  const fingerprint = digest(files);
  if (mode === 'build') {
    const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { files: [] };
    for (const oldFile of previous.files) {
      const target = resolve(buildRoot, oldFile);
      if (!files.includes(oldFile) && relative(buildRoot, target).startsWith('..') === false) rmSync(target, { force: true });
    }
    for (const file of files) { const target = resolve(buildRoot, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(resolve(root, file), target); }
    run(['install', '--frozen-lockfile', '--offline', '--store-dir', config.storeDirectory, '--virtual-store-dir', resolve(buildRoot, 'node_modules/.pnpm')], buildRoot);
    run(['--filter', '@dima/web', 'build:worker'], buildRoot);
    writeFileSync(manifestPath, JSON.stringify({ source: root, fingerprint, files, builtAt: new Date().toISOString() }, null, 2) + '\n');
    console.log('Workers build mirror matches the current project source.');
    process.exit(0);
  }
  if (!existsSync(manifestPath) || JSON.parse(readFileSync(manifestPath, 'utf8')).fingerprint !== fingerprint) throw new Error('Build inputs changed; run pnpm build before preview.');

}
if (mode === 'build') run(['--filter', '@dima/web', 'build:worker'], buildRoot);
else {
  // Keep server credentials on the private source filesystem, never on a build mirror.
  const runtimeEnv = resolve(root, '.local/worker-preview.env');
  mkdirSync(dirname(runtimeEnv), { recursive: true, mode: 0o700 });
  syncLocalVariables(resolve(root, 'apps/web/.dev.vars'), runtimeEnv);
  const child = spawn('pnpm', ['--filter', '@dima/web', 'exec', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', '8787', '--local', '--inspector-port', '9231', ...(existsSync(runtimeEnv) ? ['--env-file', runtimeEnv] : [])], { cwd: buildRoot, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('exit', code => process.exit(code ?? 1));
}

// Capacity sampling; optional guard signals only this supervisor's own load child.
import assert from 'node:assert/strict';
import { openSync, writeSync, closeSync, statfsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import { bindStopSignals, createAllocationSampler, createCapacityGuard, guardedLoadArguments, MINIMUM_FREE_BYTES, supervisedExitCode } from './capacity-safeguards.mjs';

const [secondsText, outputText, ...options] = process.argv.slice(2);
const seconds = Number(secondsText), output = resolve(outputText ?? '');
const privateRoot = '/dev/shm/dima-worker-runtime';
assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 10000);
assert.ok(options.every(option => ['--guard-load', '--allocation-metadata', '--initial-join-burst'].includes(option)));
assert.equal(new Set(options).size, options.length);
const loadArguments = guardedLoadArguments(options);
assert.equal(dirname(output), privateRoot);
const directory = statSync(privateRoot);
assert.equal(directory.uid, process.getuid());
assert.equal(directory.mode & 0o777, 0o700);
const fd = openSync(output, 'wx', 0o600);
const started = Date.now(), guarded = options.includes('--guard-load');
const emit = value => writeSync(fd, JSON.stringify(value) + '\n');
const available = path => { const value = statfsSync(path); return value.bavail * value.bsize; };
let minimum = Infinity, maximum = 0, count = 0, total = 0, finished = false;
let poll, writer, deadline, attributionTimer, child, guard, unbindSignals, signalSent = false;
let interrupted = false;
const stopReasons = new Set();
const attribution = options.includes('--allocation-metadata') ? createAllocationSampler({
  codexRoot: '/home/amro/.codex', rootDevice: statSync(process.cwd()).dev,
}) : null;
emit({ type: 'metadata', startedAt: new Date(started).toISOString(), requestedSeconds: seconds,
  intervalMs: 200, flushMs: 1000, source: 'filesystem available blocks; no user file contents or database queries',
  guardedLoad: guarded, loadArguments: guarded ? loadArguments : null, minimumFreeBytes: guarded ? MINIMUM_FREE_BYTES : null,
  allocationMetadataIntervalMs: attribution ? 10000 : null });
function stopChild() {
  if (!child || signalSent || child.exitCode !== null || child.signalCode !== null) return false;
  signalSent = true;
  return child.kill('SIGINT');
}
function sample() {
  const free = available(process.cwd());
  minimum = Math.min(minimum, free); maximum = Math.max(maximum, free); count++; total++;
  if (guard?.(free)) interrupted = true;
}
function flush() {
  if (!count) return;
  emit({ type: 'sample', at: new Date().toISOString(), samples: count,
    sourceFreeMinimumBytes: minimum, sourceFreeMaximumBytes: maximum,
    observerFreeBytes: available(privateRoot) });
  minimum = Infinity; maximum = 0; count = 0;
}
function finish(reason) {
  if (finished) return;
  finished = true; clearInterval(poll); clearInterval(writer); clearTimeout(deadline); clearInterval(attributionTimer);
  unbindSignals?.();
  flush(); emit({ type: 'summary', endedAt: new Date().toISOString(), reason, samples: total });
  closeSync(fd); console.log(JSON.stringify({ output, reason, samples: total }));
}
function stop(reason) {
  if (child && child.exitCode === null && child.signalCode === null) {
    interrupted = true;
    if (!stopReasons.has(reason)) emit({ type: 'supervisor-stop-request', at: new Date().toISOString(), reason });
    stopReasons.add(reason);
    stopChild(); // Keep sampling until orderly load cleanup exits. Never force-kill.
  } else finish(reason);
}
sample();
if (guarded && minimum < MINIMUM_FREE_BYTES) {
  emit({ type: 'environment-start-refused', freeBytes: minimum, thresholdBytes: MINIMUM_FREE_BYTES });
  process.exitCode = 1; finish('insufficient-startup-capacity');
} else {
  poll = setInterval(sample, 200); writer = setInterval(flush, 1000);
  if (attribution) { emit(attribution()); attributionTimer = setInterval(() => emit(attribution()), 10000); }
  deadline = setTimeout(() => stop('duration'), seconds * 1000);
  if (guarded) {
    // A new process group avoids a terminal signal being delivered twice to the child.
    // Only child.kill(SIGINT), never a process-group kill or a discovered PID, is used.
    child = spawn(process.execPath, [fileURLToPath(new URL('../../tests/integration/rooms-load.mjs', import.meta.url)), ...loadArguments],
      { cwd: process.cwd(), stdio: 'inherit', detached: true });
    emit({ type: 'load-child-started', at: new Date().toISOString(), childPid: child.pid });
    guard = createCapacityGuard({ get pid() { return child.pid; }, get exitCode() { return child.exitCode; },
      get signalCode() { return child.signalCode; }, kill: stopChild }, emit);
    child.once('error', error => { emit({ type: 'load-child-error', code: error.code ?? 'UNKNOWN' }); process.exitCode = 1; finish('load-start-error'); });
    child.once('exit', (code, signal) => {
      const supervisorCode = supervisedExitCode(code, interrupted);
      emit({ type: 'load-child-exit', at: new Date().toISOString(), code, signal, interrupted, supervisorCode });
      process.exitCode = supervisorCode; finish('load-exited');
    });
  }
  unbindSignals = bindStopSignals(process, stop);
}

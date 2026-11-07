import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export const MINIMUM_FREE_BYTES = 1024 ** 3;

export const supervisedExitCode = (childCode, interrupted) => interrupted ? 1 : (childCode ?? 1);

export function guardedLoadArguments(options) {
  if (!options.includes('--initial-join-burst')) return [];
  if (!options.includes('--guard-load')) throw Error('Initial burst requires an owned guarded load child');
  return ['--probe', '--initial-join-burst', '--seconds=120', '--varied-seconds=60'];
}

export function selectMetadataFds(descriptors, limit) {
  const ordered = descriptors.filter(fd => /^\d+$/.test(fd)).sort((a, b) => Number(a) - Number(b));
  if (ordered.length <= limit) return ordered;
  const tail = Math.floor(limit / 2);
  return [...ordered.slice(0, Math.ceil(limit / 2)), ...(tail ? ordered.slice(-tail) : [])];
}

export function bindStopSignals(emitter, stop) {
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  emitter.on('SIGINT', interrupt); emitter.on('SIGTERM', terminate);
  return () => { emitter.removeListener('SIGINT', interrupt); emitter.removeListener('SIGTERM', terminate); };
}

// The caller supplies only the ChildProcess it spawned; no PID discovery or group signal.
export function createCapacityGuard(child, emit, threshold = MINIMUM_FREE_BYTES) {
  let stopped = false;
  return freeBytes => {
    if (stopped || freeBytes >= threshold || child.exitCode !== null || child.signalCode !== null) return false;
    stopped = true;
    emit({ type: 'environment-abort', at: new Date().toISOString(), freeBytes, thresholdBytes: threshold,
      childPid: child.pid, signal: 'SIGINT', verdict: 'environment interruption; no product verdict' });
    emit({ type: 'environment-abort-signal', delivered: child.kill('SIGINT') });
    return true;
  };
}

const knownDatabases = ['goals_1.sqlite', 'thread_history_1.sqlite', 'memories_v2_1.sqlite',
  'memories_1.sqlite', 'logs_2.sqlite', 'queue_1.sqlite', 'state_5.sqlite'];

// Reads kernel counters and file metadata only. Never reads SQLite data, paths from FDs,
// process command lines, environment, or user file contents.
export function createAllocationSampler({ codexRoot, procRoot = '/proc', rootDevice,
  maximumProcesses = 512, maximumWriters = 8, maximumFds = 64 } = {}) {
  let previous = new Map();
  return () => {
    const started = performance.now(), sqlite = [];
    for (const name of knownDatabases) for (const suffix of ['', '-wal', '-shm']) {
      try {
        const s = statSync(join(codexRoot, name + suffix));
        sqlite.push({ name: name + suffix, bytes: s.size, allocatedBytes: s.blocks * 512, rootFilesystem: s.dev === rootDevice });
      } catch { /* A missing or concurrently replaced SQLite sidecar is normal. */ }
    }
    let pids = [];
    try { pids = readdirSync(procRoot).filter(p => /^\d+$/.test(p)).sort((a, b) => Number(a) - Number(b)); } catch { /* Report empty coverage. */ }
    const candidates = [], next = new Map();
    let unavailable = 0;
    for (const pid of pids.slice(0, maximumProcesses)) {
      try {
        const status = readFileSync(join(procRoot, pid, 'stat'), 'utf8');
        const startTicks = status.slice(status.lastIndexOf(')') + 2).split(' ')[19];
        const io = readFileSync(join(procRoot, pid, 'io'), 'utf8');
        const writeBytes = Number(/^write_bytes:\s*(\d+)$/m.exec(io)?.[1]);
        if (!Number.isFinite(writeBytes) || !/^\d+$/.test(startTicks)) throw Error('Unavailable process counters');
        const key = `${pid}:${startTicks}`, deltaWriteBytes = previous.has(key) ? Math.max(0, writeBytes - previous.get(key)) : null;
        next.set(key, writeBytes);
        candidates.push({ pid: Number(pid), startTicks, writeBytes, deltaWriteBytes });
      } catch { unavailable++; }
    }
    previous = next;
    candidates.sort((a, b) => (b.deltaWriteBytes ?? b.writeBytes) - (a.deltaWriteBytes ?? a.writeBytes));
    const writers = candidates.slice(0, maximumWriters).map(writer => {
      let descriptors = [], deletedRegularBytes = 0, deletedAllocatedBytes = 0, deletedRegularFiles = 0, unreadableFds = 0;
      try { descriptors = readdirSync(join(procRoot, String(writer.pid), 'fd')).filter(f => /^\d+$/.test(f)); } catch { unreadableFds++; }
      const seen = new Set();
      for (const fd of selectMetadataFds(descriptors, maximumFds)) {
        try {
          const s = statSync(join(procRoot, String(writer.pid), 'fd', fd));
          if (!s.isFile() || s.nlink !== 0 || s.dev !== rootDevice || seen.has(s.ino)) continue;
          seen.add(s.ino); deletedRegularBytes += s.size; deletedAllocatedBytes += s.blocks * 512; deletedRegularFiles++;
        } catch { unreadableFds++; }
      }
      return { ...writer, deletedRegularBytes, deletedAllocatedBytes, deletedRegularFiles,
        sampledFds: Math.min(descriptors.length, maximumFds), omittedFds: Math.max(0, descriptors.length - maximumFds), unreadableFds,
        fdSelection: 'Numeric head ceil(limit/2) + tail floor(limit/2) when over limit; otherwise all' };
    });
    return { type: 'allocation-metadata', at: new Date().toISOString(), sqlite, writers,
      processCoverage: { observed: pids.length, sampled: Math.min(pids.length, maximumProcesses), readable: candidates.length,
        unavailable, omitted: Math.max(0, pids.length - maximumProcesses) }, durationMs: performance.now() - started,
      limitation: 'Bounded metadata snapshot; inaccessible processes/FDs and writers outside top8 are not attributed. Deleted inode de-duplication is per process, not global. Counters are cumulative process IO, not proof of filesystem allocation cause.' };
  };
}

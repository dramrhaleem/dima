import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync, openSync, closeSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { bindStopSignals, createAllocationSampler, createCapacityGuard, guardedLoadArguments, MINIMUM_FREE_BYTES, selectMetadataFds, supervisedExitCode } from '../../scripts/local-backend/capacity-safeguards.mjs';

describe('environment capacity safeguard', () => {
  it('preserves the default workload and maps only the owned burst mode to its fixed probe arguments', () => {
    expect(guardedLoadArguments(['--guard-load'])).toEqual([]);
    expect(guardedLoadArguments(['--allocation-metadata'])).toEqual([]);
    expect(guardedLoadArguments(['--guard-load', '--initial-join-burst'])).toEqual([
      '--probe', '--initial-join-burst', '--seconds=120', '--varied-seconds=60',
    ]);
    expect(() => guardedLoadArguments(['--initial-join-burst'])).toThrow('owned guarded load child');
  });
  it('never reports supervisor success after an interruption even if the child exits zero', () => {
    expect(supervisedExitCode(0, true)).toBe(1);
    expect(supervisedExitCode(0, false)).toBe(0);
    expect(supervisedExitCode(7, false)).toBe(7);
    expect(supervisedExitCode(null, false)).toBe(1);
  });
  it('keeps signal handlers installed during repeated cleanup signals until explicitly unbound', () => {
    const emitter = new EventEmitter(), reasons = [];
    const unbind = bindStopSignals(emitter, reason => reasons.push(reason));
    for (const signal of ['SIGINT', 'SIGINT', 'SIGTERM', 'SIGTERM']) emitter.emit(signal);
    expect(reasons).toEqual(['SIGINT', 'SIGINT', 'SIGTERM', 'SIGTERM']);
    expect(emitter.listenerCount('SIGINT')).toBe(1);
    expect(emitter.listenerCount('SIGTERM')).toBe(1);
    unbind();
    expect(emitter.listenerCount('SIGINT')).toBe(0);
    expect(emitter.listenerCount('SIGTERM')).toBe(0);
  });
  it('signals only the supplied live child, once, below the threshold', () => {
    const events = [], signals = [];
    const child = { pid: 123, exitCode: null, signalCode: null, kill: signal => { signals.push(signal); return true; } };
    const guard = createCapacityGuard(child, event => events.push(event));
    expect(guard(MINIMUM_FREE_BYTES)).toBe(false);
    expect(guard(MINIMUM_FREE_BYTES - 1)).toBe(true);
    expect(guard(0)).toBe(false);
    expect(signals).toEqual(['SIGINT']);
    expect(events[0]).toMatchObject({ type: 'environment-abort', childPid: 123, verdict: 'environment interruption; no product verdict' });
  });
  it('never signals an exited child or an already signaled child', () => {
    for (const state of [{ exitCode: 0, signalCode: null }, { exitCode: null, signalCode: 'SIGTERM' }]) {
      const guard = createCapacityGuard({ ...state, kill() { throw Error('Must not signal'); } }, () => {});
      expect(guard(0)).toBe(false);
    }
  });
  it('records failed delivery without unbounded repeat signals', () => {
    const events = [], guard = createCapacityGuard({ pid: 5, exitCode: null, signalCode: null, kill: () => false }, event => events.push(event));
    guard(1); guard(1);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: 'environment-abort-signal', delivered: false });
  });
});

describe('bounded allocation metadata', () => {
  it('samples numeric head and tail descriptors within the unchanged bound', () => {
    expect(selectMetadataFds(['100', '2', '1', '99', '10'], 4)).toEqual(['1', '2', '99', '100']);
    expect(selectMetadataFds(['9', '1', '2'], 1)).toEqual(['1']);
    expect(selectMetadataFds(['9', '1'], 64)).toEqual(['1', '9']);
  });
  it('bounds process/FD coverage, attributes deltas, and reads deleted-file metadata without paths or contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'dima-capacity-test-'));
    let held;
    try {
      const codexRoot = join(root, 'codex'), procRoot = join(root, 'proc');
      mkdirSync(codexRoot); mkdirSync(procRoot);
      writeFileSync(join(codexRoot, 'state_5.sqlite'), 'PRIVATE SQLITE CONTENT');
      writeFileSync(join(codexRoot, 'unlisted.sqlite'), 'PRIVATE UNLISTED CONTENT');
      const counters = (pid, bytes, start = '42') => {
        const fields = Array(20).fill('0'); fields[19] = start;
        mkdirSync(join(procRoot, pid, 'fd'), { recursive: true });
        writeFileSync(join(procRoot, pid, 'stat'), `${pid} (private process name) ${fields.join(' ')}`);
        writeFileSync(join(procRoot, pid, 'io'), `write_bytes: ${bytes}\n`);
      };
      counters('1', 100); counters('2', 10); counters('3', 999);
      const deleted = join(root, 'private-deleted-file'); writeFileSync(deleted, 'secret');
      held = openSync(deleted, 'r'); unlinkSync(deleted);
      symlinkSync(`/proc/self/fd/${held}`, join(procRoot, '1', 'fd', '1'));
      symlinkSync(`/proc/self/fd/${held}`, join(procRoot, '1', 'fd', '2'));
      const sample = createAllocationSampler({ codexRoot, procRoot, rootDevice: statSync(root).dev,
        maximumProcesses: 2, maximumWriters: 1, maximumFds: 1 });
      const first = sample();
      expect(first.processCoverage).toMatchObject({ observed: 3, sampled: 2, readable: 2, omitted: 1 });
      expect(first.writers[0]).toMatchObject({ pid: 1, deltaWriteBytes: null, deletedRegularBytes: 6, omittedFds: 1 });
      expect(first.sqlite.map(s => s.name)).toEqual(['state_5.sqlite']);
      counters('2', 300);
      expect(sample().writers[0]).toMatchObject({ pid: 2, deltaWriteBytes: 290 });
      counters('2', 500, '99');
      expect(sample().writers[0]).toMatchObject({ pid: 2, deltaWriteBytes: null, startTicks: '99' });
      expect(JSON.stringify(first)).not.toMatch(/PRIVATE|secret|private process|private-deleted|unlisted/);
    } finally { if (held !== undefined) closeSync(held); rmSync(root, { recursive: true, force: true }); }
  });
});

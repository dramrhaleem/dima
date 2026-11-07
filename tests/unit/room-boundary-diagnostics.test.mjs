import { expect, it } from 'vitest';
import { createBoundaryDiagnostics } from '../helpers/room-load-client.mjs';

it('correlates delayed request completion and fresh snapshot with the old boundary after a new anchor', () => {
  let wall = 10000, mono = 50;
  const trace = createBoundaryDiagnostics({ now: () => wall, monotonic: () => mono });
  trace.arm('0:80', { connectionIndex: 80, role: 'secondary', roomIndex: 0, expectedBoundaryMs: 12000,
    anchorServerMs: 10000, anchorMonotonicMs: mono, anchorRevision: 7 });
  trace.event('0:80', { type: 'time-boundary-scheduled', expectedBoundaryMs: 12000, timerDueMonotonicMs: 2200 });
  wall = 12100; mono = 2150;
  const request = trace.startRequest('0:80', { requestId: 4, reason: 'phase-boundary', endpoint: 'rooms.snapshot' });
  trace.arm('0:80', { connectionIndex: 80, role: 'secondary', roomIndex: 0, expectedBoundaryMs: 20000,
    anchorServerMs: 12100, anchorMonotonicMs: mono, anchorRevision: 8 });
  trace.event('0:80', { type: 'boundary-confirmed', requestId: 4, expectedBoundaryMs: 12000, serverTimeMs: 12100, readinessMs: 100 });
  wall = 40000; mono = 30050;
  trace.endRequest(request, { statusCode: 200, serverTiming: { rpc: 90, auth: 10 } });
  const record = trace.report.records[0];
  expect(record.expectedBoundaryMs).toBe(12000); expect(record.initialAnchor.anchorRevision).toBe(7);
  expect(record.firstFreshSnapshot.requestId).toBe(4); expect(record.timeTimer.timerDueMonotonicMs).toBe(2200);
  expect(record.requests[0]).toMatchObject({ requestId: 4, endedAtMs: 40000, durationMs: 27900, serverTiming: { rpc: 90, auth: 10 } });
});

it('caps records, requests and events and excludes payload, headers and arbitrary strings', () => {
  const trace = createBoundaryDiagnostics({ now: () => 10000, monotonic: () => 50, maxRecords: 1, maxRequests: 1, maxEvents: 1 });
  for (const key of ['0:0', '0:1']) trace.arm(key, { connectionIndex: 0, roomIndex: 0, role: 'primary', expectedBoundaryMs: 10000 });
  const token = trace.startRequest('0:0', { requestId: 1, endpoint: 'rooms.me', reason: 'phase-boundary', headers: { Authorization: 'secret' }, body: { name: 'Private Person' } });
  trace.endRequest(token, { statusCode: 200, serverTiming: { rpc: 22, token: 'secret' }, body: { roster: ['Private Person'] } });
  expect(trace.startRequest('0:0', { requestId: 2 })).toBeNull();
  trace.event('0:0', { type: 'boundary-confirmed', expectedBoundaryMs: 10000, readinessMs: 0, private: 'secret' });
  trace.event('0:0', { type: 'snapshot-outcome', reason: 'private content with spaces' });
  trace.event('0:1', { type: 'boundary-confirmed', expectedBoundaryMs: 10000 });
  expect(trace.report.records).toHaveLength(1); expect(trace.report.records[0].requests).toHaveLength(1);
  expect(trace.report.records[0].events).toHaveLength(1); expect(trace.report.dropped).toEqual({ records: 1, requests: 1, events: 1 });
  expect(JSON.stringify(trace.report.records)).not.toMatch(/Private Person|secret|Authorization|roster|private content/);
});

it('does not materialize distant future boundaries or mix adjacent room distributions', () => {
  let wall = 10000;
  const trace = createBoundaryDiagnostics({ now: () => wall });
  trace.arm('0:0', { connectionIndex: 0, role: 'primary', roomIndex: 0, expectedBoundaryMs: 100000 });
  trace.event('0:0', { type: 'me-outcome', outcome: 'accepted' });
  expect(trace.report.records).toHaveLength(0);
  wall = 100001; trace.event('0:0', { type: 'boundary-confirmed', expectedBoundaryMs: 100000, readinessMs: 1 });
  trace.close('0:0');
  trace.arm('4:0', { connectionIndex: 0, role: 'primary', roomIndex: 4, expectedBoundaryMs: 100000 });
  trace.event('4:0', { type: 'boundary-confirmed', expectedBoundaryMs: 100000, readinessMs: 1 });
  expect(trace.report.records.map(row => row.connectionKey)).toEqual(['0:0', '4:0']);
});

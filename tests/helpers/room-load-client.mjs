// HTTP/state portion of one foreground room tab. No DOM, fake time, or network mocks
// are used by the load runner; unit tests inject transport and scheduling only.
export function createRoomOperation(uuid) {
  let pending = null;
  return {
    get pending() { return pending?.command ?? null; },
    prepare(fields, revision) {
      const intent = { ...fields };
      for (const key of ['expectedTimeRevision', 'controlVersion', 'timeControlVersion', 'presenceControlVersion', 'roomVersion']) delete intent[key];
      const signature = JSON.stringify(intent);
      if (pending?.signature !== signature) pending = { signature, command: { ...fields, expectedRevision: revision, operationId: uuid() } };
      return pending.command;
    },
    succeeded() { pending = null; },
    failed(error) { if (error.status >= 400 && error.status < 500 && error.status !== 429) pending = null; },
  };
}
export const closedGrantDelay = attempt => Math.min(30000, 1000 * 2 ** attempt);
export const transientGrantDelay = 30000;
const higherFloor = (left, right) => left === undefined ? right : right === undefined ? left : Math.max(left, right);

export function createRoomLoadClient({ owner, roomId, request, now = () => globalThis.performance.now(),
  schedule = (callback, milliseconds) => setTimeout(callback, milliseconds), cancel = globalThis.clearTimeout,
  onMe = () => {}, onTime = () => {}, onSnapshot = () => {}, onError = () => {}, onDiagnostic = () => {} }) {
  let diagnosticRequestId = 0;
  const observe = event => { try { onDiagnostic(event); } catch { /* Diagnostics cannot alter the workload. */ } };
  const requestMeta = (reason, { minimumServerTime, minimumTimeRevision } = {}) => ({ requestId: ++diagnosticRequestId, reason, minimumServerTime, minimumTimeRevision });
  let me = null, time = null, snapshot = null, roomAnchor = null, timeAnchor = null;
  let closed = false, realtimeDenied = false, epoch = 0, meFlight = null, timeFlight = null;
  let requiredTimeFreshness = null;
  let refreshing = false, dirty = false, refreshTimer = null, componentKey = null, refreshScope = 0;
  let boundaryTimer = null, leaseTimer = null, snapshotRetry = null;
  let roomBoundaryTimer = null, roomBoundaryRetry = null, roomBoundaryKey = null, roomBoundaryGeneration = 0;
  let coverage = { scope: null, wanted: -1, covered: -1 };
  const snapshots = new Map(), effects = new Set();
  const serverNow = () => roomAnchor ? roomAnchor.server + Math.max(0, now() - roomAnchor.at) : 0;
  const timeNow = () => timeAnchor ? timeAnchor.server + Math.max(0, now() - timeAnchor.at) : 0;
  const live = () => !closed && me?.membership?.roomId === roomId && me.membership.status === 'active'
    && Date.parse(me.membership.seatExpiresAt) > serverNow();
  const scope = () => `${owner}:${me?.membership?.roomId}:${me?.membership?.id}:${me?.membership?.controlVersion}`;
  function spawn(promise, stage) {
    const safe = Promise.resolve(promise).catch(error => { if (!closed) onError(stage, error); });
    effects.add(safe); safe.finally(() => effects.delete(safe)); return safe;
  }
  function invalidatePermission() { epoch++; requiredTimeFreshness = null; }
  function clearSnapshot() { invalidatePermission(); snapshot = null; componentKey = null; coverage.covered = -1; syncRoomBoundaryEffect(); }
  function fresher(value, previous) {
    return !previous || value.revision > previous.revision
      || value.revision === previous.revision && Date.parse(value.serverTime) >= Date.parse(previous.serverTime);
  }
  function acceptTime(value, deferRoomEffect = false, diagnostic = {}) {
    if (closed || value.accountId !== owner || !fresher(value, time)) { observe({ type: 'time-outcome', outcome: 'discarded', ...diagnostic }); return false; }
    const previous = time?.active;
    time = value; timeAnchor = { server: Date.parse(value.serverTime), at: now() };
    onTime(value);
    observe({ type: 'time-outcome', outcome: 'accepted', ...diagnostic, revision: value.revision, serverTimeMs: Date.parse(value.serverTime) });
    if (boundaryTimer !== null) cancel(boundaryTimer);
    boundaryTimer = null;
    const interval = value.active?.status === 'running' ? value.intervals.find(item => item.sessionId === value.active.id && item.endAt === null) : null;
    if (interval) {
      const timerDelay = Math.max(100, Date.parse(interval.boundaryAt) - timeAnchor.server + 150);
      const diagnostic = { type: 'time-boundary-scheduled', expectedBoundaryMs: Date.parse(interval.boundaryAt),
        timerDueMonotonicMs: now() + timerDelay, anchorServerMs: timeAnchor.server, anchorMonotonicMs: timeAnchor.at, anchorRevision: value.revision };
      observe(diagnostic);
      boundaryTimer = schedule(() => {
        observe({ ...diagnostic, type: 'time-boundary-dispatched', anchorAgeMs: now() - diagnostic.anchorMonotonicMs,
          dispatchLagMs: now() - diagnostic.timerDueMonotonicMs });
        boundaryTimer = null; spawn(loadTime('time-boundary'), 'time-boundary');
      }, timerDelay);
    }
    if (previous && previous.id !== value.active?.id && !value.sessions.some(session => session.id === previous.id && session.status === 'finalized')) {
      spawn(request(`time?sessionId=${encodeURIComponent(previous.id)}`, requestMeta('saved-session-detail')), 'saved-session-detail');
    }
    const reconcile = () => {
      if (closed || me?.membership?.roomId !== roomId || me.membership.status !== 'active' || time.revision <= me.timeRevision) return;
      if (live()) return refreshKnown('time-room-effect', { minimumServerTime: Date.parse(time.serverTime), minimumTimeRevision: time.revision });
      return refresh('time-room-effect'); // Expired presence requires Me-first recovery.
    };
    // React effects see both TimeData and RoomMe from the completed command turn.
    spawn(Promise.resolve().then(() => { if (!deferRoomEffect) return reconcile(); }), 'time-room-effect');
    return true;
  }
  function acceptMe(value, observedTimeRevision = time?.revision ?? -1, diagnostic = {}) {
    if (closed || value.accountId !== owner || !fresher(value, me)) { observe({ type: 'me-outcome', outcome: 'discarded', ...diagnostic }); return false; }
    const previous = me?.membership;
    const member = value.membership;
    if (!member || member.status !== 'active' || Date.parse(member.seatExpiresAt) <= Date.parse(value.serverTime)
      || previous?.id !== member.id || previous?.controlVersion !== member.controlVersion) clearSnapshot();
    me = value;
    if (coverage.scope !== scope()) {
      coverage = { scope: scope(), wanted: -1, covered: -1 };
      // A new subscription effect owns a separate refresh chain in the browser.
      refreshScope++; refreshing = false; dirty = false;
      if (refreshTimer !== null) cancel(refreshTimer);
      if (snapshotRetry !== null) cancel(snapshotRetry);
      refreshTimer = null; snapshotRetry = null;
    }
    roomAnchor = { server: Date.parse(value.serverTime), at: now() }; onMe(value);
    observe({ type: 'me-outcome', outcome: 'accepted', ...diagnostic, revision: value.revision, timeRevision: value.timeRevision,
      serverTimeMs: roomAnchor.server, roomVersion: value.room?.version, hintVersion: value.room?.hintVersion, controlGeneration: member?.controlVersion });
    if (leaseTimer !== null) cancel(leaseTimer);
    leaseTimer = null;
    if (member?.status === 'active') leaseTimer = schedule(() => { leaseTimer = null; clearSnapshot(); spawn(loadMe('seat-expiry'), 'seat-expiry'); }, Math.max(0, Date.parse(member.seatExpiresAt) - serverNow()));
    if (value.timeRevision > observedTimeRevision) spawn(loadTime('room-time-effect'), 'room-time-effect');
    syncRoomBoundaryEffect();
    return true;
  }
  function loadTime(reason = 'time-read') {
    if (closed) return Promise.resolve();
    if (timeFlight) { observe({ type: 'time-read-coalesced', reason }); return timeFlight; }
    timeFlight = Promise.resolve().then(async () => {
      const diagnostic = requestMeta(reason);
      try { acceptTime((await request('time?limit=1', diagnostic)).data, false, diagnostic); }
      catch (error) { observe({ type: 'time-outcome', outcome: 'error', ...diagnostic, statusCode: error.status }); if (!closed) onError('time-read', error); }
      finally { timeFlight = null; }
    });
    return timeFlight;
  }
  function loadMe(reason = 'me-read') {
    if (closed) return Promise.resolve(false);
    if (meFlight) { observe({ type: 'me-read-coalesced', reason }); return meFlight; }
    meFlight = Promise.resolve().then(async () => {
      const diagnostic = requestMeta(reason);
      try { return acceptMe((await request(`rooms/me?roomId=${roomId}`, diagnostic)).data, time?.revision ?? -1, diagnostic); }
      catch (error) { observe({ type: 'me-outcome', outcome: 'error', ...diagnostic, statusCode: error.status }); if (!closed) { if ([401, 403].includes(error.status)) clearSnapshot(); onError('me-read', error); } return false; }
      finally { meFlight = null; }
    });
    return meFlight;
  }
  function snapshotFor(retries = 1, reason = 'snapshot', freshness = {}) {
    let diagnostic = { reason, ...freshness };
    const outcome = (status, value) => { observe({ type: 'snapshot-outcome', ...diagnostic, outcome: status, epoch, retries,
      serverTimeMs: value ? Date.parse(value.serverTime) : undefined, roomVersion: value?.room?.version, hintVersion: value?.room?.hintVersion,
      phaseKey: value?.room?.phase?.kind, phaseRound: value?.room?.phase?.roundIndex, wantedVersion: coverage.wanted, coveredVersion: coverage.covered }); return { status, epoch }; };
    if (!live()) return Promise.resolve(outcome('discarded'));
    const generation = epoch, ownScope = scope(), hints = coverage;
    if (requiredTimeFreshness?.scope !== ownScope || requiredTimeFreshness.epoch !== generation) requiredTimeFreshness = null;
    if (freshness.minimumTimeRevision !== undefined) requiredTimeFreshness = {
      scope: ownScope, epoch: generation,
      minimumServerTime: higherFloor(requiredTimeFreshness?.minimumServerTime, freshness.minimumServerTime),
      minimumTimeRevision: higherFloor(requiredTimeFreshness?.minimumTimeRevision, freshness.minimumTimeRevision),
    };
    const minimumServerTime = higherFloor(freshness.minimumServerTime, requiredTimeFreshness?.minimumServerTime);
    const minimumTimeRevision = higherFloor(freshness.minimumTimeRevision, requiredTimeFreshness?.minimumTimeRevision);
    const key = `${ownScope}:${generation}:${me.revision}:${me.serverTime}:${minimumServerTime ?? ''}:${minimumTimeRevision ?? ''}`;
    if (snapshots.has(key)) { observe({ type: 'snapshot-coalesced', reason, epoch, retries }); return snapshots.get(key); }
    const ownsRequest = () => !closed && generation === epoch && scope() === ownScope;
    const read = async () => {
      try {
        diagnostic = requestMeta(reason, { minimumServerTime, minimumTimeRevision });
        const value = (await request(`rooms/${roomId}/snapshot`, diagnostic)).data;
        if (!ownsRequest() || !live() || value.accountId !== owner) return outcome('discarded', value);
        if (value.access.membershipId !== me.membership.id || value.access.generation !== me.membership.controlVersion) return outcome('reconcile', value);
        if (Date.parse(value.access.seatExpiresAt) <= serverNow()) return outcome('retry', value);
        const latestRequired = requiredTimeFreshness?.scope === ownScope && requiredTimeFreshness.epoch === generation ? requiredTimeFreshness : null;
        const serverFloor = higherFloor(minimumServerTime, latestRequired?.minimumServerTime);
        const revisionFloor = higherFloor(minimumTimeRevision, latestRequired?.minimumTimeRevision);
        diagnostic = { ...diagnostic, minimumServerTime: serverFloor, minimumTimeRevision: revisionFloor };
        if (serverFloor !== undefined && Date.parse(value.serverTime) < serverFloor) return outcome('retry', value);
        if (revisionFloor !== undefined && value.me.timeRevision < revisionFloor) return outcome('retry', value);
        if (value.room.hintVersion < hints.wanted) return outcome('retry', value);
        if (me.room?.id === roomId && (value.room.version < me.room.version || value.room.hintVersion < me.room.hintVersion)) return outcome('retry', value);
        if (snapshot && (value.room.version < snapshot.room.version || value.room.hintVersion < snapshot.room.hintVersion
          || Date.parse(value.serverTime) < Date.parse(snapshot.serverTime))) return outcome('discarded', value);
        if (!acceptMe(value.me, time?.revision ?? -1, diagnostic)) return outcome('retry', value);
        hints.covered = Math.max(hints.covered, value.room.hintVersion);
        snapshot = value; onSnapshot(value, diagnostic); syncRoomBoundaryEffect();
        const mounted = `${value.room.run?.id ?? 'lobby'}:${value.room.phase.roundIndex ?? 0}`;
        if (mounted !== componentKey) {
          componentKey = mounted;
          spawn(request('learning', requestMeta('private-activity-list')), 'private-activity-list');
        }
        return outcome('accepted', value);
      } catch (error) {
        if (!ownsRequest()) return outcome('discarded');
        const identity = error.status === 401 || error.code === 'ACCOUNT_CHANGED';
        const denied = [403, 404, 410].includes(error.status);
        if (identity || denied) clearSnapshot();
        onError('snapshot-read', error);
        return outcome(identity ? 'identity' : denied ? 'denied' : 'unavailable');
      }
    };
    const flight = Promise.resolve().then(async () => {
      let result;
      try { result = await read(); } finally { snapshots.delete(key); }
      if (result.status === 'retry' && retries > 0 && live() && ownsRequest()) return snapshotFor(retries - 1, reason, freshness);
      return result;
    });
    snapshots.set(key, flight); return flight;
  }
  async function refresh(reason = 'refresh') { observe({ type: 'refresh-requested', reason }); await loadMe(reason); if (live()) await snapshotFor(1, reason); }
  async function refreshKnown(reason = 'known-refresh', freshness) {
    observe({ type: 'refresh-known-requested', reason });
    const ownScope = scope();
    const result = await snapshotFor(1, reason, freshness);
    if (closed || result.epoch !== epoch || scope() !== ownScope) return { status: 'discarded', epoch };
    if (result.status !== 'reconcile' && result.status !== 'denied') return result;
    const confirmed = await loadMe('snapshot-reconcile');
    if (result.status === 'reconcile' && !confirmed) return { status: result.epoch === epoch ? 'unavailable' : 'discarded', epoch };
    if (result.status === 'reconcile' && !closed && result.epoch === epoch && scope() === ownScope && live()) return snapshotFor(1, 'snapshot-reconcile', freshness);
    return result;
  }
  function syncRoomBoundaryEffect() {
    // RoomView's effect depends on deadline + membership scope/live, not each
    // clock-anchor update. An accepted private snapshot wins over Me fallback.
    const room = snapshot?.room ?? me?.room;
    const deadline = room?.phase?.endsAt ? Date.parse(room.phase.endsAt) : null;
    const key = live() && Number.isFinite(deadline) ? `${scope()}:${deadline}` : null;
    if (key === roomBoundaryKey) return;
    roomBoundaryKey = key; const generation = ++roomBoundaryGeneration;
    if (roomBoundaryTimer !== null) cancel(roomBoundaryTimer);
    if (roomBoundaryRetry !== null) cancel(roomBoundaryRetry);
    roomBoundaryTimer = null; roomBoundaryRetry = null;
    if (!key) return;
    const delay = Math.max(100, deadline - serverNow() + 200);
    const diagnostic = { expectedBoundaryMs: deadline, timerDueMonotonicMs: now() + delay,
      anchorServerMs: roomAnchor.server, anchorMonotonicMs: roomAnchor.at, anchorRevision: me.revision };
    observe({ type: 'room-boundary-scheduled', ...diagnostic });
    const refresh = async () => {
      const result = await refreshKnown('phase-boundary', { minimumServerTime: deadline });
      if (generation === roomBoundaryGeneration && (result.status === 'unavailable' || result.status === 'retry')) {
        const due = now() + 750;
        observe({ type: 'room-boundary-retry-scheduled', expectedBoundaryMs: deadline, timerDueMonotonicMs: due });
        roomBoundaryRetry = schedule(() => {
          roomBoundaryRetry = null;
          if (generation !== roomBoundaryGeneration) return;
          observe({ type: 'room-boundary-retry-dispatched', expectedBoundaryMs: deadline, timerDueMonotonicMs: due, dispatchLagMs: now() - due });
          spawn(refreshKnown('phase-boundary-retry', { minimumServerTime: deadline }), 'room-boundary-retry');
        }, 750);
      }
    };
    roomBoundaryTimer = schedule(() => {
      roomBoundaryTimer = null;
      if (generation !== roomBoundaryGeneration) return;
      observe({ type: 'room-boundary-dispatched', reason: 'phase-boundary', ...diagnostic,
        anchorAgeMs: now() - diagnostic.anchorMonotonicMs, dispatchLagMs: now() - diagnostic.timerDueMonotonicMs });
      spawn(refresh(), 'room-boundary');
    }, delay);
  }
  function queueRefresh() {
    if (!live() || realtimeDenied) return;
    dirty = true;
    if (refreshing || refreshTimer !== null) return;
    refreshTimer = schedule(() => {
      refreshTimer = null;
      if (!live() || realtimeDenied || !dirty) return;
      refreshing = true; dirty = false;
      const ownScope = scope(), chainScope = refreshScope;
      spawn((async () => {
        try {
          const result = await refreshKnown('hint-refresh');
          if (chainScope !== refreshScope) return;
          if (result.status === 'denied' || result.status === 'identity') {
            dirty = false;
            if (snapshotRetry !== null) cancel(snapshotRetry);
            snapshotRetry = null;
          } else if (['unavailable', 'retry'].includes(result.status) && !realtimeDenied && live() && scope() === ownScope && snapshotRetry === null) {
            const targetVersion = Math.max(coverage.wanted, me.room?.hintVersion ?? -1);
            snapshotRetry = schedule(() => {
              snapshotRetry = null;
              if (!closed && !realtimeDenied && live() && scope() === ownScope
                && coverage.covered < Math.max(targetVersion, coverage.wanted, me.room?.hintVersion ?? -1)) queueRefresh();
            }, 30000);
          }
        } finally {
          if (chainScope === refreshScope) {
            refreshing = false;
            if (!realtimeDenied && dirty && live() && scope() === ownScope) queueRefresh();
          }
        }
      })(), 'hint-refresh');
    }, 120);
  }
  async function acceptCommand(response, type) {
    const oldTimeRevision = time?.revision ?? -1;
    if (response.time) acceptTime(response.time, true, { reason: `command:${type}` });
    if (type !== 'renewPresence') invalidatePermission();
    // Mirror the effect-maintained Focus reference in RoomsProvider.accept.
    acceptMe(response.data, oldTimeRevision, { reason: `command:${type}` });
    if (live()) await snapshotFor(1, `command:${type}`);
  }
  async function settle() {
    while (effects.size || meFlight || timeFlight || snapshots.size) {
      await Promise.allSettled([...effects, meFlight, timeFlight, ...snapshots.values()].filter(Boolean));
    }
  }
  return {
    get me() { return me; }, get time() { return time; }, get snapshot() { return snapshot; }, get epoch() { return epoch; },
    serverNow, timeNow, live, loadMe, loadTime, snapshotFor, refresh, refreshKnown,
    refreshBoundary: minimumServerTime => refreshKnown('phase-boundary', { minimumServerTime }), acceptMe, acceptTime, acceptCommand, settle,
    connected() { realtimeDenied = false; queueRefresh(); },
    invalidate(version) {
      if (!live() || realtimeDenied || !Number.isSafeInteger(version) || version <= Math.max(coverage.wanted, coverage.covered)) return;
      coverage.wanted = version; invalidatePermission(); queueRefresh();
    },
    denyRealtime() {
      realtimeDenied = true; clearSnapshot(); dirty = false;
      if (refreshTimer !== null) cancel(refreshTimer);
      if (snapshotRetry !== null) cancel(snapshotRetry);
      refreshTimer = null; snapshotRetry = null;
    },
    close() {
      closed = true; clearSnapshot(); dirty = false;
      for (const timer of [refreshTimer, boundaryTimer, leaseTimer, snapshotRetry]) if (timer !== null) cancel(timer);
      refreshTimer = null; boundaryTimer = null; leaseTimer = null; snapshotRetry = null;
    },
  };
}

// Bounded, payload-free observation for the real-wall-clock load harness only.
// It never schedules work or changes a request. Pending anchors are one per tab;
// records materialize only near a real phase boundary, not for future deadlines.
export function createBoundaryDiagnostics({ now = () => Date.now(), monotonic = () => globalThis.performance.now(),
  maxRecords = 1000, maxRequests = 32, maxEvents = 80, beforeMs = 3000, afterMs = 15000 } = {}) {
  const pending = new Map(), records = [], byKey = new Map();
  const dropped = { records: 0, requests: 0, events: 0 };
  const numeric = ['requestId', 'expectedBoundaryMs', 'timerDueMonotonicMs', 'dispatchLagMs', 'anchorServerMs', 'anchorMonotonicMs', 'anchorAgeMs',
    'anchorRevision', 'revision', 'timeRevision', 'roomVersion', 'hintVersion', 'serverTimeMs', 'epoch', 'retries', 'wantedVersion', 'coveredVersion',
    'controlGeneration', 'minimumServerTime', 'minimumTimeRevision', 'readinessMs', 'phaseRound', 'requestDurationMs', 'statusCode'];
  const textual = ['type', 'reason', 'outcome', 'phaseKey', 'endpoint'];
  const safe = input => Object.fromEntries([
    ...numeric.filter(key => Number.isFinite(input?.[key])).map(key => [key, input[key]]),
    ...textual.filter(key => typeof input?.[key] === 'string' && /^[a-zA-Z0-9_:/.-]{1,80}$/.test(input[key])).map(key => [key, input[key]]),
  ]);
  function recordFor(key, expected) {
    const state = pending.get(key), at = now();
    const candidates = expected === undefined ? [state?.expectedBoundaryMs, state?.previousBoundaryMs] : [expected];
    const boundary = candidates.find(value => Number.isFinite(value) && at >= value - beforeMs && at <= value + afterMs);
    if (boundary === undefined || !state) return null;
    const identity = `${key}:${boundary}`;
    if (byKey.has(identity)) return byKey.get(identity);
    if (records.length >= maxRecords) { dropped.records++; return null; }
    const anchor = boundary === state.expectedBoundaryMs ? state.anchor : state.previousAnchor;
    const record = { connectionKey: key, connectionIndex: state.connectionIndex, role: state.role, roomIndex: state.roomIndex,
      expectedBoundaryMs: boundary, expectedUtc: new Date(boundary).toISOString(), initialAnchor: state.initialAnchors.get(boundary) ?? anchor,
      latestAnchor: anchor, timeTimer: state.timeTimer, events: [], requests: [], firstFreshSnapshot: null, droppedEvents: 0, droppedRequests: 0 };
    records.push(record); byKey.set(identity, record); return record;
  }
  return {
    arm(key, metadata) {
      if (!Number.isFinite(metadata.expectedBoundaryMs)) return;
      let state = pending.get(key);
      if (!state) {
        state = { connectionIndex: metadata.connectionIndex, roomIndex: metadata.roomIndex, role: metadata.role,
          expectedBoundaryMs: metadata.expectedBoundaryMs, initialAnchors: new Map() }; pending.set(key, state);
      }
      if (state.expectedBoundaryMs !== metadata.expectedBoundaryMs) {
        state.previousBoundaryMs = state.expectedBoundaryMs; state.previousAnchor = state.anchor;
        state.expectedBoundaryMs = metadata.expectedBoundaryMs;
      }
      state.anchor = safe(metadata);
      if (!state.initialAnchors.has(state.expectedBoundaryMs)) state.initialAnchors.set(state.expectedBoundaryMs, state.anchor);
      // Only current and previous anchors are needed; historical records own copies.
      for (const boundary of state.initialAnchors.keys()) if (boundary !== state.expectedBoundaryMs && boundary !== state.previousBoundaryMs) state.initialAnchors.delete(boundary);
      const record = byKey.get(`${key}:${state.expectedBoundaryMs}`); if (record) record.latestAnchor = state.anchor;
    },
    event(key, input) {
      const data = safe(input), state = pending.get(key);
      if (input.type === 'time-boundary-scheduled' && state) state.timeTimer = data;
      const record = recordFor(key, input.expectedBoundaryMs);
      if (!record) return;
      const event = { atMs: now(), monotonicMs: monotonic(), ...data };
      if (record.events.length < maxEvents) record.events.push(event); else { record.droppedEvents++; dropped.events++; }
      if (input.type === 'boundary-confirmed' && !record.firstFreshSnapshot) record.firstFreshSnapshot = event;
    },
    startRequest(key, input) {
      const record = recordFor(key); if (!record) return null;
      if (record.requests.length >= maxRequests) { record.droppedRequests++; dropped.requests++; return null; }
      const request = { ...safe(input), startedAtMs: now(), startedMonotonicMs: monotonic(), endedAtMs: null, durationMs: null };
      record.requests.push(request); return request;
    },
    endRequest(request, input) {
      if (!request || request.endedAtMs !== null) return;
      Object.assign(request, safe(input), { endedAtMs: now(), durationMs: monotonic() - request.startedMonotonicMs });
      request.serverTiming = Object.fromEntries(['auth', 'profile', 'rpc', 'sign', 'response', 'total']
        .filter(key => Number.isFinite(input.serverTiming?.[key])).map(key => [key, input.serverTiming[key]]));
    },
    close(key) { pending.delete(key); },
    get report() { return { version: 1, windowBeforeMs: beforeMs, windowAfterMs: afterMs, maxRecords, maxRequestsPerRecord: maxRequests,
      maxEventsPerRecord: maxEvents, dropped, records, limitations: ['Diagnostic observer only; no additional reads, timers or retries.',
        'Request completions are retained after the observation window if their start was captured.', 'No request bodies, headers, tokens, names, participant roster, or account IDs are retained.'] }; },
  };
}

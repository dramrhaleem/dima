// Test-runner coordination only. Production clients never auto-join a round.
// Snapshot readers run outside the action guard, so readiness can advance while
// every mutation guard is held. One synchronous release opens all ready actions.
export async function runCoordinatedBurst(items, { withGuard, ready, action, stopped = () => false,
  now = () => globalThis.performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 30000, onRelease = () => {} }) {
  const started = now(), records = items.map((item, index) => ({ item, index, acquired: false, guardWaitMs: null, ready: null }));
  let release, released = false, failure;
  const gate = new Promise(resolve => { release = resolve; });
  const jobs = records.map(record => withGuard(record.item, async () => {
    record.acquired = true; record.guardWaitMs = now() - started;
    if (await gate) await action(record.item, record);
  }).catch(error => { failure ??= error; }));
  try {
    while (true) {
      if (failure) throw failure;
      if (stopped()) throw Object.assign(new Error('BURST_INTERRUPTED'), { code: 'BURST_INTERRUPTED' });
      if (now() - started >= timeoutMs) throw Object.assign(new Error('BURST_READINESS_TIMEOUT'), { code: 'BURST_READINESS_TIMEOUT' });
      if (records.every(record => record.acquired)) {
        // Validate every current cache together, including the earliest arriver.
        for (const record of records) record.ready = ready(record.item);
        if (records.every(record => record.ready)) break;
      }
      await sleep(25);
    }
    onRelease(records, now() - started);
    released = true; release(true);
  } catch (error) { failure ??= error; }
  finally { if (!released) release(false); }
  await Promise.all(jobs);
  if (failure) throw failure;
  return records;
}

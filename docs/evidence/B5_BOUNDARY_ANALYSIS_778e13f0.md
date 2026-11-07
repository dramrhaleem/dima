# First real boundary: v3 still fails the 2-second gate

Run `778e13f0-b578-4c93-9a28-93ae3a08e80e` stopped after its first real 25-minute transition. **70 of 100** readiness samples exceeded 2,000ms; p95 was **3,580ms**, maximum **3,865ms**. The original report retains `failureCount: 0` because orderly interruption bypasses its final threshold assertions. This is a failed acceptance gate, not a pass.

All 100 bounded client traces were retained with no dropped records, requests or events. Every first-fresh snapshot has a matching request and `serverTime >= deadline`. No snapshot rejection or retry appears in this window.

## What gates the slow clients

Room callbacks dispatched within 7.458ms of their scheduled time (p95 1.109ms). Absolute dispatch was 241–632ms after the server deadline, including the intended 200ms grace and clock-anchor/scheduling offset. Thus timer callback starvation does not explain the multi-second response delay, although the absolute offset consumes part of the budget.

86 first-fresh results came from the independent floor-aware boundary snapshot. 96 winning snapshots overlapped a Time request. Only three clients completed a separate Me HTTP request before first freshness. `me-outcome` events also occur when accepting a snapshot's private projection; they are not proof of a separate Me request.

The slowest client, `0:97`, demonstrates the actual critical path:

| Paired measurement | Value |
| --- | ---: |
| Snapshot starts after deadline | 274ms |
| Snapshot request duration | 3,590.570ms |
| Server-Timing auth | 682ms |
| Server-Timing RPC | 2,335ms |
| Server-Timing total | 3,017ms |
| Request time outside that server total | 573.544ms |
| Response-to-acceptance processing | 0.132ms |
| First eligible freshness | 3,865ms |
| Overlapping Time read | +292ms to +4,283ms |

That client's Time request finished after the winning snapshot: it did not serially gate freshness. RPC timing includes the application-to-RPC call and cannot isolate SQL execution, connection-pool waiting, or row-lock waiting. The uninstrumented remainder is not exclusively network time. These are components of one request; independent percentiles must not be added.

All four rooms exceeded the gate. Room0 had 40 connections (20 controllers plus all 20 secondary tabs), and the other rooms had 20 each. Their readiness maxima were 3,865 / 3,198 / 3,073 / 2,201ms respectively. DB point samples during 05:49:36–40 show transaction/tuple waits alongside active operations; they support contention, not a complete causal attribution.

## Environment and cleanup

Free space stayed above 2,895,601,664 bytes; no guard or ENOSPC event occurred. Metadata scan maximum during the boundary window was 31.757ms. All 14,597 HTTP requests completed without reported HTTP errors; no new deadlocks, missed/late hints or duplicate/open-ledger invariant failures were observed. All 100 sockets closed.

Cleanup released 80 actors and closed four rooms. A subsequent read-only exact-run inventory verified 80 retained accounts, 80 finalized sessions, 80 retained intervals, all memberships left, and zero open intervals. Own jobs ended due0/failed0/future4.

The exact Worker log window is bytes485477–1706972, captured before runtime release at05:51:04Z. DB sampler stopped at1,630 samples; capacity supervisor stopped automatically at8,013 samples after child cleanup. Raw logs and allocation metadata remain private; their SHA manifest is `B5_SUSTAINED_ARCHIVE_778e13f0.json`.

Compared with old v2 run `3a255dcc`, aggregate p95/max are lower (4,152/4,714ms previously), but both fail. The old run lacks per-client traces and the UI/helper behavior and environment differ; this is not an isolated causal performance comparison. The 30-minute transition, later rounds, Auth refresh, varied distribution and full two hours remain unverified.

Source: original `B5_ROOMS_LOAD_SUSTAINED_778e13f0-b578-4c93-9a28-93ae3a08e80e.json`; paired evidence and DB observations: `B5_BOUNDARY_DIAGNOSTICS_778e13f0.json`.

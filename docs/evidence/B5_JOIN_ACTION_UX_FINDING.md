# B5 initial burst: post-commit reconciliation observation

Status: measured request-model observation; visible browser impact is under review. This is a B5 stage finding, not the later whole-product audit.

Source: `B5_ROOMS_LOAD_INITIAL_BURST_PROBE_62ce7f12-10b0-4e85-97ad-70a653dcc70a.json`, build `cd96afe1...`, DB030, current UI workload v2, 80 primary actions released together plus 20 secondary tabs. Actual in-flight JoinRound HTTP requests peaked at80 in each distribution. No clock aging or changed service limits.

| Distribution | JoinRound POST p95 | Full action p95 | Full action maximum |
|---|---:|---:|---:|
| 4 rooms ×20 | 1,822.34ms | 5,493.95ms | 6,240.93ms |
| 8 rooms ×10 | 1,690.38ms | 4,277.73ms | 4,566.46ms |

All160 commands returned200 and exact account→Room/Run/round→Session pairing passed. No HTTP errors, missing/late hints, duplicate active sessions, or deadlocks were recorded. The full action measures `explicitJoinRound` including `roomCommand` and the follow-up snapshot reconciliation; it is not the initial POST latency. The short probe passes its existing2s POST p95 gate, but that alone does not prove immediate visible feedback.

Next verification: hold the post-commit snapshot in a real browser while allowing a successful JoinRound response. Observe when personal timer/accepted state appears, whether the pending indicator is understandable, whether the previous roster stays usable, and whether duplicate submission is possible. This identifies whether the measured tail blocks meaningful interaction or only updates ancillary roster data. Preserve authoritative privacy/version fences and duplicate-operation protection in any correction. Do not infer a6s blank screen from the request-model measurement.

The earlier interrupted7e66ddc7 run showed the same shape (4×20 full-action p95≈5,694ms), but is partial evidence and contributes no second completed burst count.

# Public runtime parent relocation — prepare-only review

No relocation, process signal, configuration change, or new load run has been executed by the preparing agent. The root agent owns independent review and any execution.

## Established cause of the recreated directory

- The source `~/.cache/codex-runtimes/codex-primary-runtime/dependencies` is now a real directory. Its containing runtime inode is 3027561; activation ctime is 2026-11-01T06:07:13.142302Z. The previous verified dependencies-only symlink was inside that replaced runtime directory.
- Current `runtime.json`: bundle `26.1026.10807`, artifact-tool `2.8.106`, Node metadata `24.22.1-cua.1`, Python `3.12.14`. The retained Data2 copy has artifact-tool `2.8.99`; its earlier binary smoke was Node `24.19.0`. This is a newer bundle, not an identical accidental copy. Do not restore the old copy over it.
- Full dependencies inventory: 25,501 regular files / 1,193 symlinks / 1,737,008,647 regular bytes. The retained previous inventory had 25,396 / 1,193 / 1,724,910,091. There are 3,804 changed regular-file hashes or sizes, 199 added paths and 79 removed paths. Link-target differences are not needed to establish the version change.
- Whole current parent contains only the primary runtime and two empty staging trees. Whole runtime: 25,707 regular files, 1,193 links, 1,738,790,921 regular bytes, 1,803,997,184 allocated regular-file bytes. A fresh execution inventory supersedes these diagnostic counts.

## Installed updater source supporting the proposed boundary

Public app archive: `/usr/lib/chatgpt/resources/app.asar` (636,726,307 bytes). Entry `.vite/build/application-network-startup-Bu9OoKJq.js`, SHA256 `cb1550aa4ea151512454654511f42844779cf53ef0300068034bec744cf91487`.

Within function `Yr`, the default `installRoot` is `homedir()/.cache/codex-runtimes`. The installer creates that parent recursively, makes its `codex-runtime-install-*` staging directory inside it, and extracts there. Activation renames the child `codex-primary-runtime` to `codex-primary-runtime.previous`, renames the staged runtime child into place, then removes the previous child. Its `finally` removes its own staging tree. It does not replace the parent in this inspected implementation. The default-root block is around byte 74,800; staging around 76,800; activation around 78,250 in the decoded JS entry.

Therefore relocating the **parent cache** puts both future staging and child replacement on Data2 while retaining the path the application uses. This is grounded in the installed implementation, not a guarantee that every future updater will keep that implementation. No supported user-facing runtime-cache override was established; changing personal `CODEX_HOME` is neither required nor proposed.

The retained staging trees cannot establish the earlier disk spike: `WTSUm2` dates to 2026-10-26T04:08:57Z and `3uaYWn` to 2026-09-18T00:10:14Z. Both have only an empty payload directory. Neither overlaps the 2026-11-01T05:06:46–57Z ENOSPC window. Automatic cleanup can erase evidence of a failed unpack. The inspected install function emits success/failure telemetry but does not itself establish a retry schedule; no private conversation logs were searched. A failed earlier download/unpack remains a plausible, unproven explanation for transient allocation.

## Script and review criteria

Script: `scripts/local-backend/relocate-public-runtime-cache.py`.

1. **Scope and destination:** source is fixed to the public cache parent; expected three top-level entries and empty staging payloads are enforced. Fail on special files, changed top-level scope, nonempty staging, an existing parent symlink, same-device destination, destination redirection, or insufficient Data2 space. Generate a new destination; preserve the earlier Data2 bundle, projects, personal Codex state, and all other paths.
2. **Complete evidence:** source manifest includes root and every directory, file and link; file SHA256, exact link text, device/inode, ownership/mode, size, timestamps and link count. Target comparison requires identical entry types/sets, regular contents and link targets. Source POSIX metadata is recorded; Data2 filesystem permissions/inodes need not equal source metadata. Executable behavior is checked. `copytree` does not promise the same hardlink graph.
3. **No false installer-lock claim:** a private advisory lock prevents two copies of this script only. The application updater does not share that lock. The final critical section explicitly pauses only its positively identified sole same-user Electron main PID (exact executable, no Electron `--type` role, caller-supplied start ticks, not already stopped). Repeat the sole-main check under pause. Normal signal delivery is polled using only deadline/identity checks until the stopped state is observed. No process-group signals or permanent settings.
4. **Exclude active independent writers:** the separate helper `scripts/local-backend/inspect-public-runtime-processes.py` is invoked through fixed `sudo -n /usr/bin/python3 -B` argv with structured JSON stdin. It performs read-only process inspection; all copy, rename, signals and deletion remain unprivileged. Noninteractive sudo was already available; no sudo/config changes are made. Scan all PIDs, including root-owned userspace processes, and fail on a writable public-cache FD, directory FD, or inode-bound cwd. Inspect inode/FD flags, not FD/cwd path text, environments or personal file contents. The main-role check reads only known Electron executable cmdline metadata for a `--type` role; no arguments leave the helper. Support actual argv and the observed flattened Electron process titles. Report coverage and blocker PID/type only. Tolerate disappeared processes/closed FDs; explicitly count zombies and kernel threads. Unknown access errors, changed live identities, invalid output, sudo failure, or the 3-second subprocess timeout fail closed. The outer watchdog remains independent. This removes the earlier root-process assumption, but point-in-time process scans are not a global filesystem lock.
5. **Bounded quiescence:** copy, full target hashing, pre-pause source full rehash and target metadata checks happen while the app runs. Under pause, perform a fast source metadata drift check and writer/cwd exclusion, atomic `renameat2(RENAME_EXCHANGE)`, verify the old tree's identity/metadata, and run Node/Python/Git version smoke through the original path. Critical work budget is 10 seconds. A separate watchdog requests an abort at 12 seconds, kills only the owned relocation process if still stuck at 14 seconds, and guarantees identity-checked SIGCONT of the main process. Normal completion/exception also resumes the main process.
6. **Rollback:** an ordinary pre-commit exception exchanges back while the same installer remains paused and the watchdog deadline permits; neither full copy is deleted. If a crash or watchdog kill prevents rollback, the receipt and both copies remain: before exchange the original is intact; after exchange the already hash-verified target is active and the old tree remains under the unique duplicate path. Do not promise rollback across SIGKILL/power loss. Preserve both for manual recovery if the installer resumed unexpectedly.
7. **Destructive boundary last:** after successful smoke/receipt and SIGCONT, rehash the retained target and require its original verified metadata/content; rehash the uniquely renamed duplicate completely, require original metadata (except rename's root ctime), repeat writer/directory-FD/cwd exclusion, and check the source link still targets the intended new directory. Recheck target metadata immediately before cleanup to detect drift during the duplicate rehash. Only then delete that verified duplicate. A pre-deletion failure retains it; interruption during deletion leaves the verified target plus whatever portion of the duplicate remains, recorded as cleanup-incomplete. No process with a cwd there is killed.
8. **After execution:** review the generated receipt, actual stopped duration, source link, current bundle versions and filesystem free space. Confirm Dima health and current preview independently. No B5 acceptance claim follows from freeing disk. The unchanged guard must still refuse load below 1 GiB.

## Proposed execution, only after root review

Recheck PID/start identity immediately; the values below are an observed snapshot, not permission to signal a reused PID:

```sh
python3 scripts/local-backend/relocate-public-runtime-cache.py \
  --execute \
  --installer-pid 3394 \
  --installer-start-ticks 3794 \
  --expected-bundle 26.1026.10807
```

Pure tests use temporary fixtures and mocked signals only:

```sh
python3 -B -m unittest discover -s tests/unit -p test_public_runtime_relocation.py
```

Data2 must remain mounted for the desktop runtime to work. No fstab, shell environment, personal config, or automatic maintenance job is added.

## Privileged read-only preflight evidence

Unprivileged inspection was blocked at PID 1038, the same-user systemd manager. Privileged metadata confirmed `/usr/lib/systemd/systemd`, 132 FD stats with no cache matches, and a cwd outside the cache. Exact kernel-policy cause of denial was not inferred. The first new helper probe intentionally failed because its NUL-only argv parser did not recognize flattened Electron child titles; that probe is preserved. The corrected role parser and subprocess failure/timeout handling have pure regression tests. Read-only successful probes found exactly one selected main and scanned all visible userspace FDs with no public-cache blocker; exact counts, elapsed times and final source hashes are in the preparation JSON. They are startup evidence only; every actual execution repeats these checks.

## 2026-11-01 target-directory allocation comparison repair

Fresh attempt `20261101T095949Z-615a71cd` failed before process stop or exchange. Unlike the earlier attempt, it persisted the complete target hash baseline and the subsequent metadata inventory. Their 29,365-entry sets match. The exact metadata differences are only:

- Target root `.`: directory size 320 to 4096 bytes; blocks 0 to 8.
- `codex-primary-runtime`: directory size 368 to 0 bytes.
- `codex-runtime-install-3uaYWn`: directory size 144 to 0 bytes.

All other recorded metadata match, including directory identity, mode, ownership, link count, mtime and ctime. The baseline SHA256 matches its receipt. Data2 is mounted as fuseblk. These observed directory allocation values do not describe regular-file content; the precise filesystem-internal trigger was not established.

The explicit `target_comparison` helper now excludes **only directory size and blocks**, only when comparing a Data2 target with its own baseline. It is used at all three target checks: before pause, full hash verification after resume, and final metadata verification before duplicate cleanup. Raw inventories remain unchanged and persisted. Every regular-file field and SHA256 remains checked at the applicable full-hash stage; all entry names, types, link targets, directory identities and other directory metadata remain checked. Source and retained-duplicate comparisons remain fully strict, including directory size/blocks; the existing duplicate-root rename ctime exception is unchanged. This narrowly amends the target-metadata requirements in criteria 5 and 7 above. No rebaseline or retry bypass was introduced.

Validation: 17 isolated unit tests pass, including acceptance of directory allocation shifts without mutating manifests; rejection of each other directory/file/link field change; rejection of added, removed or renamed entries; and confirmation that source/duplicate comparisons still reject allocation changes. Comparing the persisted failed-run artifacts passes the new target comparator and still fails the strict generic comparator. This is code and diagnostic-artifact validation, not successful relocation evidence. No relocation or deletion was executed for this repair.

Diagnostic details and SHA256 records are in `/dev/shm/dima-worker-runtime/target-directory-allocation-repair-evidence.json`. Reviewed script SHA256: `5d7e24a857a558d446eec994d8b823a39fee245c564789eb403824a357349f81`. Test file SHA256: `f64e527aceefa8872937c6cd13014b71208df0f0ed20bd644ff3b883246c5cf1`.

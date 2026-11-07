#!/usr/bin/env python3
"""Reviewed, explicit-only relocation of the public desktop runtime cache.

No action without --execute. This is NOT a general home/cache cleanup utility.
See docs/evidence/B5_PUBLIC_RUNTIME_PARENT_RELOCATION_REVIEW.md before running.
"""
import argparse
import ctypes
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid

SOURCE = Path('/home/amro/.cache/codex-runtimes')
DESTINATION = Path('/media/amro/Data2/dima-local-runtime/public-runtime-cache')
INSTALLER = Path('/usr/lib/chatgpt/ChatGPT')
EXPECTED_ENTRIES = {'codex-primary-runtime', 'codex-runtime-install-WTSUm2',
                    'codex-runtime-install-3uaYWn'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().split(') ', 1)[1].split()
        return {'state': fields[0], 'startTicks': fields[19]}
    except (FileNotFoundError, ProcessLookupError):
        return None


def same_process(pid, ticks):
    current = identity(pid)
    return current is not None and current['startTicks'] == ticks


def inspect_processes(request, timeout=3):
    helper = Path(__file__).with_name('inspect-public-runtime-processes.py').resolve()
    try:
        completed = subprocess.run(
            ['/usr/bin/sudo', '-n', '/usr/bin/python3', '-B', str(helper)],
            input=json.dumps(request), capture_output=True, text=True, timeout=timeout)
        result = json.loads(completed.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raise RuntimeError('Privileged read-only process inspection failed or timed out') from None
    require(isinstance(result, dict) and result.get('mode') == request['mode']
            and isinstance(result.get('coverage'), dict)
            and isinstance(result.get('blockers'), list),
            'Invalid privileged process inspection response')
    require(completed.returncode == 0 and result.get('ok') is True
            and result['coverage'].get('blockers') == 0 and not result['blockers']
            and result.get('blockersTruncated') == 0,
            'Process exclusion not established: ' + json.dumps(result['blockers']))
    return result


def assert_single_installer_main(pid, ticks):
    return inspect_processes({'mode': 'main', 'pid': pid, 'startTicks': ticks})


def wait_until_stopped(pid, ticks, deadline_check):
    while True:
        deadline_check()
        current = identity(pid)
        require(current is not None and current['startTicks'] == ticks,
                'Installer exited before quiescence')
        if current['state'] in ('T', 't'):
            return
        time.sleep(.01)


def inventory(root, hashes=True):
    """Never follows a package symlink. Includes the root and every entry."""
    result = {}
    pending = [root]
    while pending:
        path = pending.pop()
        before = path.lstat()
        item = {key: getattr(before, 'st_' + key) for key in
                ('dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size',
                 'mtime_ns', 'ctime_ns', 'blocks')}
        if stat.S_ISLNK(before.st_mode):
            item.update(type='symlink', target=os.readlink(path))
        elif stat.S_ISDIR(before.st_mode):
            item['type'] = 'directory'
            pending.extend(path.iterdir())
        elif stat.S_ISREG(before.st_mode):
            item['type'] = 'file'
            if hashes:
                item['sha256'] = digest(path)
        else:
            raise RuntimeError(f'Unexpected file type at public relative path {path.relative_to(root)}')
        after = path.lstat()
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns), 'Source changed while inspecting an entry')
        result[str(path.relative_to(root))] = item
    return result


def metadata(manifest, moved_root=False):
    answer = {name: {key: value for key, value in item.items() if key != 'sha256'}
              for name, item in manifest.items()}
    if moved_root:
        answer['.'].pop('ctime_ns', None)  # rename updates the root directory ctime
    return answer


def target_comparison(manifest, hashes=True):
    """Compare Data2 targets without directory allocation bookkeeping.

    fuseblk can change directory size/blocks after copying without changing
    the directory identity, timestamps or entries. Keep raw inventories intact;
    this exception must never be used for the source or retained duplicate.
    """
    answer = {}
    for name, item in manifest.items():
        ignored = {'size', 'blocks'} if item['type'] == 'directory' else set()
        if not hashes:
            ignored.add('sha256')
        answer[name] = {key: value for key, value in item.items() if key not in ignored}
    return answer


def payload(manifest):
    return {name: {key: item[key] for key in ('type', 'sha256', 'target') if key in item}
            for name, item in manifest.items()}


def json_write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def exchange(left, right):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                       ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))


def assert_no_public_writers(manifest):
    nodes = [[item['dev'], item['ino'], item['type']] for item in manifest.values()]
    return inspect_processes({'mode': 'writers', 'nodes': nodes})


def smoke(root, expected_bundle):
    runtime = root / 'codex-primary-runtime'
    package = json.loads((runtime / 'runtime.json').read_text())
    require(package['bundleVersion'] == expected_bundle, 'Unexpected bundle version')
    artifact = json.loads((runtime / 'dependencies/node/node_modules/@oai/artifact-tool/package.json').read_text())
    require(artifact['version'] == package['artifactToolVersion'], 'Artifact metadata mismatch')
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    commands = [
        [runtime / 'dependencies/node/bin/node', '--version'],
        [runtime / 'dependencies/python/bin/python3', '-B', '-c',
         'import sys,json,ssl; print(sys.version.split()[0])'],
        [runtime / 'dependencies/native/git/bin/git', '--version'],
    ]
    outputs = []
    for command in commands:
        completed = subprocess.run(command, check=True, capture_output=True,
                                   text=True, timeout=2, env=environment)
        outputs.append(completed.stdout.strip())
    require(outputs[0].startswith('v' + package['nodeVersion'].split('-')[0]),
            'Node version mismatch')
    require(outputs[1] == package['pythonVersion'], 'Python version mismatch')
    return {'bundleVersion': package['bundleVersion'], 'artifactToolVersion': artifact['version'],
            'node': outputs[0], 'python': outputs[1], 'git': outputs[2]}


def watchdog(args):
    pid, ticks, owner, owner_ticks, marker = args
    pid, owner = int(pid), int(owner)
    start = time.monotonic()
    try:
        while time.monotonic() - start < 12:
            if not same_process(owner, owner_ticks):
                return
            time.sleep(.05)
        Path(marker).write_text('Watchdog requested abort at ' + now() + '\n')
        if same_process(owner, owner_ticks):
            os.kill(owner, signal.SIGUSR1)
        while time.monotonic() - start < 14:
            if not same_process(owner, owner_ticks):
                return
            time.sleep(.05)
        if same_process(owner, owner_ticks):
            os.kill(owner, signal.SIGKILL)  # only this relocation process; no groups
    finally:
        if same_process(pid, ticks):
            os.kill(pid, signal.SIGCONT)


def run(args):
    require(args.execute, 'Prepare-only by default; --execute is required after independent review')
    require(args.installer_pid and args.installer_start_ticks and args.expected_bundle,
            'Explicit installer PID/start identity/current bundle are required')
    require(SOURCE.is_dir() and not SOURCE.is_symlink(), 'Source must be the real public cache directory')
    require(SOURCE.parent.resolve() == SOURCE.parent, 'Unexpected cache parent redirection')
    require(DESTINATION.resolve() == DESTINATION, 'Unexpected destination parent redirection')
    require(DESTINATION.stat().st_dev != SOURCE.stat().st_dev, 'Data2 is not a distinct mounted filesystem')
    require(set(os.listdir(SOURCE)) == EXPECTED_ENTRIES, 'Cache entries changed; review fresh scope first')
    for name in EXPECTED_ENTRIES - {'codex-primary-runtime'}:
        staging = SOURCE / name
        require(set(os.listdir(staging)) == {'payload'} and not list((staging / 'payload').iterdir()),
                'Nonempty or changed installer staging directory; installer may be active')
    pid, ticks = args.installer_pid, args.installer_start_ticks
    main_preflight = assert_single_installer_main(pid, ticks)
    require(identity(pid)['state'] not in ('T', 't', 'Z'), 'Installer already stopped or exiting')

    operation = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    target = DESTINATION / ('codex-runtimes-live-' + operation)
    receipt = DESTINATION / ('parent-relocation-' + operation + '.json')
    manifest_file = DESTINATION / ('parent-inventory-' + operation + '.json')
    target_manifest_file = DESTINATION / ('parent-target-inventory-' + operation + '.json')
    swap = SOURCE.parent / ('.codex-runtimes-relocation-' + operation)
    marker = DESTINATION / ('parent-watchdog-' + operation + '.txt')
    evidence = {'startedAt': now(), 'source': str(SOURCE), 'target': str(target),
                'duplicate': str(swap), 'installerPid': pid, 'installerStartTicks': ticks,
                'expectedBundle': args.expected_bundle, 'status': 'preparing',
                'processInspection': {'mainBeforeCopy': main_preflight},
                'scope': 'Public runtime cache only; no personal state or project configuration'}
    lock = open('/dev/shm/dima-worker-runtime/runtime-parent-relocation.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # protects this script only, NOT updater
    paused = switched = committed = False
    watcher = None
    pause_start = None

    def interrupted(signum, _frame):
        raise RuntimeError(f'Relocation interrupted by signal {signum}')

    for number in (signal.SIGINT, signal.SIGTERM, signal.SIGUSR1):
        signal.signal(number, interrupted)

    def deadline_budget():
        require(not marker.exists() and time.monotonic() - pause_start < 10,
                'Critical window budget exhausted; abort before next mutation')

    def critical_budget():
        deadline_budget()
        require(same_process(pid, ticks) and identity(pid)['state'] in ('T', 't'),
                'Installer is no longer quiescent; retain both trees')

    try:
        original = inventory(SOURCE)
        json_write(manifest_file, original)
        evidence['manifestSha256'] = digest(manifest_file)
        evidence['rootFreeBefore'] = shutil.disk_usage(SOURCE).free
        allocated = sum(item['blocks'] * 512 for item in original.values())
        require(shutil.disk_usage(DESTINATION).free > allocated + 512 * 1024**2,
                'Insufficient Data2 capacity')
        evidence['beforeSmoke'] = smoke(SOURCE, args.expected_bundle)
        evidence['processInspection']['writersBeforeCopy'] = assert_no_public_writers(original)
        shutil.copytree(SOURCE, target, symlinks=True, copy_function=shutil.copy2)
        target_verified = inventory(target)
        json_write(target_manifest_file, target_verified)
        evidence['targetManifest'] = str(target_manifest_file)
        evidence['targetManifestSha256'] = digest(target_manifest_file)
        require(payload(target_verified) == payload(original), 'Copied hashes, links or entry set differ')
        evidence['targetSmoke'] = smoke(target, args.expected_bundle)
        # Full hashing stays outside the short stopped window.
        require(inventory(SOURCE) == original, 'Source drifted during copy; leave both untouched')
        target_after_smoke = inventory(target, False)
        if target_comparison(target_after_smoke, False) != target_comparison(target_verified, False):
            diagnostic = DESTINATION / ('parent-target-drift-' + operation + '.json')
            json_write(diagnostic, {'recordedAt': now(),
                                   'baselineManifest': str(target_manifest_file),
                                   'actualMetadata': target_after_smoke})
            evidence['targetDriftDiagnostic'] = str(diagnostic)
            raise RuntimeError('Target changed after hashing; exact baseline and current metadata retained')
        evidence.update(status='verified-before-pause', verifiedAt=now())
        json_write(receipt, evidence)
        require(same_process(pid, ticks), 'Installer exited or PID reused')
        owner_ticks = identity(os.getpid())['startTicks']
        watcher = subprocess.Popen([sys.executable, __file__, '--watchdog', str(pid), ticks,
                                    str(os.getpid()), owner_ticks, str(marker)],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
        pause_start = time.monotonic()
        os.kill(pid, signal.SIGSTOP)
        paused = True
        wait_until_stopped(pid, ticks, deadline_budget)
        evidence['processInspection']['mainWhilePaused'] = assert_single_installer_main(pid, ticks)
        require(metadata(inventory(SOURCE, False)) == metadata(original), 'Source drift before exchange')
        evidence['processInspection']['writersWhilePaused'] = assert_no_public_writers(original)
        critical_budget()
        os.symlink(target, swap)
        exchange(SOURCE, swap)
        switched = True
        require(SOURCE.is_symlink() and SOURCE.resolve() == target, 'Source link did not activate target')
        require(metadata(inventory(swap, False), True) == metadata(original, True),
                'Exchanged duplicate differs from verified source')
        critical_budget()
        evidence['activatedSmoke'] = smoke(SOURCE, args.expected_bundle)
        critical_budget()
        evidence.update(status='activated-retaining-duplicate', exchangedAt=now())
        json_write(receipt, evidence)
        committed = True
    except BaseException as error:
        evidence['error'] = type(error).__name__ + ': ' + str(error)
        if (switched and not committed and same_process(pid, ticks)
                and identity(pid)['state'] in ('T', 't')
                and time.monotonic() - pause_start < 13.5):
            exchange(SOURCE, swap)
            switched = False
            evidence['rolledBackAt'] = now()
        evidence['status'] = 'failed-retaining-copies'
        json_write(receipt, evidence)
        raise
    finally:
        if paused and same_process(pid, ticks):
            os.kill(pid, signal.SIGCONT)
            evidence['stoppedWindowSeconds'] = time.monotonic() - pause_start
        if watcher is not None:
            watcher.terminate()
            watcher.wait(timeout=2)
        # Only remove our unused symlink; never remove a directory on this path here.
        if not switched and swap.is_symlink():
            swap.unlink()
        json_write(receipt, evidence)

    # Main process is running again. The renamed duplicate has a private unique
    # name the updater never uses. Re-hash it before any irreversible deletion.
    try:
        require(target_comparison(inventory(target)) == target_comparison(target_verified),
                'Retained target drifted after resume; preserve original duplicate')
        duplicate = inventory(swap)
        require(metadata(duplicate, True) == metadata(original, True)
                and payload(duplicate) == payload(original), 'Duplicate drift; preserve for review')
        evidence['processInspection']['writersBeforeDeletion'] = assert_no_public_writers(duplicate)
        require(SOURCE.is_symlink() and SOURCE.resolve() == target, 'Public parent link changed; preserve duplicate')
        require(target_comparison(inventory(target, False), False)
                == target_comparison(target_verified, False),
                'Retained target changed before cleanup; preserve duplicate')
        require(not marker.exists(), 'Watchdog fired; preserve duplicate for manual review')
        evidence['duplicateDeletionStartedAt'] = now()
        json_write(receipt, evidence)
        shutil.rmtree(swap)
    except BaseException as error:
        evidence.update(status='activated-cleanup-incomplete',
                        error=type(error).__name__ + ': ' + str(error))
        json_write(receipt, evidence)
        raise
    evidence.update(status='complete', completedAt=now(), verifiedDuplicateRemoved=True,
                    rootFreeAfter=shutil.disk_usage(SOURCE.parent).free)
    json_write(receipt, evidence)
    print(json.dumps({'receipt': str(receipt), 'target': str(target),
                      'rootFreeAfter': evidence['rootFreeAfter'],
                      'stoppedWindowSeconds': evidence['stoppedWindowSeconds']}))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--watchdog':
        require(len(sys.argv) == 7, 'Invalid private watchdog invocation')
        watchdog(sys.argv[2:])
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--execute', action='store_true')
        parser.add_argument('--installer-pid', type=int)
        parser.add_argument('--installer-start-ticks')
        parser.add_argument('--expected-bundle')
        run(parser.parse_args())

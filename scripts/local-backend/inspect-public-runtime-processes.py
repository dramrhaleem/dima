#!/usr/bin/env python3
"""Fixed read-only /proc inspector. JSON stdin/stdout; no signals or mutations."""
import json
import os
from pathlib import Path
import re
import stat
import sys

INSTALLER = Path('/usr/lib/chatgpt/ChatGPT')
OWNER_UID = 1000
MAX_INPUT_BYTES = 16 * 1024 * 1024


def has_child_role(raw):
    # Electron on this host rewrites argv into a single flattened process title.
    # Support both actual NUL-separated argv and that observed representation.
    return re.search(rb'(?:^|[\x00\s])--type(?:=|[\x00\s]|$)', raw) is not None


def process_identity(proc):
    try:
        fields = (proc / 'stat').read_text().rsplit(') ', 1)[1].split()
        return fields[0], fields[19]
    except (FileNotFoundError, ProcessLookupError):
        return None


def validate(request):
    if not isinstance(request, dict) or request.get('mode') not in ('main', 'writers'):
        raise ValueError('Invalid request mode')
    if request['mode'] == 'main':
        if (set(request) != {'mode', 'pid', 'startTicks'}
                or type(request['pid']) is not int or request['pid'] <= 0
                or not isinstance(request['startTicks'], str)
                or not request['startTicks'].isdigit()):
            raise ValueError('Invalid main request')
    else:
        if set(request) != {'mode', 'nodes'} or not isinstance(request['nodes'], list):
            raise ValueError('Invalid inode request')
        if not 1 <= len(request['nodes']) <= 100000:
            raise ValueError('Invalid inode count')
        for node in request['nodes']:
            if (not isinstance(node, list) or len(node) != 3
                    or any(type(value) is not int or value < 0 for value in node[:2])
                    or node[2] not in ('file', 'directory', 'symlink')):
                raise ValueError('Invalid inode entry')


def inspect(request, proc_root=Path('/proc')):
    validate(request)
    nodes = {(item[0], item[1]): item[2] for item in request.get('nodes', [])}
    counts = dict(processesSeen=0, processesInspected=0, disappeared=0, zombies=0,
                  kernelThreads=0, fdStats=0, closedDescriptors=0,
                  publicReadHandles=0, mainCount=0, blockers=0)
    blockers = []
    mains = []

    def block(pid, kind):
        counts['blockers'] += 1
        if len(blockers) < 32:
            blockers.append({'pid': pid, 'type': kind})

    for proc in proc_root.iterdir():
        if not proc.name.isdigit():
            continue
        pid = int(proc.name)
        counts['processesSeen'] += 1
        main_candidate = None
        try:
            before = process_identity(proc)
            if before is None:
                counts['disappeared'] += 1
                continue
            if before[0] == 'Z':
                counts['zombies'] += 1
                continue
            status = dict(line.split(':', 1) for line in (proc / 'status').read_text().splitlines()
                          if ':' in line)
            if status.get('Kthread', '').strip() == '1':
                counts['kernelThreads'] += 1
                continue
            if request['mode'] == 'main':
                executable = os.readlink(proc / 'exe') if proc.stat().st_uid == OWNER_UID else None
                if executable in (str(INSTALLER), str(INSTALLER) + ' (deleted)'):
                    # Role classification only. No argument values leave the helper.
                    if not has_child_role((proc / 'cmdline').read_bytes()):
                        main_candidate = (pid, before[1])
            else:
                cwd = (proc / 'cwd').stat()
                if (cwd.st_dev, cwd.st_ino) in nodes:
                    block(pid, 'public-cache-cwd')
                for fd in (proc / 'fd').iterdir():
                    try:
                        value = fd.stat()
                        counts['fdStats'] += 1
                        kind = nodes.get((value.st_dev, value.st_ino))
                        if kind is None:
                            continue
                        if stat.S_ISDIR(value.st_mode):
                            block(pid, 'public-cache-directory-fd')
                            continue
                        flags_line = next(line for line in (proc / 'fdinfo' / fd.name).read_text().splitlines()
                                          if line.startswith('flags:'))
                        flags = int(flags_line.split()[1], 8)
                        if flags & os.O_ACCMODE != os.O_RDONLY:
                            block(pid, 'public-cache-writer-fd')
                        else:
                            counts['publicReadHandles'] += 1
                    except (FileNotFoundError, ProcessLookupError):
                        counts['closedDescriptors'] += 1
            after = process_identity(proc)
            if after is None or after[0] == 'Z':
                counts['disappeared'] += 1
            elif after[1] != before[1]:
                block(pid, 'pid-identity-changed')
            else:
                counts['processesInspected'] += 1
                if main_candidate is not None:
                    mains.append(main_candidate)
        except (FileNotFoundError, ProcessLookupError):
            after = process_identity(proc)
            if after is None or after[0] == 'Z':
                counts['disappeared'] += 1
            else:
                block(pid, 'unresolved-live-process-metadata')
        except PermissionError:
            block(pid, 'process-metadata-access-denied')
        except (OSError, ValueError, KeyError, IndexError, StopIteration):
            block(pid, 'unexplained-process-metadata-error')
    if request['mode'] == 'main':
        counts['mainCount'] = len(mains)
        expected = (request['pid'], request['startTicks'])
        if mains != [expected]:
            for pid, _ticks in mains:
                block(pid, 'unexpected-main-or-identity')
            if expected not in mains:
                block(request['pid'], 'selected-main-not-confirmed')
    return {'ok': counts['blockers'] == 0, 'mode': request['mode'],
            'coverage': counts, 'blockers': blockers,
            'blockersTruncated': max(0, counts['blockers'] - len(blockers))}


def main():
    try:
        if os.geteuid() != 0:
            raise PermissionError('Privileged read-only inspection required')
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise ValueError('Input too large')
        result = inspect(json.loads(raw))
    except Exception:
        result = {'ok': False, 'error': 'inspection-request-failed'}
    print(json.dumps(result, separators=(',', ':')))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())

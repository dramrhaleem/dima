"""Pure/temporary-file checks; never invoke the relocation run or real signals."""
import importlib.util
import copy
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    'runtime_relocation', Path(__file__).parents[2] /
    'scripts/local-backend/relocate-public-runtime-cache.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
INSPECT_SPEC = importlib.util.spec_from_file_location(
    'runtime_process_inspection', Path(__file__).parents[2] /
    'scripts/local-backend/inspect-public-runtime-processes.py')
INSPECTOR = importlib.util.module_from_spec(INSPECT_SPEC)
INSPECT_SPEC.loader.exec_module(INSPECTOR)


class RelocationReviewTests(unittest.TestCase):
    def test_delayed_stop_delivery_is_polled_without_quiescence_assertion(self):
        states = [{'state': state, 'startTicks': '42'} for state in ['S', 'R', 'T']]
        with patch.object(MODULE, 'identity', side_effect=states), \
                patch.object(MODULE.time, 'sleep') as sleep:
            deadline = unittest.mock.Mock()
            MODULE.wait_until_stopped(101, '42', deadline)
        self.assertEqual(deadline.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_main_selection_rejects_unrelated_and_multiple_main_processes(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            root = Path(directory)
            def process(pid, executable, args):
                entry = root / str(pid)
                entry.mkdir()
                (entry / 'exe').symlink_to(executable)
                (entry / 'cmdline').write_bytes(b'\0'.join(args))
                (entry / 'status').write_text('Kthread:\t0\n')
                (entry / 'stat').write_text(str(pid) + ' (fixture) ' + ' '.join(['S'] + ['0'] * 18 + ['42']))
            process(101, '/usr/bin/python3', [b'python3'])
            request = {'mode': 'main', 'pid': 101, 'startTicks': '42'}
            self.assertFalse(INSPECTOR.inspect(request, root)['ok'])
            process(102, MODULE.INSTALLER, [b'ChatGPT'])
            process(103, MODULE.INSTALLER, [b'ChatGPT', b'--type=renderer'])
            request['pid'] = 102
            self.assertTrue(INSPECTOR.inspect(request, root)['ok'])
            process(104, MODULE.INSTALLER, [b'ChatGPT'])
            self.assertFalse(INSPECTOR.inspect(request, root)['ok'])

    def test_privileged_subprocess_timeout_and_errors_fail_closed(self):
        request = {'mode': 'main', 'pid': 101, 'startTicks': '42'}
        for error in [MODULE.subprocess.TimeoutExpired('sudo', 3), OSError('fixture')]:
            with self.subTest(error=type(error).__name__), \
                    patch.object(MODULE.subprocess, 'run', side_effect=error):
                with self.assertRaisesRegex(RuntimeError, 'failed or timed out'):
                    MODULE.inspect_processes(request)
        response = {'ok': True, 'mode': 'main', 'coverage': {'blockers': 0},
                    'blockers': [], 'blockersTruncated': 0}
        completed = MODULE.subprocess.CompletedProcess([], 1, MODULE.json.dumps(response), '')
        with patch.object(MODULE.subprocess, 'run', return_value=completed):
            with self.assertRaisesRegex(RuntimeError, 'not established'):
                MODULE.inspect_processes(request)

    def test_privileged_call_uses_fixed_argv_and_structured_stdin(self):
        request = {'mode': 'main', 'pid': 101, 'startTicks': '42'}
        response = {'ok': True, 'mode': 'main', 'coverage': {'blockers': 0},
                    'blockers': [], 'blockersTruncated': 0}
        completed = MODULE.subprocess.CompletedProcess([], 0, MODULE.json.dumps(response), '')
        with patch.object(MODULE.subprocess, 'run', return_value=completed) as run:
            MODULE.inspect_processes(request)
        args, kwargs = run.call_args
        self.assertEqual(args[0][:4], ['/usr/bin/sudo', '-n', '/usr/bin/python3', '-B'])
        self.assertEqual(MODULE.json.loads(kwargs['input']), request)
        self.assertNotIn('shell', kwargs)
        self.assertEqual(kwargs['timeout'], 3)

    def test_process_access_denial_is_a_blocker_not_an_exclusion(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            proc = Path(directory) / '101'
            proc.mkdir()
            (proc / 'stat').write_text('101 (fixture) ' + ' '.join(['S'] + ['0'] * 18 + ['42']))
            (proc / 'status').write_text('Kthread:\t0\n')
            with patch.object(INSPECTOR.os, 'readlink', side_effect=PermissionError()):
                result = INSPECTOR.inspect({'mode': 'main', 'pid': 101, 'startTicks': '42'}, Path(directory))
            self.assertFalse(result['ok'])
            self.assertIn({'pid': 101, 'type': 'process-metadata-access-denied'}, result['blockers'])

    def test_child_role_handles_real_argv_and_flattened_electron_titles(self):
        for raw in [b'ChatGPT\0--type=renderer\0', b'ChatGPT\0--type\0utility\0',
                    b'/usr/lib/chatgpt/ChatGPT --type=zygote --no-sandbox\0']:
            with self.subTest(raw=raw):
                self.assertTrue(INSPECTOR.has_child_role(raw))
        self.assertFalse(INSPECTOR.has_child_role(b'/usr/lib/chatgpt/ChatGPT\0'))

    def test_disappearing_selected_main_is_not_accepted(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            proc = Path(directory) / '101'
            proc.mkdir()
            (proc / 'exe').symlink_to(MODULE.INSTALLER)
            (proc / 'cmdline').write_bytes(b'ChatGPT\0')
            (proc / 'status').write_text('Kthread:\t0\n')
            with patch.object(INSPECTOR, 'process_identity', side_effect=[('S', '42'), None]):
                result = INSPECTOR.inspect({'mode': 'main', 'pid': 101, 'startTicks': '42'}, Path(directory))
            self.assertFalse(result['ok'])
            self.assertEqual(result['coverage']['disappeared'], 1)
            self.assertEqual(result['coverage']['mainCount'], 0)

    def test_inode_bound_cwd_and_writer_are_reported_without_private_paths(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            root = Path(directory)
            cache = root / 'public-cache'
            cache.mkdir()
            file = cache / 'fixture'
            file.write_text('public fixture')
            proc_root = root / 'proc'
            proc_root.mkdir()
            proc = proc_root / '101'
            proc.mkdir()
            (proc / 'stat').write_text('101 (fixture) ' + ' '.join(['S'] + ['0'] * 18 + ['42']))
            (proc / 'status').write_text('Kthread:\t0\n')
            (proc / 'cwd').symlink_to(cache)
            (proc / 'fd').mkdir()
            (proc / 'fdinfo').mkdir()
            (proc / 'fd/3').symlink_to(file)
            (proc / 'fdinfo/3').write_text('flags:\t01\n')
            manifest = MODULE.inventory(cache)
            nodes = [[value['dev'], value['ino'], value['type']] for value in manifest.values()]
            result = INSPECTOR.inspect({'mode': 'writers', 'nodes': nodes}, proc_root)
            self.assertFalse(result['ok'])
            self.assertEqual(result['blockers'], [{'pid': 101, 'type': 'public-cache-cwd'},
                                                 {'pid': 101, 'type': 'public-cache-writer-fd'}])
            self.assertNotIn(str(cache), MODULE.json.dumps(result))

    def test_inventory_preserves_entry_types_hashes_and_link_text(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            root = Path(directory) / 'source'
            root.mkdir()
            (root / 'empty').mkdir()
            (root / 'file').write_bytes(b'public fixture')
            (root / 'link').symlink_to('missing-relative-target')
            before = MODULE.inventory(root)
            self.assertEqual(before['link']['target'], 'missing-relative-target')
            self.assertEqual(before['empty']['type'], 'directory')
            self.assertIn('ino', before['.'])
            target = Path(directory) / 'target'
            shutil.copytree(root, target, symlinks=True)
            self.assertEqual(MODULE.payload(before), MODULE.payload(MODULE.inventory(target)))
            (root / 'file').write_bytes(b'changed fixture')
            self.assertNotEqual(before, MODULE.inventory(root))

    def test_rejects_unexpected_fifo(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            MODULE.os.mkfifo(Path(directory) / 'unexpected')
            with self.assertRaisesRegex(RuntimeError, 'Unexpected file type'):
                MODULE.inventory(Path(directory))

    def target_fixture(self):
        common = dict(dev=1, ino=2, mode=0o755, uid=1000, gid=1000,
                      nlink=1, size=368, blocks=0, mtime_ns=10, ctime_ns=20)
        return {'.': dict(common, type='directory'),
                'file': dict(common, type='file', ino=3, sha256='original'),
                'link': dict(common, type='symlink', ino=4, target='file')}

    def test_target_directory_allocation_shift_is_accepted_without_mutating_raw_manifests(self):
        baseline = self.target_fixture()
        actual = copy.deepcopy(baseline)
        actual['.'].update(size=4096, blocks=8)
        originals = copy.deepcopy((baseline, actual))
        for hashes in (True, False):
            self.assertEqual(MODULE.target_comparison(baseline, hashes),
                             MODULE.target_comparison(actual, hashes))
        self.assertEqual((baseline, actual), originals)
        # Source/duplicate metadata, including the renamed-root variant, stays strict.
        self.assertNotEqual(baseline, actual)
        self.assertNotEqual(MODULE.metadata(baseline), MODULE.metadata(actual))
        self.assertNotEqual(MODULE.metadata(baseline, True), MODULE.metadata(actual, True))

    def test_target_comparison_rejects_file_fields_directory_identity_and_link_drift(self):
        baseline = self.target_fixture()
        for path, item in baseline.items():
            for field, value in item.items():
                if path == '.' and field in ('size', 'blocks'):
                    continue
                with self.subTest(path=path, field=field):
                    actual = copy.deepcopy(baseline)
                    actual[path][field] = value + 1 if isinstance(value, int) else value + '-changed'
                    self.assertNotEqual(MODULE.target_comparison(baseline),
                                        MODULE.target_comparison(actual))
                    if field != 'sha256':
                        self.assertNotEqual(MODULE.target_comparison(baseline, False),
                                            MODULE.target_comparison(actual, False))

    def test_target_comparison_rejects_added_removed_or_renamed_entries(self):
        baseline = self.target_fixture()
        for change in ('added', 'removed', 'renamed'):
            with self.subTest(change=change):
                actual = copy.deepcopy(baseline)
                if change == 'added':
                    actual['extra'] = dict(actual['file'])
                elif change == 'removed':
                    del actual['file']
                else:
                    actual['renamed'] = actual.pop('file')
                for hashes in (True, False):
                    self.assertNotEqual(MODULE.target_comparison(baseline, hashes),
                                        MODULE.target_comparison(actual, hashes))

    def test_renamed_root_comparison_excludes_only_root_ctime(self):
        original = {'.': {'type': 'directory', 'ctime_ns': 1, 'ino': 9},
                    'child': {'type': 'file', 'ctime_ns': 1, 'sha256': 'a'}}
        moved = {'.': {'type': 'directory', 'ctime_ns': 2, 'ino': 9},
                 'child': {'type': 'file', 'ctime_ns': 1, 'sha256': 'a'}}
        self.assertEqual(MODULE.metadata(original, True), MODULE.metadata(moved, True))
        moved['child']['ctime_ns'] = 2
        self.assertNotEqual(MODULE.metadata(original, True), MODULE.metadata(moved, True))

    def test_watchdog_bounds_owned_job_and_resumes_installer(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            marker = Path(directory) / 'marker'
            with patch.object(MODULE.time, 'monotonic', side_effect=[0, 12.01, 14.01]), \
                    patch.object(MODULE, 'same_process', return_value=True), \
                    patch.object(MODULE.os, 'kill') as kill:
                MODULE.watchdog(['101', 'main-start', '202', 'owner-start', str(marker)])
            self.assertEqual(kill.call_args_list, [
                unittest.mock.call(202, MODULE.signal.SIGUSR1),
                unittest.mock.call(202, MODULE.signal.SIGKILL),
                unittest.mock.call(101, MODULE.signal.SIGCONT)])
            self.assertTrue(marker.exists())

    def test_watchdog_resumes_on_early_owner_exit(self):
        with patch.object(MODULE.time, 'monotonic', side_effect=[0, .1]), \
                patch.object(MODULE, 'same_process', side_effect=[False, True]), \
                patch.object(MODULE.os, 'kill') as kill:
            MODULE.watchdog(['101', 'main-start', '202', 'owner-start', '/unused'])
        kill.assert_called_once_with(101, MODULE.signal.SIGCONT)

    def test_watchdog_never_signals_reused_installer_pid(self):
        with patch.object(MODULE.time, 'monotonic', side_effect=[0, .1]), \
                patch.object(MODULE, 'same_process', return_value=False), \
                patch.object(MODULE.os, 'kill') as kill:
            MODULE.watchdog(['101', 'main-start', '202', 'owner-start', '/unused'])
        kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()

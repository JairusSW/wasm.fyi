import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('watcher', Path(__file__).with_name('watch-history-campaign.py'))
watcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watcher)


class NetworkRecoveryTest(unittest.TestCase):
    def test_sdk_build_output_counts_as_progress_without_parent_log_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'coordinator.log').write_text('SDK build started\n')
            build = root / 'sdk-builds' / 'v8-pinned' / 'v8-build.log'
            build.parent.mkdir(parents=True)
            build.write_text('CXX first object\n')
            before = watcher.progress_signature(root)
            self.assertIn('sdk-builds/v8-pinned/v8-build.log', dict(before))
            stamp = build.stat().st_mtime_ns
            os.utime(build, ns=(stamp + 1_000_000_000, stamp + 1_000_000_000))
            after = watcher.progress_signature(root)
            self.assertNotEqual(before, after)
            self.assertEqual(dict(before)['coordinator.log'], dict(after)['coordinator.log'])

    def test_only_current_unresolved_latest_network_errors_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'collection-template.json').write_text(json.dumps({'historyNotBefore': '2026-06-28'}))
            errors = [
                {'pinKey': 'old|2026-06-21', 'error': 'Could not resolve host: github.com'},
                {'pinKey': 'done|2026-07-05', 'error': 'Could not resolve host: github.com'},
                {'pinKey': 'changed|2026-07-05', 'error': 'Could not resolve host: github.com'},
                {'pinKey': 'changed|2026-07-05', 'error': 'error[E0432]: unresolved import'},
                {'pinKey': 'timeout|2026-07-05', 'error': 'workload timed out after 5m'},
                {'pinKey': 'retry|2026-06-28', 'error': 'fatal: Could not resolve host: github.com'},
            ]
            (root / 'wasmer-history-status.json').write_text(json.dumps({'errors': errors, 'completed': [{'pinKey': 'done|2026-07-05'}]}))
            self.assertEqual([e['pinKey'] for e in watcher.retryable_network_errors(root)], ['retry|2026-06-28'])

    def test_connectivity_requires_both_bounded_https_probes(self):
        response = MagicMock()
        response.__enter__.return_value.status = 200
        with patch.object(watcher, 'urlopen', return_value=response) as request:
            self.assertTrue(watcher.connectivity_verified())
            self.assertEqual(request.call_count, 2)
            self.assertTrue(all(c.kwargs['timeout'] == 5 for c in request.call_args_list))
        with patch.object(watcher, 'urlopen', side_effect=OSError('DNS unavailable')):
            self.assertFalse(watcher.connectivity_verified())

    def test_genuine_sdk_and_corpus_failures_are_not_network_errors(self):
        for error in ['compiler timed out', 'correctness mismatch', 'missing adapter binary', 'unsupported SIMD', 'connection timeout during workload']:
            self.assertIsNone(watcher.NETWORK_ERROR.search(error))


if __name__ == '__main__':
    unittest.main()

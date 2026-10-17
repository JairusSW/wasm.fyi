import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).with_name('cleanup-finished-history.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.pin = dict(engine='wasmtime', targetType='release', tag='v1', revision='abc',
                        targetWeek='2026-09-20T10:00:00.000Z', status='planned',
                        configurations=['wasmtime', 'wasmtime-winch'])
        self.template = {'historyNotBefore': '2026-06-28', 'workloads': [{'id': 'a'}]}
        self.write('source-plan.json', {'pins': [self.pin]})
        self.write('collection-template.json', self.template)
        self.sdk = m.build_paths(self.root, self.pin, 'wasmtime')[0]
        self.sdk.mkdir(parents=True)
        (self.sdk / 'build.log').write_text('compiler output')
        self.ledger = self.root / 'published.json'
        self.publish('wasmtime')
        self.publish('wasmtime-winch')
        self.complete('wasmtime', 'wasmtime-winch')

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def complete(self, *configs):
        self.write('wasmtime-history-status.json', {'completed': [
            {'pinKey': m.pin_key(self.pin, config)} for config in configs]})

    def publish(self, config):
        body = json.dumps({'source': {'revision': 'abc', 'asOf': self.pin['targetWeek']},
                           'results': [{'engine': config, 'workload': 'a'}]}).encode()
        path = self.root / 'captures' / (config + '.json')
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(body)
        journal = self.ledger.with_suffix('.journal')
        with journal.open('a') as stream:
            stream.write(hashlib.sha256(body).hexdigest() + '\n')

    def sweep(self, active=()):
        with patch.object(m, 'process_paths', return_value=list(active)):
            return m.sweep(self.root, self.ledger, True)

    def add_completed_pin(self, pin):
        plan = json.loads((self.root / 'source-plan.json').read_text())
        plan['pins'].append(pin)
        self.write('source-plan.json', plan)
        history = json.loads((self.root / 'wasmtime-history-status.json').read_text())
        sdk = m.build_paths(self.root, pin, 'wasmtime')[0]
        sdk.mkdir(parents=True, exist_ok=True)
        (sdk / 'build.log').write_text('compiler output')
        for config in pin['configurations']:
            key = m.pin_key(pin, config)
            history['completed'].append({'pinKey': key})
            body = json.dumps({'source': {'revision': pin['revision'], 'asOf': pin['targetWeek']},
                               'results': [{'engine': config, 'workload': 'a'}]}).encode()
            (self.root / 'captures' / (hashlib.sha256(key.encode()).hexdigest() + '.json')).write_bytes(body)
            with self.ledger.with_suffix('.journal').open('a') as stream:
                stream.write(hashlib.sha256(body).hexdigest() + '\n')
        self.write('wasmtime-history-status.json', history)
        return sdk

    def test_shared_sdk_waits_for_both_backends(self):
        self.complete('wasmtime')
        self.sweep()
        self.assertTrue(self.sdk.exists())
        self.complete('wasmtime', 'wasmtime-winch')
        self.sweep()
        self.assertFalse(self.sdk.exists())
        self.assertTrue((self.root / 'wasmtime-history-status.json').exists())
        self.assertEqual(len(list((self.root / 'captures').glob('*.json'))), 2)

    def test_unpublished_results_protect_sdk(self):
        self.ledger.with_suffix('.journal').unlink()
        self.sweep()
        self.assertTrue(self.sdk.exists())

    def test_pending_feature_consumer_protects_shared_sdk(self):
        self.write('feature-sdk-retention.json', {'pendingConfigurations': ['wasmtime-winch']})
        self.sweep()
        self.assertTrue(self.sdk.exists())
        self.write('feature-sdk-retention.json', {'pendingConfigurations': []})
        self.sweep()
        self.assertFalse(self.sdk.exists())

    def test_latest_only_features_reclaim_published_historical_sdk(self):
        newer = {**self.pin, 'tag': 'v2', 'revision': 'def', 'targetWeek': '2026-09-27T10:00:00.000Z'}
        latest_sdk = self.add_completed_pin(newer)
        retention = {'pendingConfigurations': ['wasmtime-winch'], 'latestOnly': False}
        self.write('feature-sdk-retention.json', retention)
        self.sweep()
        self.assertTrue(self.sdk.exists())
        self.write('feature-sdk-retention.json', {**retention, 'latestOnly': True})
        self.sweep([self.sdk / 'bin/adapter'])
        self.assertTrue(self.sdk.exists())
        self.sweep()
        self.assertFalse(self.sdk.exists())
        self.assertTrue(latest_sdk.exists())
        self.assertEqual(len(list((self.root / 'captures').glob('*.json'))), 4)

    def test_latest_only_features_protect_reused_latest_source(self):
        newer = {**self.pin, 'tag': 'v2', 'revision': 'def', 'targetWeek': '2026-09-27T10:00:00.000Z'}
        newer_sdk = self.add_completed_pin(newer)
        alias = {**self.pin, 'status': 'reused', 'targetWeek': '2026-10-04T10:00:00.000Z'}
        self.write('source-plan.json', {'pins': [self.pin, newer, alias]})
        self.write('feature-sdk-retention.json', {'pendingConfigurations': ['wasmtime-winch'],
                                                'latestOnly': True})
        self.sweep()
        self.assertTrue(self.sdk.exists())
        self.assertFalse(newer_sdk.exists())

    def test_latest_only_features_keep_sdks_when_latest_source_is_unknown(self):
        unknown = {**self.pin, 'status': 'unavailable', 'targetWeek': '2026-10-04T10:00:00.000Z'}
        self.write('source-plan.json', {'pins': [self.pin, unknown]})
        self.write('feature-sdk-retention.json', {'pendingConfigurations': ['wasmtime-winch'],
                                                'latestOnly': True})
        self.sweep()
        self.assertTrue(self.sdk.exists())

    def test_latest_only_incomplete_latest_source_keeps_older_sdk(self):
        unknown = {**self.pin, 'tag': 'v2', 'revision': None,
                   'targetWeek': '2026-10-04T10:00:00.000Z'}
        self.write('source-plan.json', {'pins': [self.pin, unknown]})
        self.write('feature-sdk-retention.json', {'pendingConfigurations': ['wasmtime-winch'],
                                                'latestOnly': True})
        self.sweep()
        self.assertTrue(self.sdk.exists())

    def test_active_executable_protects_sdk(self):
        self.sweep([self.sdk / 'bin/adapter'])
        self.assertTrue(self.sdk.exists())

    def test_current_engine_protects_command_gaps(self):
        self.write('coordinator-status.json', {'status': 'running', 'current': 'wasmtime'})
        self.sweep()
        self.assertTrue(self.sdk.exists())

    def test_never_acquires_an_occupied_lock(self):
        (self.root / 'measurement-lock').mkdir()
        self.assertEqual(self.sweep()['status'], 'busy')
        self.assertTrue(self.sdk.exists())

    def test_external_symlink_never_deleted(self):
        with tempfile.TemporaryDirectory() as other:
            m.shutil.rmtree(self.sdk)
            self.sdk.symlink_to(other, target_is_directory=True)
            (Path(other) / 'valuable').write_text('keep')
            self.sweep()
            self.assertTrue((Path(other) / 'valuable').exists())
            self.assertTrue(self.sdk.is_symlink())

    def test_same_source_later_use_prevents_cleanup(self):
        later = {**self.pin, 'targetWeek': '2026-09-27T10:00:00.000Z'}
        self.write('source-plan.json', {'pins': [self.pin, later]})
        self.sweep()
        self.assertTrue(self.sdk.exists())

    def test_reused_alias_week_does_not_require_sdk(self):
        alias = {**self.pin, 'status': 'reused', 'targetWeek': '2026-09-27T10:00:00.000Z'}
        self.write('source-plan.json', {'pins': [self.pin, alias]})
        self.sweep()
        self.assertFalse(self.sdk.exists())

    def test_missing_workload_receipt_protects_sdk(self):
        self.write('collection-template.json', {**self.template, 'workloads': [{'id': 'a'}, {'id': 'b'}]})
        self.sweep()
        self.assertTrue(self.sdk.exists())

    def test_preview_does_not_delete(self):
        with patch.object(m, 'process_paths', return_value=[]):
            result = m.sweep(self.root, self.ledger)
        self.assertIn(str(self.sdk), result['eligible'])
        self.assertTrue(self.sdk.exists())
        self.assertFalse((self.root / 'measurement-lock').exists())

    def test_closed_logs_removed_open_logs_and_databases_preserved(self):
        closed, opened = self.root / 'old.log', self.root / 'open.log'
        closed.write_text('old')
        opened.write_text('live')
        database = self.root / 'benchmarks.sqlite'
        database.write_text('preserve')
        self.sweep([opened])
        self.assertFalse(closed.exists())
        self.assertTrue(opened.exists())
        self.assertTrue(database.exists())


if __name__ == '__main__':
    unittest.main()

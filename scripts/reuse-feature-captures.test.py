import importlib.util
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


reuse = module('reuse', 'reuse-feature-captures.py')
publisher = module('publisher', 'publish-host-captures.py')


class FeatureReuseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'benchmarks.sqlite'
        self.c = sqlite3.connect(self.db)
        self.addCleanup(self.c.close)
        self.c.executescript('''
          CREATE TABLE platforms(id INTEGER PRIMARY KEY,os,arch,cpu,cores,kernel,memory_bytes);
          CREATE TABLE sources(id INTEGER PRIMARY KEY,repository,revision);
          CREATE TABLE snapshots(source_id,as_of);
          CREATE TABLE engines(id INTEGER PRIMARY KEY,name);
          CREATE TABLE configurations(id INTEGER PRIMARY KEY,engine_id,version,backend);
          CREATE TABLE workloads(id INTEGER PRIMARY KEY,name);
          CREATE TABLE contracts(id INTEGER PRIMARY KEY,workload_id,wasm,artifact,digest);
          CREATE TABLE displays(id INTEGER PRIMARY KEY,data);
          CREATE TABLE sampling_policies(id INTEGER PRIMARY KEY,data);
          CREATE TABLE sample_vectors(id INTEGER PRIMARY KEY,data);
          CREATE TABLE observations(id INTEGER PRIMARY KEY,configuration_id,contract_id,source_id,
            display_id,sampling_id,samples_id,phase,captured_at,metric_bits,latency_status,
            memory_status,code_status,code_kind,timing_samples);
          CREATE TABLE history(platform_id,as_of,observation_id);
          CREATE TABLE platform_observations(platform_id,observation_id);
        ''')
        self.revision = 'a' * 40
        self.old = '2026-10-04T12:00:00.000Z'
        self.c.execute('INSERT INTO platforms VALUES(1,?,?,?,?,?,?)', ('linux', 'amd64', 'Host A', 8, 'old kernel', 8192))
        self.c.execute('INSERT INTO platforms VALUES(2,?,?,?,?,?,?)', ('linux', 'amd64', 'Host B', 8, 'new kernel', 16384))
        self.c.execute('INSERT INTO sources VALUES(1,?,?)', ('fixture/runtime', self.revision))
        self.c.execute('INSERT INTO sources VALUES(2,?,?)', ('fixture/runtime', 'b' * 40))
        for source in [1, 2]:
            self.c.execute('INSERT INTO snapshots VALUES(?,?)', (source, self.old))
        self.c.execute('INSERT INTO engines VALUES(1,?)', ('wasmi',))
        self.c.execute('INSERT INTO configurations VALUES(1,1,?,?)', (self.revision, 'interpreter'))
        self.samples = [8.25, 1.5, 4.75, 2.125, 3.5]
        self.c.execute('INSERT INTO sample_vectors VALUES(1,?)', (struct.pack('<5d', *self.samples),))
        for phase in range(4):
            policy = dict(method='same-process-stability-v1', groupSize=5, maxSamples=10 if phase < 2 else 25, warmup=0, retainedStart=0, stopReason='stable')
            self.c.execute('INSERT INTO sampling_policies VALUES(?,?)', (phase + 1, json.dumps(policy)))
        self.c.execute('INSERT INTO displays VALUES(1,?)', (json.dumps({'purpose': 'original'}),))
        self.item = {'kind': 'performance', 'contract': 'c' * 64,
                     'workload': {'id': 'features/core-num/add/performance-4096x64', 'sha256': '0' * 64},
                     'phases': reuse.PHASES}
        self.c.execute('INSERT INTO workloads VALUES(1,?)', (self.item['workload']['id'],))
        self.c.execute('INSERT INTO contracts VALUES(1,1,?,?,?)', ('original.wasm', bytes(32), bytes.fromhex('c' * 64)))
        self.expected = {'anchor': '2026-10-15T07:33:48.082Z', 'manifestIdentity': {'fixture': 1},
            'inputIdentity': 'input identity', 'platform': {'os': 'linux', 'arch': 'amd64', 'cpu': 'Host A'},
            'workloads': [self.item], 'targets': [{'engine': 'wasmi', 'keys': ['1' * 64],
                'source': {'repository': 'fixture/runtime', 'revision': self.revision,
                           'ref': 'main@aaaaaaaa', 'kind': 'snapshot', 'asOf': '2026-10-15T07:33:48.082Z'}}]}

    def observation(self, phase, platform=1, source=1, contract=1, at=None):
        bits = bytes([7]) + struct.pack('<3d', 3.5, 12345, 0)
        row = self.c.execute('''INSERT INTO observations(configuration_id,contract_id,source_id,display_id,
            sampling_id,samples_id,phase,captured_at,metric_bits,latency_status,memory_status,code_status,
            code_kind,timing_samples) VALUES(1,?,?,1,?,1,?,?,?,1,1,1,NULL,5)''',
            (contract, source, phase + 1, phase, at or self.old, bits)).lastrowid
        self.c.execute('INSERT INTO history VALUES(?,?,?)', (platform, self.old, row))
        self.c.execute('INSERT INTO platform_observations VALUES(?,?)', (platform, row))

    def run_reuse(self, feature_root=None):
        self.c.commit()
        before = self.db.read_bytes()
        receipt = reuse.reuse(self.db, self.expected, self.root,
                              publisher.valid_sample_count, feature_root)
        self.assertEqual(self.db.read_bytes(), before, 'Reuse modified the source database')
        return receipt

    def test_samples_metrics_platform_and_capture_time_survive_aliasing(self):
        for phase in range(4):
            self.observation(phase)
            self.observation(phase, platform=2, at='2026-10-10T00:00:00.000Z')
            self.observation(phase, source=2, at='2026-10-11T00:00:00.000Z')
        self.assertEqual(self.run_reuse()['reused'], 1)
        path = next((self.root / 'captures').glob('*.json'))
        capture = json.loads(path.read_text())
        self.assertEqual(capture['capturedAt'], self.old)
        self.assertEqual(capture['source']['asOf'], self.expected['anchor'])
        self.assertEqual(capture['platform']['cpu'], 'Host A')
        self.assertEqual(capture['platform']['kernel'], 'old kernel')
        for row in capture['results']:
            self.assertEqual(struct.pack('<5d', *row['samplesNs']), struct.pack('<5d', *self.samples))
            self.assertEqual(row['peakRssBytes'], 12345)
            self.assertEqual(row['display'], {'purpose': 'original'})
        self.assertEqual(path.read_bytes(), (self.root / 'latest-features/captures' / path.name).read_bytes())
        self.assertEqual(self.run_reuse()['reused'], 0)
        self.assertEqual(len(list((self.root / 'captures').glob('*.json'))), 1)

    def test_same_cpu_on_another_operating_system_is_not_reused(self):
        self.c.execute('INSERT INTO platforms VALUES(3,?,?,?,?,?,?)', ('windows', 'amd64', 'Host A', 8, 'other OS', 8192))
        for phase in range(4):
            self.observation(phase)
            self.observation(phase, platform=3, at='2026-10-12T00:00:00.000Z')
        self.assertEqual(self.run_reuse()['reused'], 1)
        capture = json.loads(next((self.root / 'captures').glob('*.json')).read_text())
        self.assertEqual(capture['platform']['os'], 'linux')
        self.assertEqual(capture['capturedAt'], self.old)

    def test_incomplete_or_mismatched_contract_does_not_satisfy_a_capture(self):
        for phase in range(3):
            self.observation(phase)
        self.c.execute('INSERT INTO contracts VALUES(2,1,?,?,?)', ('other.wasm', bytes(32), bytes.fromhex('d' * 64)))
        self.observation(3, contract=2)
        self.assertEqual(self.run_reuse()['reused'], 0)

    def test_superseded_vectors_remain_reusable_through_host_reference(self):
        for phase in range(4):
            self.observation(phase)
        self.c.execute('DELETE FROM history')
        self.assertEqual(self.run_reuse()['reused'], 1)

    def test_correctness_single_sample_cannot_be_promoted_to_performance(self):
        self.item['kind'] = 'compile'
        self.item['phases'] = ['compile']
        self.observation(0)
        policy = dict(method='feature-compatibility-v1', groupSize=1, maxSamples=1, warmup=0, retainedStart=0, stopReason='fixed-sample')
        self.c.execute('UPDATE sampling_policies SET data=? WHERE id=1', (json.dumps(policy),))
        self.c.execute('UPDATE sample_vectors SET data=? WHERE id=1', (struct.pack('<d', 1.5),))
        self.c.execute('UPDATE observations SET timing_samples=1')
        self.assertEqual(self.run_reuse()['reused'], 0)
        self.item['kind'] = 'compatibility'
        self.assertEqual(self.run_reuse()['reused'], 1)

    def test_pending_adapter_repair_is_not_overwritten(self):
        for phase in range(4):
            self.observation(phase)
        path = self.root / 'latest-features/ledger.json'
        reuse.write(path, {'items': {'1' * 64: {'status': 'repair-pending'}}, 'completedEngines': []})
        self.assertEqual(self.run_reuse()['reused'], 0)
        self.assertEqual(json.loads(path.read_text())['items']['1' * 64]['status'], 'repair-pending')

    def test_named_feature_root_receives_reused_ledger_and_capture(self):
        for phase in range(4):
            self.observation(phase)
        feature_root = self.root / 'latest-features-v2'
        self.assertEqual(self.run_reuse(feature_root)['reused'], 1)
        entry = json.loads((feature_root / 'ledger.json').read_text())['items']['1' * 64]
        self.assertEqual(entry['engine'], 'wasmi')
        self.assertEqual((feature_root / 'captures' / entry['capture']).read_bytes(),
                         (self.root / 'captures' / entry['capture']).read_bytes())


if __name__ == '__main__':
    unittest.main()

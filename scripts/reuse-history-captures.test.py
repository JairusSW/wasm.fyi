import importlib.util
import json
from pathlib import Path
import struct
import unittest


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


fixture=module('feature_fixture','reuse-feature-captures.test.py')
reuse=module('history_reuse','reuse-history-captures.py')


class HistoryReuseTest(fixture.FeatureReuseTest):
    # Reuse the schema/observation builders, not the feature-specific tests.
    def setUp(self):
        super().setUp()
        self.c.execute('CREATE TABLE blocked_revisions(engine,revision)')
        self.c.execute('UPDATE workloads SET name=? WHERE id=1',('applications/add',))
        self.plan=dict(anchor='2026-10-15T07:33:48.082Z',cutoff='2026-06-28T00:00:00Z',pins=[dict(engine='wasmi',repository='fixture/runtime',revision=self.revision,targetWeek='2026-10-15T07:33:48.082Z',status='planned',targetType='main',configurations=['wasmi'])])
        self.contracts=[dict(workload='applications/add',artifactSha256='0'*64,contractSha256='c'*64)]
        self.hosts={'hub':dict(os='linux',arch='amd64',cpu='Host A')}
        self.output=self.root/'staged'

    def run_export(self):
        self.c.commit();before=self.db.read_bytes()
        value=reuse.export_history(self.db,self.plan,self.contracts,self.hosts,self.output)
        self.assertEqual(self.db.read_bytes(),before,'Exporter wrote into the source DB')
        return value

    def read_capture(self,report):
        target=report['targets'][0];return json.loads((self.output/'hub'/'captures'/target['files'][0]['name']).read_text())

    def test_history_preserves_order_samples_platform_and_policy(self):
        for phase in range(4):
            self.observation(phase)
            self.observation(phase,platform=2,at='2026-10-14T00:00:00Z')
            self.observation(phase,source=2,at='2026-10-14T00:00:00Z')
        report=self.run_export();self.assertEqual(report['completeTargets'],1)
        capture=self.read_capture(report)
        self.assertEqual(capture['capturedAt'],self.old)
        self.assertEqual(capture['platform']['kernel'],'old kernel')
        self.assertEqual(capture['source']['revision'],self.revision)
        self.assertEqual(capture['source']['asOf'],self.plan['anchor'])
        for row in capture['results']:
            self.assertEqual(row['samplesNs'],self.samples)
            self.assertEqual(row['display'],{'purpose':'original'})
            self.assertEqual(row['sampling']['method'],'same-process-stability-v1')
            self.assertEqual(row['peakRssBytes'],12345)
        self.assertFalse((self.root/'build-status.json').exists())

    def test_keeps_legacy_three_sample_vectors_without_adaptive_relabel(self):
        for phase in range(4):self.observation(phase)
        samples=[3.125,9.25,4.5]
        self.c.execute('UPDATE sample_vectors SET data=?',(struct.pack('<3d',*samples),))
        self.c.execute('UPDATE observations SET timing_samples=3,sampling_id=NULL')
        capture=self.read_capture(self.run_export())
        self.assertTrue(all(r['samplesNs']==samples and r['timingSamples']==3 and 'sampling' not in r for r in capture['results']))

    def test_partial_capture_and_invalid_policy_do_not_qualify(self):
        for phase in range(3):self.observation(phase)
        self.assertEqual(self.run_export()['files'],0)
        # A separately staged attempt still must reject an invalid declared policy.
        (self.output/'receipt.json').unlink();self.observation(3)
        self.c.execute('UPDATE observations SET timing_samples=3')
        report=self.run_export();self.assertEqual(report['files'],0);self.assertTrue(report['rejected'])

    def test_failure_is_retained_honestly_and_cannot_be_silently_retried(self):
        for phase in range(4):self.observation(phase)
        self.c.execute('UPDATE observations SET latency_status=2,timing_samples=0,samples_id=NULL WHERE phase=3')
        report=self.run_export();capture=self.read_capture(report)
        name=report['targets'][0]['files'][0]['name'];note=json.loads((self.output/'hub'/'failure-notes'/name).read_text())
        self.assertEqual(capture['results'][3]['latencyStatus'],'failed')
        self.assertIn('original diagnostic text is unavailable',note['reason'])
        self.assertEqual(note['failures'][0]['phase'],'steady')
        self.assertEqual(note['source'],capture['source'])
        self.assertEqual(note['capturedAt'],capture['capturedAt'])

    def test_scope_and_blocklist(self):
        self.plan['pins'][0]['targetWeek']='2026-06-21T10:00:00.000Z'
        self.assertEqual(self.run_export()['targets'],[])
        (self.output/'receipt.json').unlink();self.plan['pins'][0]['targetWeek']=self.plan['anchor']
        self.c.execute('INSERT INTO blocked_revisions VALUES(?,?)',('wasmi',self.revision))
        with self.assertRaisesRegex(ValueError,'Blocked revision'):self.run_export()

    def test_only_complete_original_capture_groups_are_used(self):
        for phase in range(4):self.observation(phase)
        self.observation(0,at='2026-10-14T00:00:00.000Z')
        capture=self.read_capture(self.run_export());self.assertEqual(capture['capturedAt'],self.old)
        self.assertTrue(all(r['timingSamples']==5 for r in capture['results']))


# Do not inherit feature-only tests that call the unrelated reuse API.
for name in list(vars(fixture.FeatureReuseTest)):
    if name.startswith('test_'):
        setattr(HistoryReuseTest,name,None)


class JobIdentityTest(unittest.TestCase):
    def test_worker_job_names_for_native_go_and_libwasm(self):
        pin=dict(engine='wasmi',repository='owner/repo',revision='a'*40,targetWeek='2026-10-04T10:00:00.000Z',status='planned',targetType='main',configurations=['wasmi'])
        def target():return reuse.targets({'pins':[pin]})[0]
        self.assertEqual(target()['jobId'],'history-5-wasmi-'+'a'*40+'-main-2026-10-04T10_00_00.000Z')
        self.assertEqual(target()['source']['ref'],'main@aaaaaaaa')
        pin.update(engine='wazero',configurations=['wazero-interpreter'],tag='v1.9.0',dateBasis='git-tag-commit',targetType='release')
        t=target();self.assertEqual(t['jobId'],'history-5-wazero-interpreter-aaaaaaaaaaaa-release-20261004100000000-v1.9.0')
        self.assertEqual(t['pinKey'],'wazero|release|v1.9.0|2026-10-04T10:00:00.000Z');self.assertEqual(t['source']['dateBasis'],'git-tag-commit')
        pin.update(engine='libwasm',configurations=['libwasm'],targetType='main');pin.pop('tag');pin.pop('dateBasis')
        self.assertEqual(target()['jobId'],'libwasm-aaaaaaaaaaaa-20261004100000000')

    def test_duplicate_source_commits_are_not_scheduled_twice(self):
        pin=dict(engine='wasmi',repository='owner/repo',revision='a'*40,targetWeek='2026-10-04T10:00:00.000Z',status='planned',targetType='main',configurations=['wasmi'])
        with self.assertRaisesRegex(ValueError,'Duplicate source'):reuse.targets({'pins':[pin,{**pin,'targetWeek':'2026-09-27T10:00:00.000Z'}]})


if __name__=='__main__':unittest.main()

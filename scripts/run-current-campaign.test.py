import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class CampaignRecovery(unittest.TestCase):
    def test_invalidated_feature_marker_reopens_finished_engine_without_repeating_completed_work(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inputs = root / 'inputs'
            inputs.mkdir()
            for kind in ['compatibility', 'performance', 'compile', 'lifecycle']:
                (inputs / (kind + '.json')).write_text('[]')
            (root / 'latest-features').mkdir()
            revision = 'a' * 40
            pin = dict(engine='fixture', revision=revision, targetType='main',
                       targetWeek='2026-10-24', configurations=['fixture'], status='planned')
            (root / 'source-plan.json').write_text(json.dumps(dict(pins=[pin])))
            (root / 'collection-template.json').write_text(json.dumps(dict(env={})))
            (root / 'latest-features/status.json').write_text(json.dumps(dict(inputIdentity='suite')))
            (root / 'latest-features/ledger.json').write_text(json.dumps(dict(completedEngines=[])))
            fingerprint = hashlib.sha256(b'[]' * 4).hexdigest()
            (root / 'fleet-worker.json').write_text(json.dumps(dict(
                completed=['fixture|' + revision], errors=[], inputFingerprint=fingerprint)))
            node = root / 'mock-node'
            node.write_text('''#!''' + sys.executable + '''
import json,sys
from pathlib import Path
r=Path(sys.argv[2]); pin=json.loads((r/'source-plan.json').read_text())['pins'][0]
with (r/'mock-launches').open('a') as out: out.write(Path(sys.argv[1]).name+'\\n')
if 'latest-feature-campaign' in sys.argv[1]:
 (r/'latest-features/status.json').write_text(json.dumps(dict(status='completed',inputIdentity='suite')))
 (r/'latest-features/ledger.json').write_text(json.dumps(dict(completedEngines=['fixture|'+pin['revision']+'|suite'])))
else:
 key='fixture|main|'+pin['revision']+'|'+pin['targetWeek']
 (r/'fixture-history-status.json').write_text(json.dumps(dict(completed=[dict(pinKey=key,workloadErrors=[])])))
''')
            node.chmod(0o755)
            (root / 'runner-config.json').write_text(json.dumps(dict(
                site=str(root), node=str(node), inputs=str(inputs))))
            command = [sys.executable, str(Path(__file__).with_name('run-current-campaign.py')), str(root)]
            subprocess.run(command, check=True, timeout=10)
            expected = ['benchmark-engine-history.mjs', 'latest-feature-campaign.mjs']
            self.assertEqual((root / 'mock-launches').read_text().splitlines(), expected)
            self.assertEqual(json.loads((root / 'fleet-worker.json').read_text())['status'], 'completed')
            subprocess.run(command, check=True, timeout=10)
            self.assertEqual((root / 'mock-launches').read_text().splitlines(), expected)


if __name__ == '__main__':
    unittest.main()

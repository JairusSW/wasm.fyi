import importlib.util,json,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone,timedelta
spec=importlib.util.spec_from_file_location('watch',Path(__file__).with_name('watch-history-campaign.py'));watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch)
class GuardTests(unittest.TestCase):
 def test_live_identity_and_expired_queue(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);now=datetime.now(timezone.utc);file=root/'week-first-continuation-v5-status.json'
   file.write_text(json.dumps({'pid':7,'status':'waiting-latest-natural-boundary','started':now.isoformat()}))
   rows=[(7,'node '+str(root/'remote-week-first-continuation-v5.mjs'))]
   self.assertFalse(watch.continuation_guard_state(root,rows,now)['needsInspection'])
   self.assertTrue(watch.continuation_guard_state(root,[(7,'different process')],now)['needsInspection'])
   self.assertTrue(watch.continuation_guard_state(root,rows,now+timedelta(hours=25))['queueBudgetExpired'])
 def test_terminal_audit_reported_without_failure_erasure(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);file=root/'week-first-continuation-v5-status.json';body=json.dumps({'pid':7,'status':'blocked-latest-integration-audit','failures':['original error']});file.write_text(body)
   self.assertTrue(watch.continuation_guard_state(root,[])['needsInspection']);self.assertEqual(file.read_text(),body)
 def test_other_machine_without_guard_unchanged(self):
  with tempfile.TemporaryDirectory() as directory:self.assertIsNone(watch.continuation_guard_state(Path(directory),[]))
 def test_small_continuation_wrong_pid_and_terminal_need_inspection(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);now=datetime.now(timezone.utc);file=root/'oct4-small-continuation-status.json'
   body={'pid':8,'status':'running','engine':'endive','startedAt':now.isoformat()};file.write_text(json.dumps(body))
   rows=[(8,'node /run/remote-oct4-small-continuation.mjs')]
   self.assertFalse(watch.small_continuation_state(root,rows,now)['needsInspection'])
   self.assertTrue(watch.small_continuation_state(root,[(8,'unrelated process')],now)['needsInspection'])
   self.assertTrue(watch.small_continuation_state(root,rows,now+timedelta(hours=25))['queueBudgetExpired'])
   body['status']='terminal-awaiting-oct4-audit';file.write_text(json.dumps(body))
   self.assertTrue(watch.small_continuation_state(root,rows,now)['needsInspection'])
if __name__=='__main__':unittest.main()

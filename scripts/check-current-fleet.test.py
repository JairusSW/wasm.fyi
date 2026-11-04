import ast
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

class FleetProbe(unittest.TestCase):
    def test_paused_supervisor_reports_live_boundary_build_instead_of_zombie(self):
        tree=ast.parse(Path(__file__).with_name('check-current-fleet.py').read_text())
        probe=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='probe' for t in n.targets))
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            directory=str(root)
            (root/'fleet-worker.json').write_text(json.dumps(dict(pid=10,childPid=11,status='running',engine='wasmedge',stage='main',updated=time.time(),errors=[])))
            commands={10:'Ts python3 /scripts/run-current-campaign.py '+directory,11:'Z node dead',12:'Sl node /scripts/benchmark-engine-history.mjs '+directory+' /frozen jsc'}
            def run(args,**kwargs):
                value=commands.get(int(args[2]),'')
                return subprocess.CompletedProcess(args,0 if value else 1,stdout=value,stderr='')
            output=io.StringIO()
            with patch.object(sys,'argv',['probe',directory]),patch('subprocess.run',side_effect=run),patch('subprocess.check_output',return_value='12 node /scripts/benchmark-engine-history.mjs '+directory+' /frozen jsc\n'),contextlib.redirect_stdout(output):
                exec(probe,{})
            report=json.loads(output.getvalue())
            self.assertEqual(report['engine'],'jsc')
            self.assertEqual(report['stage'],'main')
            self.assertTrue(report['boundaryRepair'])
            self.assertEqual(report['child']['pid'],12)
            self.assertTrue(report['child']['alive'])

    def test_finished_worker_may_exit_without_a_stall_alert(self):
        tree=ast.parse(Path(__file__).with_name('check-current-fleet.py').read_text())
        probe=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='probe' for t in n.targets))
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for status,errors,attention in [('completed',[],False),('needs-repair',[],True),('completed',['unresolved'],True)]:
                (root/'fleet-worker.json').write_text(json.dumps(dict(pid=10,childPid=None,status=status,engine=None,stage=None,updated=time.time()-3600,errors=errors)))
                output=io.StringIO()
                stopped=subprocess.CompletedProcess([],1,stdout='',stderr='')
                with patch.object(sys,'argv',['probe',directory]),patch('subprocess.run',return_value=stopped),contextlib.redirect_stdout(output):
                    exec(probe,{})
                self.assertEqual(json.loads(output.getvalue())['needsAttention'],attention)

    def test_operator_pause_does_not_report_a_stalled_capture(self):
        tree=ast.parse(Path(__file__).with_name('check-current-fleet.py').read_text())
        probe=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='probe' for t in n.targets))
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'OPERATOR-PAUSED').write_text('User gaming; wait for explicit resume.\n')
            (root/'fleet-worker.json').write_text(json.dumps(dict(pid=10,childPid=None,status='paused',updated=time.time()-3600,errors=['pending repair'])))
            output=io.StringIO()
            stopped=subprocess.CompletedProcess([],1,stdout='',stderr='')
            with patch.object(sys,'argv',['probe',directory]),patch('subprocess.run',return_value=stopped),contextlib.redirect_stdout(output):
                exec(probe,{})
            result=json.loads(output.getvalue())
            self.assertTrue(result['operatorPaused'])
            self.assertFalse(result['needsAttention'])
            self.assertEqual(result['errors'],['pending repair'])

if __name__=='__main__':unittest.main()

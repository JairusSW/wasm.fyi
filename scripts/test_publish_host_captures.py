import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import tempfile
import os
import sys
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-host-captures.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class PublicationLedgerTests(unittest.TestCase):
    def test_journal_recovers_receipts_before_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / 'published.json'
            ledger.write_text(json.dumps(['a' * 64]))
            publisher.remember_publication(ledger, 'b' * 64)
            self.assertEqual(publisher.publication_ledger(ledger), {'a' * 64, 'b' * 64})
            self.assertEqual(json.loads(ledger.read_text()), ['a' * 64])
            publisher.compact_publication_ledger(ledger, publisher.publication_ledger(ledger))
            self.assertEqual(publisher.publication_ledger(ledger), {'a' * 64, 'b' * 64})
            self.assertEqual(ledger.with_suffix('.journal').read_bytes(), b'')

    def test_partial_final_receipt_never_marks_capture_published(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / 'published.json'
            ledger.with_suffix('.journal').write_bytes(('a' * 64 + '\n' + 'b' * 17).encode())
            self.assertEqual(publisher.publication_ledger(ledger), {'a' * 64})


def response(code, stderr=b''):
    return subprocess.CompletedProcess([], code, b'', stderr)


class PersistentSSHTests(unittest.TestCase):
    def test_existing_master_is_verified_without_forking(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher, 'run_sync', return_value=response(0, b'Master running (pid=42)')) as run, patch.object(publisher.os, 'kill') as kill:
            self.assertEqual(publisher.ensure_ssh_master('hub@hub', '/tmp/test-%C', Path(directory)), 42)
            self.assertEqual(run.call_count, 1)
            self.assertIn('check', run.call_args.args[0])
            kill.assert_called_once_with(42, 0)
            record = json.loads((Path(directory) / 'ssh-master.json').read_text())
            self.assertTrue(record['intentionalPersistentConnection'])

    def test_explicit_master_is_recorded_before_transfers(self):
        replies = [response(255), response(0), response(0, b'Master running (pid=42)')]
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher, 'run_sync', side_effect=replies) as run, patch.object(publisher, 'ssh_processes_in_service', return_value=set()), patch.object(publisher.os, 'kill'):
            publisher.ensure_ssh_master('hub@hub', '/tmp/test-%C', Path(directory))
            startup = run.call_args_list[1].args[0]
            effective = subprocess.run(['ssh', '-G', *startup[1:]], capture_output=True, text=True, check=True).stdout
            self.assertIn('controlmaster true', effective.splitlines())
            self.assertIn('ControlMaster=yes', startup)
            self.assertIn('ControlPersist=24h', startup)
            self.assertNotIn('ControlMaster=auto', startup)

    def test_unverified_fork_is_cleaned_without_killing_old_master(self):
        replies = [response(255), response(0), response(255, b'connection refused')]
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher, 'run_sync', side_effect=replies), patch.object(publisher, 'ssh_processes_in_service', side_effect=[{7}, {7, 8}, {7, 8}]), patch.object(publisher.os, 'kill') as kill:
            with self.assertRaises(RuntimeError):
                publisher.ensure_ssh_master('hub@hub', '/tmp/test-%C', Path(directory))
            kill.assert_called_once_with(8, signal.SIGTERM)
            self.assertFalse((Path(directory) / 'ssh-master.json').exists())

    def test_authenticated_master_survives_startup_observation_timeout(self):
        replies = [response(255), subprocess.TimeoutExpired(['ssh'], 20), response(0, b'Master running (pid=42)'), response(0, b'Master running (pid=42)')]
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher, 'run_sync', side_effect=replies), patch.object(publisher, 'ssh_processes_in_service', return_value=set()), patch.object(publisher.os, 'kill') as kill:
            self.assertEqual(publisher.ensure_ssh_master('hub@hub', '/tmp/test-%C', Path(directory)), 42)
            kill.assert_called_once_with(42, 0)


class DetachedPipeTests(unittest.TestCase):
    def fork_command(self, pidfile):
        source = """import os, pathlib, time
if os.fork():
    os._exit(0)
os.setsid()
pathlib.Path(%r).write_text(str(os.getpid()))
time.sleep(30)
""" % str(pidfile)
        return [sys.executable, '-c', source]

    def cleanup(self, pidfile):
        deadline = time.monotonic() + 1
        while not pidfile.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        if pidfile.exists():
            try:
                os.kill(int(pidfile.read_text()), signal.SIGTERM)
            except ProcessLookupError:
                pass

    def test_explicit_daemon_startup_does_not_inherit_captured_pipes(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / 'intentional-daemon.pid'
            try:
                result = publisher.run_sync(self.fork_command(pidfile), timeout=0.5, capture_output=False)
                self.assertEqual(result.returncode, 0)
            finally:
                self.cleanup(pidfile)

    def test_timeout_cleanup_cannot_hang_on_detached_descendant_pipe(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / 'detached-child.pid'
            previous = signal.signal(signal.SIGALRM, lambda *args: (_ for _ in ()).throw(RuntimeError('cleanup deadline exceeded')))
            signal.setitimer(signal.ITIMER_REAL, 4)
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    publisher.run_sync(self.fork_command(pidfile), timeout=0.1)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, previous)
                self.cleanup(pidfile)



class SampleCountTests(unittest.TestCase):
    def row(self, phase, cap, n):
        return {"phase": phase, "timingSamples": n, "samplesNs": [1] * n,
                "sampling": {"method": "same-process-stability-v1", "groupSize": 5, "maxSamples": cap, "warmup": 0}}

    def test_phase_caps_and_legacy_records_publish_without_recollection(self):
        for phase in ("compile", "instantiate", "first-call", "steady"):
            for cap in (35, 10 if phase in ("compile", "instantiate") else 25):
                for n in (5, cap):
                    with self.subTest(phase=phase, cap=cap, n=n):
                        self.assertTrue(publisher.valid_sample_count(self.row(phase, cap, n), 5, True))

    def test_wrong_cap_partial_groups_and_overcap_are_rejected(self):
        self.assertFalse(publisher.valid_sample_count(self.row("compile", 25, 5), 5, True))
        self.assertFalse(publisher.valid_sample_count(self.row("steady", 10, 5), 5, True))
        self.assertFalse(publisher.valid_sample_count(self.row("compile", 10, 15), 5, True))
        self.assertFalse(publisher.valid_sample_count(self.row("steady", 25, 7), 5, True))

    def test_boolean_adaptive_policy_requires_ordered_sample_metadata(self):
        row = {"timingSamples": 5, "samplesNs": [1] * 5}
        self.assertFalse(publisher.valid_sample_count(row, 5, True))
        self.assertTrue(publisher.valid_sample_count(row, 5, None))

if __name__ == '__main__':
    unittest.main()

"""Run the adapter's actual resource policy in disposable Linux subprocesses."""
import ast
import os
import json
from pathlib import Path
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / 'adapters/qualification/zwasm/adapter.py'
policy = next(node for node in ast.parse(source.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == 'apply_data_limit')
code = 'import os,sys,resource\n' + ast.get_source_segment(source.read_text(), policy)


class ProtocolDescription(unittest.TestCase):
    def test_effective_configuration_matches_string_map_protocol(self):
        tree = ast.parse(source.read_text())
        assignment = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Subscript) and ast.get_source_segment(source.read_text(), target) == "response['description']" for target in node.targets))
        expression = ast.Expression(assignment.value)
        description = eval(compile(expression, str(source), 'eval'), {
            'lib': SimpleNamespace(wb_version=lambda: b'qualified-source'),
            'interpreter': True, 'data_limit': 8 << 30, 'rss_budget': 8 << 30,
        })
        self.assertTrue(all(isinstance(value, str) for value in description['effective_configuration'].values()),
                        'Go protocol.Description.Configuration is map[string]string')



class SampleBoundaryBudget(unittest.TestCase):
    def test_darwin_bytes_and_linux_kib_are_checked_outside_sampling(self):
        functions = [node for node in ast.parse(source.read_text()).body if isinstance(node, ast.FunctionDef) and node.name in ['check_rss_budget', 'peak_rss_bytes']]
        snippet = '\n'.join(ast.get_source_segment(source.read_text(), node) for node in functions)
        for platform, peak in [('darwin', 9 << 30), ('linux', 9 << 20)]:
            namespace = {'sys': SimpleNamespace(platform=platform)}
            exec(snippet, namespace)
            with patch('resource.getrusage', return_value=SimpleNamespace(ru_maxrss=peak)):
                with self.assertRaisesRegex(RuntimeError, 'resource budget exceeded'):
                    namespace['check_rss_budget'](8 << 30)
                namespace['check_rss_budget'](10 << 30)
            with patch('resource.getrusage', side_effect=AssertionError('disabled budget must avoid polling')):
                namespace['check_rss_budget'](0)


class ActiveRequestBudget(unittest.TestCase):
    def run_guard(self, body):
        nodes = [node for node in ast.parse(source.read_text()).body
                 if isinstance(node, ast.ClassDef) and node.name == 'RSSBudgetGuard']
        code = 'import os,json,threading,time\n' + ast.get_source_segment(source.read_text(), nodes[0])
        return subprocess.run([sys.executable, '-c', code + '\n' + body], capture_output=True, text=True, timeout=5)

    def test_foreign_call_budget_emits_valid_active_request_error_and_exits(self):
        result = self.run_guard("peak_rss_bytes=lambda: 2048\ng=RSSBudgetGuard(1024)\ng.begin({'id':'native-call-7'})\ntime.sleep(3)")
        self.assertEqual(result.returncode, 70)
        response = json.loads(result.stdout)
        self.assertEqual((response['version'], response['id'], response['status']), (1, 'native-call-7', 'error'))
        self.assertIn('2048 bytes exceeds process RSS budget 1024 bytes', response['reason'])
        self.assertIn('operator safety limit', response['reason'])
        self.assertNotIn('unsupported', response['reason'])
        self.assertEqual(result.stderr, '')

    def test_completed_response_is_not_followed_by_an_idle_budget_error(self):
        result = self.run_guard("peak_rss_bytes=lambda: 0\ng=RSSBudgetGuard(1024)\ng.begin({'id':'one'})\ng.reply({'version':1,'id':'one','status':'ok'})\npeak_rss_bytes=lambda: 2048\ntime.sleep(.04)")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'version': 1, 'id': 'one', 'status': 'ok'})

    def test_idle_guard_does_not_poll_process_memory(self):
        result = self.run_guard("def peak_rss_bytes():\n raise AssertionError('idle guard must sleep')\ng=RSSBudgetGuard(1024)\ntime.sleep(.04)")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, '')

    def test_next_request_keeps_its_own_protocol_id(self):
        result = self.run_guard("peak_rss_bytes=lambda: 0\ng=RSSBudgetGuard(1024)\ng.begin({'id':'old'})\ng.reply({'version':1,'id':'old','status':'ok'})\npeak_rss_bytes=lambda: 2048\ng.begin({'id':'new'})\ntime.sleep(3)")
        self.assertEqual(result.returncode, 70)
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([(r['id'], r['status']) for r in responses], [('old', 'ok'), ('new', 'error')])

    def test_zero_budget_does_not_create_a_watchdog(self):
        assignment = next(node for node in ast.parse(source.read_text()).body if isinstance(node, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == 'rss_guard' for t in node.targets))
        expression = ast.Expression(assignment.value)
        namespace = {'rss_budget': 0, 'RSSBudgetGuard': lambda _: self.fail('disabled budget created a guard')}
        self.assertIsNone(eval(compile(expression, str(source), 'eval'), namespace))

@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux allocation limits')
class MemoryPolicy(unittest.TestCase):
    def run_policy(self, requested=None, prefix=''):
        env = {k: v for k, v in os.environ.items() if k != 'WASMBENCH_ZWASM_DATA_LIMIT_BYTES'}
        if requested is not None:
            env['WASMBENCH_ZWASM_DATA_LIMIT_BYTES'] = str(requested)
        return subprocess.run([sys.executable, '-c', code + '\n' + prefix + '\nprint(apply_data_limit())'], env=env, capture_output=True, text=True)

    def test_default_and_explicit_limit(self):
        self.assertEqual(self.run_policy().stdout.strip(), str(8 << 30))
        self.assertEqual(self.run_policy(256 << 20).stdout.strip(), str(256 << 20))

    def test_existing_lower_limit_is_never_raised(self):
        result = self.run_policy(prefix='resource.setrlimit(resource.RLIMIT_DATA, (128 << 20, resource.RLIM_INFINITY))')
        self.assertEqual(result.stdout.strip(), str(128 << 20))

    def test_opt_out_and_invalid_configuration(self):
        self.assertEqual(self.run_policy(0).stdout.strip(), '0')
        self.assertNotEqual(self.run_policy(-1).returncode, 0)
        self.assertNotEqual(self.run_policy('invalid').returncode, 0)


if __name__ == '__main__':
    unittest.main()

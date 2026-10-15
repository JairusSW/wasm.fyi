"""Run the adapter's actual resource policy in disposable Linux subprocesses."""
import ast
import os
from pathlib import Path
import subprocess
import sys
import unittest
from types import SimpleNamespace

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
            'interpreter': True, 'data_limit': 8 << 30,
        })
        self.assertTrue(all(isinstance(value, str) for value in description['effective_configuration'].values()),
                        'Go protocol.Description.Configuration is map[string]string')


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

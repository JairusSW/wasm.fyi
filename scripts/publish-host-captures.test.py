import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('publisher', pathlib.Path(__file__).with_name('publish-host-captures.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class SnapshotCutoffTests(unittest.TestCase):
    def test_retains_prior_week_and_excludes_current_week_with_same_commit(self):
        for date, allowed in [('2026-10-09T08:07:55Z', True), ('2026-10-10T23:59:59Z', True), ('2026-10-11T00:00:00Z', False)]:
            self.assertEqual(publisher.snapshot_allowed({'asOf': date, 'revision': 'same-commit'}, '2026-10-11'), allowed)

    def test_unconfigured_publisher_keeps_existing_behavior(self):
        self.assertTrue(publisher.snapshot_allowed({'asOf': '2026-10-09T08:07:55Z'}, ''))

if __name__ == '__main__':
    unittest.main()

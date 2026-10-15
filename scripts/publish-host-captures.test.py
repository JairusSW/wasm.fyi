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

class PublicationPinTests(unittest.TestCase):
    def test_explicit_main_pin_does_not_change_the_weekly_plan(self):
        import copy
        main = {'pins': [{'revision': 'a' * 40, 'tag': 'v1', 'targetWeek': 'week', 'configurations': ['peer'], 'status': 'reused'}]}
        extra = {'pins': [{'revision': 'b' * 40, 'targetWeek': 'snapshot', 'configurations': ['wago'], 'status': 'planned'}]}
        before = copy.deepcopy(main)
        allowed = publisher.source_pin_allowlist(main, extra)
        self.assertEqual(allowed, {('peer', 'v1', 'week'), ('wago', 'b' * 40, 'snapshot')})
        self.assertEqual(main, before)
        self.assertNotIn(('wago', 'c' * 40, 'snapshot'), allowed)
        self.assertNotIn(('wago', 'b' * 40, 'other-week'), allowed)
        self.assertEqual(publisher.source_pin_allowlist(main), {('peer', 'v1', 'week')})

    def test_failed_and_unresolved_pins_cannot_admit_captures(self):
        plan = {'pins': [
            {'revision': 'a' * 40, 'targetWeek': 'week', 'configurations': ['failed'], 'status': 'build-failed'},
            {'revision': None, 'targetWeek': 'week', 'configurations': ['missing']},
            {'revision': 'b' * 40, 'targetWeek': 'week', 'configurations': ['legacy']},
        ]}
        self.assertEqual(publisher.source_pin_allowlist(plan), {('legacy', 'b' * 40, 'week')})

if __name__ == '__main__':
    unittest.main()

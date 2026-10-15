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


class RecordedSamplesTests(unittest.TestCase):
    def test_legacy_count_needs_explicit_opt_in_and_retains_policy(self):
        row = {'workload': 'applications/audio', 'timingSamples': 3, 'samplesNs': [1, 2, 3]}
        self.assertFalse(publisher.valid_sample_count(row, 5, True))
        self.assertTrue(publisher.valid_sample_count(row, 5, True, True))
        self.assertNotIn('sampling', row)

    def test_reuse_rejects_missing_invalid_or_fabricated_vectors(self):
        for values in [[], [1, 2], [1, 2, float('nan')], [1, 2, -1], [1, 2, True]]:
            row = {'workload': 'applications/audio', 'timingSamples': 3, 'samplesNs': values}
            self.assertFalse(publisher.valid_sample_count(row, 5, True, True))
        row = {'workload': 'features/tiny', 'timingSamples': 3, 'samplesNs': [1, 2, 3]}
        self.assertFalse(publisher.valid_sample_count(row, 5, True, True))

    def test_declared_adaptive_policy_is_never_relaxed(self):
        row = {'workload': 'applications/audio', 'phase': 'steady', 'timingSamples': 3,
               'samplesNs': [1, 2, 3], 'sampling': {'method': 'same-process-stability-v1',
                   'groupSize': 5, 'maxSamples': 25, 'warmup': 0}}
        self.assertFalse(publisher.valid_sample_count(row, 5, True, True))

if __name__ == '__main__':
    unittest.main()

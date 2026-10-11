import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('shared_device_run', pathlib.Path(__file__).with_name('shared-device-run.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScheduleTests(unittest.TestCase):
    def test_short_reservations_accumulate_into_handoff(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'schedule.json'
            module.record_reservation(path, 1200, 0, 100)
            module.record_reservation(path, 599, 0, 200)
            self.assertEqual(module.read_schedule(path), {'ownedSeconds': 1799, 'breakUntil': 0})
            module.record_reservation(path, 1, 0, 300)
            self.assertEqual(module.read_schedule(path), {'ownedSeconds': 0, 'breakUntil': 600})
            module.record_reservation(path, 20, 0, 620)
            self.assertEqual(module.read_schedule(path)['ownedSeconds'], 20)

    def test_occupied_wait_does_not_consume_reserved_time(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'schedule.json'
            module.record_reservation(path, 1200, 0, 100)
            module.record_reservation(path, 99999, 75, 200)
            self.assertEqual(module.read_schedule(path), {'ownedSeconds': 1200, 'breakUntil': 0})

    def test_workload_boundary_yield_starts_one_handoff(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'schedule.json'
            module.record_reservation(path, 10, 76, 100)
            self.assertEqual(module.read_schedule(path), {'ownedSeconds': 0, 'breakUntil': 400})

    def test_existing_detached_jobs_discover_frozen_campaign(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'source-plan.json').write_text('{}')
            (root / 'collection-template.json').write_text('{}')
            self.assertEqual(module.campaign_schedule(['node', str(root / 'builds' / 'job')], {}), root / 'device-schedule.json')
            self.assertEqual(module.campaign_schedule(['go'], {'WASMBENCH_SHARED_DEVICE_SCHEDULE': str(root / 'explicit.json')}), root / 'explicit.json')


if __name__ == '__main__':
    unittest.main()

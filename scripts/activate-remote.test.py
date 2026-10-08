import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('activation', pathlib.Path(__file__).with_name('activate-remote.py'))
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class ActivationTests(unittest.TestCase):
    def test_only_commit_ids_are_accepted(self):
        self.assertEqual(activation.validate_revision('a' * 40), 'a' * 40)
        for value in ('../secret', 'main', 'a' * 40 + '/frontend', '--help'):
            with self.assertRaises(ValueError):
                activation.validate_revision(value)

    def test_untrusted_upload_cannot_copy_a_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory).resolve()
            (root / 'private').write_text('private')
            (root / 'payload').mkdir()
            (root / 'payload' / 'file').symlink_to(root / 'private')
            descriptor = os.open(root / 'payload', activation.DIRECTORY_FLAGS)
            try:
                with self.assertRaises(OSError):
                    activation.copy_file(descriptor, 'file', root / 'copied', {'bytes': 100, 'files': 10})
                self.assertFalse((root / 'copied').exists())
            finally:
                os.close(descriptor)

    def test_failed_health_check_rolls_back_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory).resolve()
            old, new, current = root / 'old', root / 'new', root / 'current'
            old.mkdir()
            new.mkdir()
            current.symlink_to(old)
            calls = []
            def restart():
                calls.append(current.resolve())
            def fail():
                raise RuntimeError('Unhealthy')
            with mock.patch.object(activation, 'CURRENT', current):
                with self.assertRaises(RuntimeError):
                    activation.activate(new, restart, fail)
            self.assertEqual(current.resolve(), old)
            self.assertEqual(calls, [new, old])


if __name__ == '__main__':
    unittest.main()

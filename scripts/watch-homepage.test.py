import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('homepage',Path(__file__).with_name('watch-homepage.py'))
home=importlib.util.module_from_spec(spec);spec.loader.exec_module(home)
class HomepageTests(unittest.TestCase):
 def test_published_revision_controls_rebuild(self):
  with tempfile.TemporaryDirectory() as directory:
   front=Path(directory)
   self.assertTrue(home.needs_bake(front,'new'))
   (front/'homepage-revision.json').write_text('{"revision":"old"}')
   self.assertTrue(home.needs_bake(front,'new'))
   self.assertFalse(home.needs_bake(front,'old'))
 def test_unchanged_publication_does_not_launch_renderer(self):
  with tempfile.TemporaryDirectory() as directory:
   current=Path(directory);front=current/'frontend';front.mkdir();(front/'.homepage-baker.mjs').write_text('');(front/'homepage-revision.json').write_text('{"revision":"same"}')
   args=SimpleNamespace(current=current,api='http://local')
   with patch.object(home,'revision',return_value='same'),patch.object(home.subprocess,'run') as run:
    self.assertFalse(home.refresh(args));run.assert_not_called()
 def test_failed_render_keeps_revision_pending(self):
  with tempfile.TemporaryDirectory() as directory:
   current=Path(directory);front=current/'frontend';front.mkdir();(front/'.homepage-baker.mjs').write_text('');(front/'homepage-revision.json').write_text('{"revision":"old"}')
   args=SimpleNamespace(current=current,api='http://local',locked=True,deployment_lock=current/'lock',node='node')
   with patch.object(home,'revision',return_value='new'),patch.object(home.subprocess,'run',side_effect=RuntimeError('failed')):
    with self.assertRaises(RuntimeError):home.refresh(args)
   self.assertTrue(home.needs_bake(front,'new'))
if __name__=='__main__':unittest.main()

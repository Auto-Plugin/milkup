import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('envprobe',Path(__file__).with_name('linux-update-environment.py'))
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class DependencyGate(unittest.TestCase):
    def test_complete_explicit_native_commands(self):
        result=probe.require_commands(probe.COMMANDS,lambda name:'/inert/'+name)
        self.assertEqual(set(result),set(probe.COMMANDS))
        self.assertIn('xprop',result)
        self.assertIn('WebKitWebDriver',result)
        self.assertNotIn('rg',result)

    def test_missing_each_dependency_is_not_ignored(self):
        for missing in probe.COMMANDS:
            with self.subTest(missing=missing),self.assertRaisesRegex(AssertionError,'Missing required commands'):
                probe.require_commands(probe.COMMANDS,lambda name:None if name==missing else '/inert/'+name)

if __name__=='__main__':unittest.main()

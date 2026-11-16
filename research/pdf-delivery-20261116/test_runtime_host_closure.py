import unittest
from pathlib import Path
import runtime_host_closure as h


class Versions(unittest.TestCase):
    def test_separate_definitions_and_each_needed_library(self):
        text='''Version definition section '.gnu.version_d' contains 2 entries:
  0x001c: Rev: 1 Flags: none Index: 2 Cnt: 1 Name: GLIBC_2.2.5
Version needs section '.gnu.version_r' contains 2 entries:
  0x0000: Version: 1 File: libc.so.6 Cnt: 2
  0x0010: Name: GLIBC_2.39 Flags: none Version: 3
  0x0020: Name: GLIBC_2.34 Flags: none Version: 2
  0x0030: Version: 1 File: libstdc++.so.6 Cnt: 1
  0x0040: Name: GLIBCXX_3.4.32 Flags: none Version: 4
'''
        definitions,needs=h.versions(text)
        self.assertEqual(definitions,{'GLIBC_2.2.5'})
        self.assertEqual(needs,{'libc.so.6':{'GLIBC_2.39','GLIBC_2.34'},'libstdc++.so.6':{'GLIBCXX_3.4.32'}})
        h.check_versions(needs,needs)
        with self.assertRaisesRegex(ValueError,'Unsatisfied'):h.check_versions(needs,{'libc.so.6':set.union(*needs.values())})
        with self.assertRaisesRegex(ValueError,'Unsatisfied'):h.check_versions(needs,{'libc.so.6':{'GLIBC_2.34'},'libstdc++.so.6':{'GLIBCXX_3.4.32'}})

    def test_real_host_readelf_parsing_does_not_execute_elf(self):
        path=Path('/usr/lib/x86_64-linux-gnu/libc.so.6')
        if not path.is_file():self.skipTest('No local amd64 glibc fixture')
        defs,needs=h.versions(h.run('readelf','--version-info',str(path)))
        self.assertIn('GLIBC_2.2.5',defs)
        self.assertTrue(needs)

    def test_native_workflow_has_no_engine_or_install_operation(self):
        workflow=(Path(__file__).resolve().parents[2]/'.github/workflows/linux-webkit-build-research.yml').read_text()
        job=workflow.split('\n  current-runtime-intake:',1)[1]
        self.assertIn('timeout-minutes: 20',job)
        self.assertIn('14265020653',job);self.assertIn('14264011071',job)
        self.assertNotIn('current_engine.py',job);self.assertNotIn('cmake --build',job)
        self.assertNotIn('dpkg -i',job);self.assertNotIn('LD_LIBRARY_PATH',job)
        self.assertIn('retention-days: 90',job)


if __name__=='__main__':unittest.main()

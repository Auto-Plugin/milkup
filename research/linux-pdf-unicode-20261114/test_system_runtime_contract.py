import pathlib, subprocess, sys, tempfile, unittest
from system_runtime_contract import libraries, verify

class SystemRuntime(unittest.TestCase):
    def test_reject_missing_and_private_maps(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'maps'
            for content in ['', '100-200 r-xp 0000 00:00 0 /tmp/private/libwebkit2gtk-4.1.so.0\n']:
                p.write_text(content)
                with self.assertRaises(AssertionError):libraries(p)
    def test_missing_native_evidence_never_passes(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);r=verify(root)
            self.assertEqual(r['status'],'failed');self.assertTrue(r['errors'])
    def test_system_entry_rejects_private_arguments_before_work(self):
        script=pathlib.Path(__file__).resolve().parents[2]/'scripts/ci/run-webkit-link-probe.py'
        with tempfile.TemporaryDirectory() as d:
            output=pathlib.Path(d)/'must-not-exist'
            result=subprocess.run([sys.executable,str(script),'baseline',str(output),'--system-acceptance','--prefix','/tmp/private'],capture_output=True,text=True,timeout=5)
            self.assertNotEqual(result.returncode,0);self.assertFalse(output.exists())

if __name__=='__main__':unittest.main()

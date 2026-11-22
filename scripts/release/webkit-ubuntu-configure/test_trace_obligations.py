import unittest,json,hashlib,tempfile,os
from pathlib import Path
from trace_obligations import classify
P=Path(__file__).resolve().parent;OLD=Path('/tmp/milkup-runtime-toolgate-20261122');SDK=OLD/'gettext-sdk';SRC=Path('/tmp/milkup-sdk-2543-20261122/webkitgtk-2.54.3');TRACE=Path(os.environ['MILKUP_CMAKE_TEST_TRACE'])
class TraceTests(unittest.TestCase):
 def fixture(self):
  module=SDK/'usr/share/cmake-4.2/Modules/FindGettext.cmake';rows=[json.loads(l) for l in TRACE.read_text().splitlines()];r=next(r for r in rows if r.get('file')==str(module) and r.get('cmd')=='find_program' and r['args'][0]=='GETTEXT_MSGFMT_EXECUTABLE')
  return {'items':[{'id':0,'file':'/usr/share/cmake-4.2/Modules/FindGettext.cmake','line':r['line'],'command':'find_program','sourceSha256':hashlib.sha256(module.read_bytes()).hexdigest()}]}
 def test_real_trace_records_exact_finder_invocation(self):
  r=classify(self.fixture(),TRACE,SRC,SDK,configure_succeeded=True);self.assertEqual(r['items'][0]['newUbuntuStatus'],'executed-in-actual-trace');self.assertTrue(r['items'][0]['actualExpandedArguments'])
 def test_incomplete_trace_never_promotes_absence(self):
  x=self.fixture();x['items'][0]['line']=99999;r=classify(x,TRACE,SRC,SDK,configure_succeeded=False);self.assertEqual(r['items'][0]['newUbuntuStatus'],'unresolved-in-incomplete-configure')
 def test_successful_but_not_executed_is_not_an_executed_pass(self):
  x=self.fixture();x['items'][0]['line']=99999;r=classify(x,TRACE,SRC,SDK,configure_succeeded=True);self.assertEqual(r['items'][0]['newUbuntuStatus'],'not-executed-in-this-successful-configure')
 def test_source_hash_change_rejected(self):
  x=self.fixture();x['items'][0]['sourceSha256']='0'*64
  with self.assertRaises(AssertionError):classify(x,TRACE,SRC,SDK,configure_succeeded=True)
 def test_truncation_and_missing_header_rejected(self):
  for content in ['{','{"cmd":"include","file":"/source/a","line":1,"args":[]}\n']:
   with tempfile.TemporaryDirectory() as t:
    f=Path(t)/'trace';f.write_text(content)
    with self.assertRaises((AssertionError,json.JSONDecodeError)):classify(self.fixture(),f,SRC,SDK,configure_succeeded=True)
 def test_all_original_48_retained(self):
  r=json.loads((P/'deferred-cmake-obligations.json').read_text());self.assertEqual(len(r['items']),48);self.assertEqual(len({x['id'] for x in r['items']}),48);self.assertTrue(all(x['newUbuntuStatus']=='not-executed-or-unproven' for x in r['items']))
if __name__=='__main__':unittest.main(verbosity=2)

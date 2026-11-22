import unittest,tempfile,json,hashlib,gc,warnings,os,importlib.util
from pathlib import Path
from unittest.mock import patch
path=Path(os.environ.get('MILKUP_CLASSIFIER_UNDER_TEST',str(Path(__file__).with_name('trace_obligations.py'))))
s=importlib.util.spec_from_file_location('tested_classifier',path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Handles(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.p=Path(self.t.name);self.src=self.p/'source';self.src.mkdir();self.sdk=self.p/'sdk';self.sdk.mkdir();self.f=self.src/'CMakeLists.txt';self.f.write_text('set(x y)\n');self.trace=self.p/'trace.jsonl';self.trace.write_text(json.dumps({'version':{'major':1,'minor':2}})+'\n'+json.dumps({'file':str(self.f),'line':1,'cmd':'set','args':['x','y']})+'\n');self.ob={'items':[{'file':'/source/CMakeLists.txt','line':1,'command':'set','sourceSha256':hashlib.sha256(self.f.read_bytes()).hexdigest()}]}
 def tearDown(self):self.t.cleanup()
 def checked(self,action,expected=None):
  with warnings.catch_warnings(record=True) as caught:
   warnings.simplefilter('always',ResourceWarning)
   if expected:
    with self.assertRaises(expected):action()
   else:action()
   gc.collect()
  self.assertEqual([str(x.message) for x in caught if issubclass(x.category,ResourceWarning)],[])
 def call(self):return m.classify(self.ob,self.trace,self.src,self.sdk,configure_succeeded=True)
 def test_success_closes_all_hash_streams(self):self.checked(self.call)
 def test_mismatched_source_closes_stream(self):
  self.f.write_text('different');self.checked(self.call,AssertionError)
 def test_failed_digest_closes_stream(self):
  with patch.object(m.hashlib,'file_digest',side_effect=OSError('controlled read failure')):self.checked(self.call,OSError)
 def test_malformed_trace_closes_reader(self):
  self.trace.write_text('{broken\n');self.checked(self.call,json.JSONDecodeError)
if __name__=='__main__':unittest.main(verbosity=2)

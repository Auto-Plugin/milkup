import unittest,importlib.util,io,tarfile,tempfile,datetime,json,hashlib,subprocess
from pathlib import Path
D=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('gate',D/'run.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Gate(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name);self.saved=m.room;m.room=lambda:None
 def tearDown(self):m.room=self.saved;self.tmp.cleanup()
 def archive(self,entries):
  b=io.BytesIO()
  with tarfile.open(fileobj=b,mode='w') as t:
   for name,value,kind in entries:
    x=tarfile.TarInfo(name)
    if kind=='file':x.size=len(value);t.addfile(x,io.BytesIO(value))
    elif kind=='setid':x.mode=0o4755;x.size=len(value);t.addfile(x,io.BytesIO(value))
    elif kind=='link':x.type=tarfile.SYMTYPE;x.linkname=value;t.addfile(x)
    else:x.type=tarfile.CHRTYPE;t.addfile(x)
  b.seek(0);return tarfile.open(fileobj=b,mode='r:')
 def test_exact_identical_duplicate_allowed(self):
  with self.archive([('a',b'ok','file'),('a',b'ok','file')]) as t:m.unpack(t,self.p,100)
  self.assertEqual((self.p/'a').read_bytes(),b'ok')
 def test_mismatch_duplicate_rejected(self):
  with self.archive([('a',b'ok','file'),('a',b'no','file')]) as t:self.assertRaises(AssertionError,m.unpack,t,self.p,100)
 def test_traversal_special_escape_rejected(self):
  for entry in [('../escape',b'x','file'),('/absolute',b'x','file'),('a','../../escape','link'),('device',b'','special')]:
   with self.archive([entry]) as t:self.assertRaises(AssertionError,m.unpack,t,self.p,100)
 def test_setid_never_recreated(self):
  with self.archive([('tool',b'abc','setid')]) as t:_,_,n=m.unpack(t,self.p,100)
  self.assertEqual(n,1);self.assertEqual((self.p/'tool').stat().st_mode&0o6000,0)
 def test_budget_rejected(self):
  with self.archive([('a',b'abc','file')]) as t:self.assertRaises(AssertionError,m.unpack,t,self.p,2)
 def test_write_through_symlink_rejected(self):
  with self.archive([('a','inside','link'),('a',b'abc','file')]) as t:self.assertRaises(AssertionError,m.unpack,t,self.p,100)
 def test_checksum_duplicate_and_path(self):
  a='0'*64+' 2 safe';self.assertRaises(AssertionError,m.table,a+'\n'+a)
  self.assertRaises(AssertionError,m.table,'0'*64+' 2 ../bad')
 def test_real_manifest_and_preserved_base(self):
  self.assertEqual(m.sha(D/'configure-packages.json'),m.PLAN);self.assertEqual(m.sha(D/'frozen-sdk-plan.json'),m.FROZEN)
  ps=json.loads((D/'configure-packages.json').read_text())['packages'];bs=json.loads((D/'frozen-sdk-plan.json').read_text())['packages'];self.assertEqual(len(ps),832)
  backtrace={x['package']:x for x in ps if x['package'] in ('libbacktrace-dev','libbacktrace0')}
  self.assertEqual(set(backtrace),{'libbacktrace-dev','libbacktrace0'})
  self.assertTrue(all(x['version']=='0.1-4build1' for x in backtrace.values()))
  for b in bs:self.assertTrue(any(all(x[k]==b[k] for k in ('package','version','sha256','bytes')) for x in ps))
  gettext={x['package']:x for x in ps if x['package'] in ('gettext','gettext-base')}
  self.assertEqual(set(gettext),{'gettext','gettext-base'})
  self.assertTrue(all(x['version']=='0.23.2-1' for x in gettext.values()))
  essential={x['package']:x['version'] for x in ps if x['package'] in ('dash','debianutils','coreutils')}
  self.assertEqual(essential,{'dash':'0.5.12-12ubuntu3','debianutils':'5.23.2build1','coreutils':'9.5-1ubuntu2+0.0.0~ubuntu25'})
 def test_future_and_expired_release(self):
  self.assertRaises(AssertionError,m.dates,{'Date':'Sun, 22 Nov 2099 02:09:05 UTC'})
  self.assertRaises(AssertionError,m.dates,{'Date':'Sun, 22 Nov 2020 02:09:05 UTC','Valid-Until':'Sun, 29 Nov 2020 02:09:05 UTC'})
 def test_generated_code_syntax(self):compile((D/'run.py').read_text(),str(D/'run.py'),'exec');compile((D/'check-inputs.py').read_text(),str(D/'check-inputs.py'),'exec')
if __name__=='__main__':unittest.main(verbosity=2)

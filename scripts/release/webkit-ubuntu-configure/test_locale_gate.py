import unittest,tempfile,copy,json,os
from pathlib import Path
from unittest.mock import Mock,patch
import locale_gate as m
class Locale(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.root=Path(self.t.name);self.expected={'/usr/lib/locale/C.utf8/LC_CTYPE':'a'*64}
  self.p={'uid':1001,'pid':123,'startTicks':'456','localeAvailable':True,'effectiveLocale':'C.UTF-8','localeFiles':self.expected.copy(),'localeMaps':self.expected.copy(),'perlExit':0,'perlStdout':'locale=C.UTF-8\n','perlStderr':''}
  self.n={'uid':1001,'pid':124,'startTicks':'457','localeAvailable':False,'effectiveLocale':'C','localeFiles':{},'localeMaps':{},'perlExit':7,'perlStdout':'locale=UNAVAILABLE\n','perlStderr':'perl: warning: Setting locale failed.\n'}
 def tearDown(self):self.t.cleanup()
 def test_synthetic_pair_only(self):self.assertTrue(m.verify_pair(self.p,self.n,self.expected)['localePairVerified'])
 def test_missing_and_mismatched_target_mapping(self):
  for maps in [{},{'/usr/lib/locale/C.utf8/LC_CTYPE':'b'*64},{'/host/LC_CTYPE':'a'*64}]:
   with self.subTest(maps=maps),self.assertRaises(m.Rejected):m.verify_pair(dict(self.p,localeMaps=maps),self.n,self.expected)
 def test_positive_warning_and_exit(self):
  for changes in [{'perlStderr':'warning'},{'perlExit':7},{'localeAvailable':False},{'localeFiles':{}}]:
   with self.subTest(changes=changes),self.assertRaises(m.Rejected):m.verify_pair(dict(self.p,**changes),self.n,self.expected)
 def test_negative_host_fallback(self):
  for changes in [{'localeAvailable':True},{'effectiveLocale':'C.UTF-8'},{'localeFiles':self.expected},{'localeMaps':self.expected},{'perlExit':0},{'perlStderr':''},{'perlStdout':'locale=C.UTF-8\n'}]:
   with self.subTest(changes=changes),self.assertRaises(m.Rejected):m.verify_pair(self.p,dict(self.n,**changes),self.expected)
 def test_identity_required(self):
  for changes in [{'uid':0},{'uid':True},{'pid':0},{'startTicks':'bad'}]:
   with self.subTest(changes=changes),self.assertRaises(m.Rejected):m.verify_pair(dict(self.p,**changes),self.n,self.expected)
 def ns(self):
  from isolated_configure import Namespace
  n=object.__new__(Namespace);n.execution=self.root;n.sdk=self.root/'sdk';n.source=self.root/'source';n.bwrap=Path('/usr/bin/bwrap');return n
 def test_negative_changes_only_readonly_locale_mount(self):
  n=self.ns();empty=self.root/'absent';empty.mkdir();args=['/usr/bin/python3','/work/locale-probe.py'];original=n.argv(args);new=m.negative_argv(n,args,empty);i=original.index('--');self.assertEqual(new,original[:i]+['--ro-bind',str(empty),'/usr/lib/locale']+original[i:]);self.assertIn('--unshare-net',new);self.assertNotIn('--ro-bind /usr /usr',' '.join(new))
 def test_reject_nonempty_symlink_and_outside_fixture(self):
  n=self.ns();empty=self.root/'absent';empty.mkdir();(empty/'x').write_text('x')
  with self.assertRaises(m.Rejected):m.negative_argv(n,[],empty)
  link=self.root/'link';link.symlink_to(empty)
  with self.assertRaises(m.Rejected):m.negative_argv(n,[],link)
  with tempfile.TemporaryDirectory() as other:
   with self.assertRaises(m.Rejected):m.negative_argv(n,[],Path(other))
 def test_embedded_script_syntax_and_perl_newline(self):
  import ast
  compile(m.SCRIPT,'locale-probe.py','exec');tree=ast.parse(m.SCRIPT);strings=[x.value for x in ast.walk(tree) if isinstance(x,ast.Constant) and isinstance(x.value,str)];perl=next(x for x in strings if x.startswith('my $x='));self.assertIn('"locale=$x\\n"',perl);self.assertNotIn('"locale=$x\\\\n"',perl)
 def test_failure_receipt_saved_before_rejection(self):
  n=self.ns();n.call=lambda *args:json.dumps(dict(self.p,perlExit=7));runner=Mock();runner.WORK=self.root;runner.run=lambda *args:json.dumps(self.n)
  with patch.object(m,'locale_files',return_value=self.expected),self.assertRaises(m.Rejected):m.run_locale_pair(runner,n,self.root,{})
  receipt=json.loads((self.root/'locale-pair.json').read_text());self.assertEqual(receipt['positive']['perlExit'],7);self.assertEqual(receipt['status'],'rejected')
if __name__=='__main__':unittest.main(verbosity=2)

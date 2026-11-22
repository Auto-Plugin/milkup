import unittest,tempfile,importlib.util,json,hashlib
from pathlib import Path
from isolated_configure import exact_resource_commands,Namespace,Rejected,map_receipt,inventory_tree,PROGRAMS
P=Path(__file__).resolve().parent
OLD=Path('/tmp/milkup-runtime-toolgate-20261122')
BASE=Path('/tmp/milkup-sdk-2543-20261122')
def real_commands():
 text=(OLD/'resource-commands-existing-debian.txt').read_text()
 return text.replace(str(BASE/'sdk'),'').replace(str(BASE/'webkitgtk-2.54.3'),'/source').replace(str(BASE/'build-clang'),'/work/build')
class Contracts(unittest.TestCase):
 def test_actual_four_command_graph(self):self.assertEqual(exact_resource_commands(real_commands())['commands'],4)
 def test_extra_command(self):
  with self.assertRaises(Rejected):exact_resource_commands(real_commands()+'echo unexpected\n')
 def test_changed_interpreter(self):
  with self.assertRaises(Rejected):exact_resource_commands(real_commands().replace('/usr/bin/perl','/host/usr/bin/perl'))
 def test_swapped_copy(self):
  rows=real_commands().splitlines();rows[0],rows[1]=rows[1],rows[0]
  with self.assertRaises(Rejected):exact_resource_commands('\n'.join(rows))
 def test_injected_shell(self):
  with self.assertRaises(Rejected):exact_resource_commands(real_commands().replace('--defines','; /usr/bin/true --defines'))
 def test_changed_output(self):
  with self.assertRaises(Rejected):exact_resource_commands(real_commands().replace('UserAgentStyleSheetsData.cpp','different.cpp'))
 def test_source_escape(self):
  with self.assertRaises(Rejected):exact_resource_commands(real_commands().replace('/controls/activity-indicator.css','/controls/../../escape.css'))
 def test_compile_cannot_enter_resource_graph(self):
  with self.assertRaises(Rejected):exact_resource_commands(real_commands().replace('/usr/bin/cmake -E cat','/usr/bin/clang -c'))
 def test_namespace_does_not_mount_host_usr_or_expose_sdk_via_work(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);sdk=p/'sdk';source=p/'source';execution=p/'execution'
   for x in [sdk,source,execution]:x.mkdir()
   # Pure argv contract only: this is NOT a namespace launch or admission.
   ns=Namespace.__new__(Namespace);ns.sdk=sdk;ns.source=source;ns.execution=execution;ns.bwrap=Path('/usr/bin/bwrap');args=ns.argv(['/usr/bin/python3','--version'])
   self.assertIn('--clearenv',args);self.assertIn('--unshare-net',args);self.assertNotIn('--share-net',args)
   mounts=[args[i+1:i+3] for i,x in enumerate(args) if x in ['--ro-bind','--bind']]
   self.assertEqual(mounts,[[str(sdk),'/'],[str(source),'/source'],[str(execution),'/work']])
   with self.assertRaises(Rejected):Namespace(None,sdk,source,p)
 def test_sdk_symlink_escape(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'escape').symlink_to('/usr/bin/python3')
   with self.assertRaises(Rejected):inventory_tree(p)
 def test_gettext_and_indirect_tools_required(self):
  self.assertTrue({'msgfmt','msgmerge','xgettext','gdbus-codegen','perl','python3','g-ir-scanner'}<=PROGRAMS.keys())
 def test_receipt_never_accepts_host_leak_or_wrong_abi(self):
  for r in [{'hostSentinelAbsent':False,'glibc':'2.43','uid':1000},{'hostSentinelAbsent':True,'glibc':'2.41','uid':1000},{'hostSentinelAbsent':True,'glibc':'2.43','uid':0}]:
   with self.assertRaises(Rejected):map_receipt(r,Path('/missing'),{})
 def test_changed_mapped_library_rejected_against_real_sdk(self):
  root=OLD/'gettext-sdk';inv=json.loads((OLD/'gettext-inventory.json').read_text())
  r={'hostSentinelAbsent':True,'glibc':'2.43','uid':1000,'maps':{'/usr/lib/x86_64-linux-gnu/libc.so.6':'0'*64},'perlModules':[],'executable':'/usr/bin/perl'}
  with self.assertRaises(Rejected):map_receipt(r,root,inv)
 def test_run_entry_keeps_limits_and_calls_isolation(self):
  s=(P/'run.py').read_text();self.assertIn('free>=24*1024**3',s);self.assertIn('free>=12*1024**3',s);self.assertIn('run_pipeline(sys.modules[__name__],sdk,source)',s)
  self.assertNotIn('CMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER',s)
if __name__=='__main__':unittest.main(verbosity=2)

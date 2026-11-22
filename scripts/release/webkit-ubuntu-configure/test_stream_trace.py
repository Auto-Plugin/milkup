import unittest,tempfile,json,sys,os,hashlib,subprocess
from pathlib import Path
from stream_trace import Trace,Rejected,run_traced,require_complete,digest
from isolated_configure import verify_generated_configure,admit_resource
D=Path(__file__).resolve().parent
class Contracts(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.p=Path(self.t.name);self.src=self.p/'source';self.src.mkdir();self.f=self.src/'CMakeLists.txt';self.f.write_text('set(x 1)\n');self.ob={'items':[{'id':0,'file':'/source/CMakeLists.txt','line':1,'command':'set','sourceSha256':digest(self.f)},{'id':1,'file':'/source/CMakeLists.txt','line':2,'command':'find_package','sourceSha256':digest(self.f)}]};self.mounts={'/source':self.src};self.header=b'{"version":{"major":1,"minor":2}}\n';self.event={'file':'/source/CMakeLists.txt','line':1,'cmd':'set','args':['x','1']}
 def tearDown(self):self.t.cleanup()
 def data(self,event=None):return self.header+json.dumps(event or self.event).encode()+b'\n'
 def trace(self):return Trace(self.ob,self.mounts)
 def complete(self,t):return t.finish(exit_code=0,eof=True,process_exited=True)
 def test_all_48_exact_required_sources_validate(self):
  ledger=json.loads((D/'deferred-cmake-obligations.json').read_text());t=Trace(ledger,{'/source':Path('/tmp/milkup-sdk-2543-20261122/webkitgtk-2.54.3'),'/usr':Path('/tmp/milkup-runtime-toolgate-20261122/gettext-sdk/usr')});self.assertEqual(len(t.rows),48)
 def test_fragmented_input_all_events_and_hash(self):
  data=self.data();t=self.trace()
  for b in data:t.feed(bytes([b]))
  r=self.complete(t);require_complete(r);self.assertEqual(r['rawSha256'],hashlib.sha256(data).hexdigest());self.assertEqual(r['items'][0]['status'],'observed');self.assertEqual(r['items'][1]['status'],'not-executed-in-complete-trace')
 def test_unknown_commands_counted_not_filtered(self):
  t=self.trace();t.feed(self.data(dict(self.event,cmd='previously_unknown_function')));r=self.complete(t);self.assertEqual(r['unmatchedEvents'],1);self.assertEqual(r['commandGroups'][0]['command'],'previously_unknown_function')
 def test_truncated_and_bad_json(self):
  t=self.trace();t.feed(self.data()[:-1]);r=self.complete(t);self.assertFalse(r['complete']);self.assertEqual(r['items'][1]['status'],'unresolved')
  for data in [b'{bad}\n',self.header+b'[]\n',self.header+b'{"file":"x","file":"y"}\n',self.header+b'{"time":NaN}\n']:
   with self.assertRaises((Rejected,json.JSONDecodeError)):self.trace().feed(data)
 def test_unknown_event_fields_rejected(self):
  with self.assertRaises(Rejected):self.trace().feed(self.data(dict(self.event,unrecognized=1)))
 def test_unlisted_dependency_arguments_are_preserved(self):
  t=self.trace();t.feed(self.data(dict(self.event,cmd='find_package',args=['UnexpectedDependency','REQUIRED'])));r=self.complete(t);g=r['commandGroups'][0];self.assertTrue(g['dependency']);self.assertEqual(g['argumentVariants'][0]['args'],['UnexpectedDependency','REQUIRED']);self.assertEqual(r['unmatchedEvents'],1)
 def test_missing_header(self):
  with self.assertRaises(Rejected):self.trace().feed(json.dumps(self.event).encode()+b'\n')
 def test_invalid_source_paths(self):
  for path in ['/etc/passwd','/source/../outside','/source/./CMakeLists.txt','/source/missing']:
   with self.assertRaises(Rejected):self.trace().feed(self.data(dict(self.event,file=path)))
  (self.src/'escape').symlink_to('/etc/passwd')
  with self.assertRaises(Rejected):self.trace().feed(self.data(dict(self.event,file='/source/escape')))
 def test_source_and_obligation_change(self):
  t=self.trace();t.feed(self.data());self.f.write_text('changed');self.assertFalse(self.complete(t)['complete'])
  with self.assertRaises(Rejected):self.trace()
 def test_absence_not_passed_for_failure_or_missing_exit_eof(self):
  for kw in [dict(exit_code=1,eof=True,process_exited=True),dict(exit_code=0,eof=False,process_exited=True),dict(exit_code=0,eof=True,process_exited=False),dict(exit_code=0,eof=True,process_exited=True,stopped='interrupted')]:
   t=self.trace();t.feed(self.data());r=t.finish(**kw);self.assertFalse(r['complete']);self.assertEqual(r['items'][1]['status'],'unresolved')
 def test_all_bounds_fail_not_truncate(self):
  for name,n,event in [('MAX_STREAM',1,self.event),('MAX_LINE',2,self.event),('MAX_EVENTS',0,self.event),('MAX_FILES',0,self.event),('MAX_GROUPS',0,self.event),('MAX_EVIDENCE',1,self.event),('MAX_METADATA',1,self.event),('MAX_VARIANTS',0,self.event)]:
   t=self.trace();setattr(t,name,n)
   with self.assertRaises(Rejected,msg=name):t.feed(self.data(event))
 def writer(self,body,timeout=2,drain=.15):
  fifo=self.p/'trace';script=self.p/'writer.py';script.write_text('import os,time,sys\np=sys.argv[1]\n'+body)
  return run_traced([sys.executable,str(script),str(fifo)],fifo=fifo,log=self.p/'writer.log',obligations=self.ob,mounts=self.mounts,env={'PATH':'/usr/bin:/bin'},cwd=self.p,timeout=timeout,room=lambda:None,drain_seconds=drain)
 def test_rejected_record_still_returns_failed_receipt(self):
  t=self.trace();t.MAX_EVENTS=0
  with self.assertRaises(Rejected):t.feed(self.data())
  r=t.finish(exit_code=-15,eof=False,process_exited=True,stopped='Event processing budget');self.assertFalse(r['complete']);self.assertTrue(r['errors'])
 def test_live_partial_writer(self):
  r=self.writer('f=open(p,"wb");f.write('+repr(self.data()[:-1])+');f.close()\n');self.assertFalse(r['complete']);self.assertTrue(any('truncated' in x for x in r['errors']))
 def test_live_configuration_failure(self):
  r=self.writer('f=open(p,"wb");f.write('+repr(self.data())+');f.close();sys.exit(2)\n');self.assertEqual(r['exitCode'],2);self.assertFalse(r['complete'])
 def test_live_held_pipe_after_parent_exit(self):
  r=self.writer('f=open(p,"wb");f.write('+repr(self.data())+');f.flush()\nif os.fork()==0:\n time.sleep(5);os._exit(0)\nos._exit(0)\n');self.assertFalse(r['complete']);self.assertTrue(any('without proven trace EOF' in x for x in r['errors']))
 def test_live_process_hangs_after_eof(self):
  r=self.writer('f=open(p,"wb");f.write('+repr(self.data())+');f.close();time.sleep(5)\n',timeout=.2);self.assertFalse(r['complete']);self.assertTrue(any('deadline' in x for x in r['errors']))
 def test_live_signal_and_no_writer(self):
  r=self.writer('os.kill(os.getpid(),9)\n');self.assertEqual(r['exitCode'],-9);self.assertFalse(r['complete'])
 def test_program_success_does_not_replace_configuration_or_four_target_evidence(self):
  t=self.trace();t.feed(self.data());r=self.complete(t);require_complete(r);build=self.p/'build';build.mkdir();log=self.p/'log';log.write_text('')
  with self.assertRaises(FileNotFoundError):verify_generated_configure(r,build,log)
  (build/'CMakeCache.txt').write_text('DEVELOPER_MODE:BOOL=OFF\nUSE_GTK4:BOOL=OFF\n');(build/'cmakeconfig.h').write_text('#define USE_GTK4 0\n#define ENABLE_BUBBLEWRAP_SANDBOX 1\n#define HAVE_GTK_UNIX_PRINTING 1\n#define WEBKITGTK_API_VERSION "4.1"\n#define ENABLE_DEVELOPER_MODE 0\n');(build/'build.ninja').write_text('fixture graph');(build/'compile_commands.json').write_text('[{"file":"fixture.cpp"}]')
  cert=verify_generated_configure(r,build,log)
  original=(build/'cmakeconfig.h').read_text();(build/'cmakeconfig.h').write_text(original+'#define ENABLE_BUBBLEWRAP_SANDBOX 0\n')
  with self.assertRaises(Exception):verify_generated_configure(r,build,log)
  (build/'cmakeconfig.h').write_text(original);log.write_text('Manually-specified variables were not used')
  with self.assertRaises(Exception):verify_generated_configure(r,build,log)
  log.write_text('');original_db=(build/'compile_commands.json').read_text();(build/'compile_commands.json').write_text('[]')
  with self.assertRaises(Exception):verify_generated_configure(r,build,log)
  (build/'compile_commands.json').write_text(original_db)
  # Joint gate uses original exact four-command real graph, not fixture graph as native proof.
  old=Path('/tmp/milkup-runtime-toolgate-20261122/resource-commands-existing-debian.txt').read_text();base='/tmp/milkup-sdk-2543-20261122';commands=old.replace(base+'/sdk','').replace(base+'/webkitgtk-2.54.3','/source').replace(base+'/build-clang','/work/build')
  self.assertEqual(admit_resource(r,cert,build,commands)['commands'],4)
  for altered in [dict(r,complete=False),dict(r,eof=False),dict(r,exitCode=1)]:
   with self.assertRaises(Rejected):admit_resource(altered,cert,build,commands)
  with self.assertRaises(Exception):admit_resource(r,cert,build,commands+'echo extra\n')
  (build/'build.ninja').write_text('changed')
  with self.assertRaises(Exception):admit_resource(r,cert,build,commands)
 def test_wrong_generated_features_and_unused_options(self):
  t=self.trace();t.feed(self.data());r=self.complete(t);build=self.p/'build';build.mkdir();(build/'CMakeCache.txt').write_text('DEVELOPER_MODE:BOOL=OFF\nUSE_GTK4:BOOL=OFF\n');(build/'cmakeconfig.h').write_text('#define ENABLE_BUBBLEWRAP_SANDBOX 0\n');log=self.p/'log';log.write_text('')
  with self.assertRaises(Exception):verify_generated_configure(r,build,log)
if __name__=='__main__':unittest.main(verbosity=2)

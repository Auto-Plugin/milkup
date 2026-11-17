import copy,hashlib,importlib.util,io,json,os,pathlib,subprocess,tarfile,tempfile,unittest
from unittest import mock
import probe as m
P=pathlib.Path
class Contracts(unittest.TestCase):
 def complete(self):
  l=m.lock();d=m.initial();r={'jsSha256':l['referenceJs']['sha256'],'wasmSha256':l['referenceWasm']['sha256'],'compilerIdentitySha256':'a'*64,'traceSha256':'b'*64,'elapsedMs':1,'abi':'passed'}
  d.update(status='matched-reference',phase='complete',errorCode='none',abiDisposition='passed',runs=[r.copy(),r.copy()],lockSha256=m.LOCK_SHA,imageManifestSha256=l['imageManifest'][7:],imageConfigSha256=l['imageConfig'][7:],sourceCount=18,repeatIdentical=True,baselineJsEqual=True,baselineWasmEqual=True,elapsedMs=2,workflowCommit='c'*40);return d
 def test_complete_reference(self):m.validate(self.complete())
 def test_different_is_explicit_research_only(self):
  d=self.complete();d['status']='reproducible-different';d['baselineJsEqual']=False
  for r in d['runs']:r['jsSha256']='d'*64
  m.validate(d);self.assertTrue(all(d[k]is False for k in m.FLAGS))
 def test_extra_raw_fields_rejected(self):
  for field in ['log','error','source','path','secret','auditReport']:
   d=self.complete();d[field]='not public'
   with self.subTest(field=field),self.assertRaises(ValueError):m.validate(d)
 def test_nested_extra_field_rejected(self):
  d=self.complete();d['runs'][0]['log']='private'
  with self.assertRaises(ValueError):m.validate(d)
 def test_all_elevated_claims_rejected(self):
  for k in m.FLAGS:
   d=self.complete();d[k]=True
   with self.subTest(k=k),self.assertRaises(ValueError):m.validate(d)
 def test_completion_cannot_hide_mismatch(self):
  for field,val in [('repeatIdentical',False),('baselineWasmEqual',False),('sourceCount',17),('abiDisposition','not-run'),('imageConfigSha256','d'*64),('lockSha256','e'*64)]:
   d=self.complete();d[field]=val
   with self.subTest(field=field),self.assertRaises(ValueError):m.validate(d)
 def test_compiler_or_repeat_change_rejected(self):
  for field in ['compilerIdentitySha256','wasmSha256','jsSha256']:
   d=self.complete();d['runs'][1][field]='e'*64
   with self.subTest(field=field),self.assertRaises(ValueError):m.validate(d)
 def test_bounds_and_types(self):
  for field,val in [('elapsedMs',True),('elapsedMs',1800001),('workflowCommit','branch/name')]:
   d=self.complete();d[field]=val
   with self.subTest(field=field),self.assertRaises(ValueError):m.validate(d)
 def test_publish_fails_closed_no_private_fields(self):
  with tempfile.TemporaryDirectory()as t:
   p=P(t);(p/'private').mkdir();m.write(p/'private/state.json',{'log':'private'})
   d=m.publish(p/'private',p/'public');self.assertEqual(d['status'],'incomplete');self.assertNotIn('private',(p/'public/status.json').read_text())
 def test_public_extra_file_rejected(self):
  with tempfile.TemporaryDirectory()as t:
   p=P(t);(p/'private').mkdir();(p/'public').mkdir();(p/'public/log').write_text('raw')
   with self.assertRaises(ValueError):m.publish(p/'private',p/'public')
 def test_public_link_rejected(self):
  with tempfile.TemporaryDirectory()as t:
   p=P(t);(p/'private').mkdir();(p/'public').mkdir();(p/'raw').write_text('{}');(p/'public/status.json').symlink_to(p/'raw')
   with self.assertRaises(ValueError):m.publish(p/'private',p/'public')
 def test_public_hardlink_rejected(self):
  with tempfile.TemporaryDirectory()as t:
   p=P(t);(p/'private').mkdir();(p/'public').mkdir();(p/'raw').write_text('{}');os.link(p/'raw',p/'public/status.json')
   with self.assertRaises(ValueError):m.publish(p/'private',p/'public')
 def test_optimized_python_still_rejects_claim(self):
  code='import probe; d=probe.initial(); d["publicationReady"]=True; probe.validate(d)'
  r=subprocess.run(['python3','-O','-c',code],cwd=m.HERE,capture_output=True);self.assertNotEqual(r.returncode,0)
 def test_lock_matches_reviewed_hash(self):
  self.assertEqual(m.sha(m.HERE/'inputs.lock.json'),m.LOCK_SHA);self.assertEqual(len(m.lock()['sources']),18)
 def test_actual_image_identity(self):
  l=m.lock();d=[{'Id':l['imageConfig'],'Architecture':'amd64','Os':'linux','RepoDigests':['emscripten/emsdk@'+l['imageManifest']]}];m.inspect_image(d)
  for k,v in [('Id','sha256:'+'f'*64),('Architecture','arm64'),('RepoDigests',[])]:
   bad=copy.deepcopy(d);bad[0][k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):m.inspect_image(bad)
 def test_container_boundary_and_image_position(self):
  args=m.docker_args('/tmp/src','/tmp/out','fixed-name')
  for x in ['--pull=never','--network=none','--cpus=1','--memory=2g','--pids-limit=256','--read-only','--cap-drop=ALL','--platform=linux/amd64']:self.assertIn(x,args)
  self.assertEqual(args[-3],'emscripten/emsdk@'+m.lock()['imageManifest']);self.assertIn('/tmp/src:/src:ro',args);self.assertNotIn('--privileged',args)
  args[-3:-3]=['-e','EMCC_CFLAGS=-Wl,-Map=/out/link.map -Wl,--trace'];self.assertEqual(args[-3],'emscripten/emsdk@'+m.lock()['imageManifest'])
 def test_synthetic_build_control_flow_not_a_compiler_proof(self):
  calls=[]
  with tempfile.TemporaryDirectory()as t:
   root=P(t)
   def fake(args,**kw):
    calls.append(args)
    if args[:2]==['docker','run']:
     mounts=[args[i+1]for i,v in enumerate(args)if v=='-v'];out=P(next(x[:-8]for x in mounts if x.endswith(':/out:rw')))
     (out/'quickjs-eval.js').write_bytes(b'fixture-js');(out/'quickjs-eval.wasm').write_bytes(b'fixture-wasm')
     m.write(out/'compiler-identity.json',{'versions':{'emcc':'emcc 6.0.0 fixture'},'files':{str(i):'a'*64 for i in range(5)}})
     (out/'trace').mkdir();(out/'trace/input').write_bytes(b'fixture trace');(out/'link.map').write_bytes(b'fixture map')
    elif args[0]=='node':kw['stdout'].write(b'{"standaloneAbiPassed":true,"nativePdfTested":false}')
    return subprocess.CompletedProcess(args,0)
   with mock.patch.object(m.subprocess,'run',side_effect=fake),mock.patch.object(m.subprocess,'check_output',return_value=''):
    a=m.build(root/'src',root/'one',1);b=m.build(root/'src',root/'two',2)
   self.assertEqual(a['jsSha256'],b['jsSha256']);self.assertEqual(a['compilerIdentitySha256'],b['compilerIdentitySha256'])
   build=[x for x in calls if x[:2]==['docker','run']]
   self.assertIn('EMCC_CFLAGS=-Wl,-Map=/out/link.map -Wl,--trace',build[0]);self.assertFalse(any(x.startswith('EMCC_CFLAGS=')for x in build[1]))
   self.assertEqual(len([x for x in calls if x[:3]==['docker','rm','-f']]),2)
 def test_timed_out_container_cleanup(self):
  calls=[]
  def fake(args,**kw):
   calls.append(args)
   if args[:2]==['docker','run']:raise subprocess.TimeoutExpired(args,600)
   return subprocess.CompletedProcess(args,0)
  with tempfile.TemporaryDirectory()as t,mock.patch.object(m.subprocess,'run',side_effect=fake),mock.patch.object(m.subprocess,'check_output',return_value=''):
   with self.assertRaises(subprocess.TimeoutExpired):m.build(P(t)/'src',P(t)/'out',1)
  self.assertEqual(calls[-1][:3],['docker','rm','-f'])
 def test_signal_unwinds_owned_container(self):
  calls=[]
  def fake(args,**kw):
   calls.append(args)
   if args[:2]==['docker','run']:m.interrupt(15,None)
   return subprocess.CompletedProcess(args,0)
  with tempfile.TemporaryDirectory()as t,mock.patch.object(m.subprocess,'run',side_effect=fake),mock.patch.object(m.subprocess,'check_output',return_value=''):
   with self.assertRaises(m.ProbeInterrupted):m.build(P(t)/'src',P(t)/'out',1)
  self.assertEqual(calls[-1][:3],['docker','rm','-f'])
 def test_cleanup_exact_label_no_global_prune(self):
  with mock.patch.dict(os.environ,{'GITHUB_RUN_ID':'1234','GITHUB_RUN_ATTEMPT':'2'}),mock.patch.object(m.subprocess,'check_output',side_effect=['a'*12+'\n',''])as read,mock.patch.object(m.subprocess,'run')as run:
   m.cleanup_owned();self.assertEqual(read.call_args_list[0].args[0][-1],'label=io.milkup.quickjs-research=1234-2');self.assertEqual(run.call_args.args[0],['docker','rm','-f','a'*12])
 def test_cleanup_requires_absence(self):
  with mock.patch.object(m.subprocess,'check_output',return_value='a'*12),mock.patch.object(m.subprocess,'run'):
   with self.assertRaises(ValueError):m.cleanup_owned()
 def test_changed_download_rejected(self):
  with tempfile.TemporaryDirectory()as t,mock.patch.object(m,'get',return_value=b'changed'):
   with self.assertRaises(ValueError):m.fetch(m.lock()['generator'],P(t)/'x')
   self.assertFalse((P(t)/'x').exists())
 def test_archive_traversal_symlink_and_duplicate(self):
  for kind in ['traversal','symlink','duplicate']:
   with tempfile.TemporaryDirectory()as t:
    p=P(t)
    with tarfile.open(p/'a.tar','w')as tar:
     info=tarfile.TarInfo('root/../escape'if kind=='traversal'else'root/file');info.size=1
     if kind=='symlink':info.type=tarfile.SYMTYPE;info.linkname='/etc/passwd';info.size=0
     tar.addfile(info,io.BytesIO(b'x'))
     if kind=='duplicate':tar.addfile(info,io.BytesIO(b'x'))
    with self.subTest(kind=kind),self.assertRaises((ValueError,FileExistsError)):m.unpack(p/'a.tar',p/'out')
 def test_container_shell_syntax(self):subprocess.run(['sh','-n',str(m.HERE/'container-build.sh')],check=True)
 def test_js_syntax(self):subprocess.run(['node','--check',str(m.HERE/'abi-smoke.mjs')],check=True,capture_output=True)
 def test_exact_file_scope(self):
  names={p.name for p in m.HERE.iterdir()if p.is_file()};self.assertEqual(names,{'probe.py','inputs.lock.json','abi-smoke.mjs','container-build.sh','test_probe.py','README.md'})
 def test_workflow_branch_and_artifact_scope(self):
  f=m.HERE.parents[1]/'.github/workflows/quickjs-repro-research.yml';s=f.read_text()
  self.assertIn('branches: [dot/quickjs-repro-trial-20261117]',s);self.assertIn("github.ref == 'refs/heads/dot/quickjs-repro-trial-20261117'",s)
  self.assertNotIn('secrets.',s);self.assertNotIn('workflow_dispatch:',s);self.assertNotIn('pull_request:',s)
  self.assertEqual(s.count('uses: actions/upload-artifact@'),1);self.assertIn('path: ${{ runner.temp }}/quickjs-public/status.json',s)
  for line in s.splitlines():
   if 'uses:'in line:self.assertRegex(line,r'@[0-9a-f]{40}$')
 def test_local_real_source_fixture_when_available(self):
  fixture=os.environ.get('QUICKJS_LOCAL_FIXTURE')
  if not fixture:self.skipTest('optional offline official archives not stored in repository')
  with tempfile.TemporaryDirectory()as t:
   src=m.prepare(t,fixture);self.assertEqual(len([p for p in src.rglob('*')if p.is_file()]),19)
   self.assertEqual(m.sha(src/'generator/compile.sh'),m.lock()['compileSha256'])
 def test_local_reference_oracle_when_available(self):
  fixture=os.environ.get('QUICKJS_LOCAL_FIXTURE')
  if not fixture:self.skipTest('optional offline reference not stored in repository')
  r=subprocess.run(['node','--max-old-space-size=128',str(m.HERE/'abi-smoke.mjs'),str(P(fixture)/'reference-quickjs-eval.mjs'),str(P(fixture)/'reference-quickjs-eval.wasm')],check=True,capture_output=True,timeout=10)
  d=json.loads(r.stdout);self.assertTrue(d['standaloneAbiPassed']);self.assertFalse(d['nativePdfTested'])
if __name__=='__main__':unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Real compiler/cache format gate using only temporary synthetic C input."""
import importlib.util,json,os,pathlib,shutil,subprocess,sys,tempfile,time
here=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('transfer',here/'webkit-pagination-cache.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
report={'status':'running','scope':'Synthetic C cache transfer, not WebKit or PDF acceptance','samples':[]}
def stats(env):
 return {k:int(v)for k,v in (l.split()for l in subprocess.check_output(['ccache','--print-stats'],env=env,text=True,timeout=10).splitlines())}
def hits(s):return s['direct_cache_hit']+s['preprocessed_cache_hit']
try:
 with tempfile.TemporaryDirectory(prefix='milkup-cache-live-')as directory:
  root=pathlib.Path(directory);cache=root/'cache';restored=root/'restored';bundle=root/'bundle'
  compiler=pathlib.Path(shutil.which('cc')).resolve()
  source=root/'sample.c';header=root/'value.h';out=root/'sample.o'
  source.write_text('#include "value.h"\n#ifndef EXTRA\n#define EXTRA 0\n#endif\nint sample(void) { return VALUE + EXTRA; }\n');header.write_text('#define VALUE 42\n')
  env={**os.environ,'CCACHE_DIR':str(cache),'CCACHE_COMPILERCHECK':'content','CCACHE_BASEDIR':''}
  # Keep ordinary ccache race checks; do not set sloppiness to make tests pass.
  time.sleep(1.1)
  command=['ccache',str(compiler),'-MD','-MF',str(root/'sample.d'),'-c',str(source),'-o',str(out)]
  first=stats(env);subprocess.run(command,cwd=root,env=env,check=True,timeout=30);after=stats(env)
  assert after['cache_miss']-first['cache_miss']==1
  object_sha=m.digest(out)
  identity={k:m.canonical(k)for k in m.objects.IDENTITY_FIELDS}
  identity.update(compiler=m.digest(compiler),configureArgs=m.canonical(command),observationPatch=m.digest(header))
  snapshot=m.capture(cache,bundle,identity,budget=60);m.restore(bundle,restored,identity)
  env['CCACHE_DIR']=str(restored);out.unlink()
  before=stats(env);subprocess.run(command,cwd=root,env=env,check=True,timeout=30);after=stats(env)
  row={'case':'restored-first-invocation','hits':hits(after)-hits(before),'misses':after['cache_miss']-before['cache_miss'],'sameObject':m.digest(out)==object_sha}
  report['samples'].append(row);assert row=={'case':'restored-first-invocation','hits':1,'misses':0,'sameObject':True}
  # Exercise the exact extended schema that previously failed only after the
  # expensive WebKit build. Same real ccache inspector and fresh-process hit.
  behavior={**identity,'behaviorInputs':m.canonical({'patch':m.digest(header),'sources':m.digest(source)})}
  behavior_bundle=root/'behavior-bundle';behavior_restored=root/'behavior-restored'
  m.capture(restored,behavior_bundle,behavior,budget=60)
  m.restore(behavior_bundle,behavior_restored,behavior)
  env['CCACHE_DIR']=str(behavior_restored);out.unlink()
  before=stats(env);subprocess.run(command,cwd=root,env=env,check=True,timeout=30);after=stats(env)
  row={'case':'behavior-restored-first-invocation','hits':hits(after)-hits(before),'misses':after['cache_miss']-before['cache_miss'],'sameObject':m.digest(out)==object_sha}
  report['samples'].append(row);assert row=={'case':'behavior-restored-first-invocation','hits':1,'misses':0,'sameObject':True}
  # The actual dependency/flags path must still invalidate normally.
  header.write_text('#define VALUE 43\n');time.sleep(1.1)
  for name,args in [('changed-header',command),('changed-flags',command+['-DEXTRA=1'])]:
   out.unlink();before=stats(env);subprocess.run(args,cwd=root,env=env,check=True,timeout=30);after=stats(env)
   row={'case':name,'hits':hits(after)-hits(before),'misses':after['cache_miss']-before['cache_miss']};report['samples'].append(row)
   assert row['hits']==0 and row['misses']==1
  report.update(status='passed',cacheVersion=subprocess.check_output(['ccache','--version'],text=True).splitlines()[0],compilerSha256=m.digest(compiler),archiveEntryBytes=snapshot['bytes'],entryCount=len(snapshot['entries']))
except Exception as error:report.update(status='failed',error=repr(error))
finally:
 pathlib.Path(sys.argv[1]).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed'else 1)

#!/usr/bin/env python3
"""Bounded real cache reuse probe: two previously completed object targets.

No weakening of ccache content checks. Use exact compile_commands entries rather
than Ninja dry-run (CONFIGURE_DEPENDS hides its plan behind a CMake rerun).
Require a cache hit on each first invocation, not on a warmed repeat.
"""
import argparse, json, os, pathlib, shlex, signal, subprocess, time
p=argparse.ArgumentParser();p.add_argument('--build',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
a.output.mkdir(exist_ok=False,parents=True)
report={'status':'running','scope':'Two first-invocation cached objects, not all objects or runtime acceptance','samples':[]}
def persist():(a.output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
def stats():
 raw=subprocess.check_output(['ccache','--print-stats'],text=True,timeout=10)
 return {k:int(v)for k,v in (l.split()for l in raw.splitlines()if l.strip())}
def hits(s):return s['direct_cache_hit']+s['preprocessed_cache_hit']
targets=['Source/bmalloc/CMakeFiles/bmalloc.dir/bmalloc/Allocator.cpp.o',
 'Source/bmalloc/CMakeFiles/bmalloc.dir/bmalloc/Cache.cpp.o']
commands=json.loads((a.build/'compile_commands.json').read_text())
try:
 for i,target in enumerate(targets):
  matches=[]
  for entry in commands:
   args=entry.get('arguments') or shlex.split(entry['command'])
   if '-o' in args and args[args.index('-o')+1]==target: matches.append((entry,args))
  assert len(matches)==1, 'Exactly one configured compiler command required'
  entry,args=matches[0]
  assert pathlib.Path(entry['directory']).resolve()==a.build.resolve()
  assert pathlib.Path(args[0]).name=='clang++' and args.count('-c')==1 and args.count('-o')==1
  assert pathlib.Path(args[args.index('-c')+1]).resolve()==pathlib.Path(entry['file']).resolve()
  assert pathlib.Path(entry['file']).name==pathlib.Path(target).name.removesuffix('.o')
  output=(a.build/target).resolve();assert output.is_relative_to(a.build.resolve()) and not output.exists()
  output.parent.mkdir(parents=True,exist_ok=True)
  (a.output/f'{i}-command.json').write_text(json.dumps({'directory':entry['directory'],'arguments':['ccache',*args]},indent=2)+'\n')
  before=stats();started=time.monotonic()
  with (a.output/f'{i}-compile.log').open('w')as log:
   proc=subprocess.Popen(['ccache',*args],cwd=a.build,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:code=proc.wait(timeout=180)
   except subprocess.TimeoutExpired:
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    raise RuntimeError('Bounded object cache probe timed out; no full build authorized')
  after=stats();sample={'target':target,'plannedCompiles':1,'seconds':round(time.monotonic()-started,3),
    'exitCode':code,'hitsBefore':hits(before),'hitsAfter':hits(after),'hitDelta':hits(after)-hits(before),
    'missDelta':after['cache_miss']-before['cache_miss']}
  report['samples'].append(sample);persist()
  assert code==0 and sample['hitDelta']>=1, 'Restored cache did not prove reuse on first object invocation'
 report['status']='passed'
except Exception as e:report['status']='failed';report['error']=str(e);raise
finally:persist()
print(json.dumps(report))

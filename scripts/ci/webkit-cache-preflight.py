#!/usr/bin/env python3
"""Bounded real cache reuse probe: two previously completed object targets.

No weakening of ccache content checks. Refuse a graph that pulls in a large
compile/link, and require a cache hit on each first invocation, not on a repeat.
"""
import argparse, json, os, pathlib, signal, subprocess, time
p=argparse.ArgumentParser();p.add_argument('--build',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
a.output.mkdir(exist_ok=False,parents=True)
report={'status':'running','scope':'Two first-invocation cached objects, not all objects or runtime acceptance','samples':[]}
def persist():(a.output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
def stats():
 raw=subprocess.check_output(['ccache','--print-stats'],text=True,timeout=10)
 return {k:int(v)for k,v in (l.split()for l in raw.splitlines()if l.strip())}
def hits(s):return s['direct_cache_hit']+s['preprocessed_cache_hit']
targets=['Source/bmalloc/CMakeFiles/bmalloc.dir/bmalloc/Allocator.cpp.o',
 'Source/WebCore/CMakeFiles/WebCore.dir/platform/image-decoders/skia/ImageBackingStoreSkia.cpp.o']
try:
 for i,target in enumerate(targets):
  plan=subprocess.run(['ninja','-C',str(a.build),'-n',target],capture_output=True,text=True,timeout=30)
  (a.output/f'{i}-plan.log').write_text(plan.stdout+plan.stderr)
  assert plan.returncode==0, 'Cannot inspect exact object target'
  compiles=sum('Building C' in l for l in plan.stdout.splitlines())
  assert 1<=compiles<=8 and 'Linking ' not in plan.stdout, 'Object probe unexpectedly pulls in expensive engine work'
  before=stats();started=time.monotonic()
  with (a.output/f'{i}-compile.log').open('w')as log:
   proc=subprocess.Popen(['ninja','-C',str(a.build),'-j2',target],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:code=proc.wait(timeout=180)
   except subprocess.TimeoutExpired:
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    raise RuntimeError('Bounded object cache probe timed out; no full build authorized')
  after=stats();sample={'target':target,'plannedCompiles':compiles,'seconds':round(time.monotonic()-started,3),
    'exitCode':code,'hitsBefore':hits(before),'hitsAfter':hits(after),'hitDelta':hits(after)-hits(before),
    'missDelta':after['cache_miss']-before['cache_miss']}
  report['samples'].append(sample);persist()
  assert code==0 and sample['hitDelta']>=1, 'Restored cache did not prove reuse on first object invocation'
 report['status']='passed'
except Exception as e:report['status']='failed';report['error']=str(e);raise
finally:persist()
print(json.dumps(report))

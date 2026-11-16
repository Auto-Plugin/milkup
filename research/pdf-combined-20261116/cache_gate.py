"""Require first restored-cache hits on the actual, historical graphics inputs.

The preceding exact-TU gate disables ccache, so it cannot warm these entries.
No cache-format, compiler dependency, flags or source validation is bypassed.
"""
import json,os,pathlib,signal,subprocess,time
SOURCES=['Source/WebCore/platform/graphics/FontCascade.cpp','Source/WebCore/platform/graphics/skia/GraphicsContextSkia.cpp']
def stats():return {k:int(v)for k,v in (x.split()for x in subprocess.check_output(['ccache','--print-stats'],text=True,timeout=10).splitlines())}
def hits(x):return x['direct_cache_hit']+x['preprocessed_cache_hit']
def run(m,source,build,out,gate):
 out.mkdir(exist_ok=False);report={'status':'running','samples':[],'scope':'Two historical graphics TU first hits after uncached actual compilation; not whole-build proof'}
 def save():(out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
 try:
  targets=set()
  for rel in SOURCES:
   entry=gate['selectedUnits'][rel]
   import shlex
   args=entry.get('arguments')or shlex.split(entry['command']);target=args[args.index('-o')+1]
   assert target not in targets;targets.add(target)
   graph=subprocess.check_output(['ninja','-C',str(build),'-t','commands',target],text=True,timeout=30)
   assert len(graph.encode())<32*1024*1024
   target,command=m.original_command(entry,graph,build)
   name=pathlib.Path(rel).stem
   (out/(name+'-command.json')).write_text(json.dumps({'source':rel,'sourceSha256':m.digest(source/rel),'arguments':command,'cwd':str(build)},indent=2)+'\n')
   env=os.environ.copy();assert not env.get('CCACHE_DISABLE');env['CCACHE_LOGFILE']=str(out/(name+'-cache.log'))
   before=stats();start=time.monotonic()
   with(out/(name+'-compile.log')).open('w')as log:
    p=subprocess.Popen(command,cwd=build,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    try:code=p.wait(timeout=90)
    except subprocess.TimeoutExpired:
     os.killpg(p.pid,signal.SIGTERM)
     try:p.wait(timeout=5)
     except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
     raise AssertionError('Graphics first-hit deadline; no cold fallback')
   after=stats();row={'source':rel,'target':target,'exitCode':code,'seconds':round(time.monotonic()-start,3),'hitDelta':hits(after)-hits(before),'missDelta':after['cache_miss']-before['cache_miss']}
   report['samples'].append(row);save()
   assert code==0 and row['hitDelta']==1 and row['missDelta']==0,'Historical graphics entry did not hit on first cached invocation'
  report['status']='passed';return report
 except Exception as error:
  report.update(status='failed',error=repr(error));raise
 finally:save()

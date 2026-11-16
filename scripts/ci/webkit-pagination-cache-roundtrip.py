#!/usr/bin/env python3
"""Real cross-process snapshot/restore and first-invocation hit gate."""
import importlib.util,json,os,pathlib,subprocess,shutil
here=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('cache_transfer',here/'webkit-pagination-cache.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research';evidence=root/'evidence';build=root/'build'
i=m.identity(evidence);bundle=root/'roundtrip-objects';restored=root/'restored-compiler-cache'
report={'status':'running','scope':'Exact input bound compiler cache, fresh restore and first calls in separate ccache processes'}
try:
 incoming=os.environ.get('PAGINATION_RESTORE_RUN','')
 if incoming:
  assert incoming.isdecimal()
  bundle=pathlib.Path(os.environ['RUNNER_TEMP'])/'pagination-incoming-objects'
  snapshot=json.loads((bundle/'receipt.json').read_text())
 else:snapshot=m.capture(pathlib.Path(os.environ['CCACHE_DIR']),bundle,i,budget=300)
 for field in i:
  bad={**i,field:'0'*64}
  try:m.restore(bundle,root/'must-not-restore',bad)
  except AssertionError:pass
  else:raise AssertionError('Changed identity accepted: '+field)
  assert not(root/'must-not-restore').exists()
 m.restore(bundle,restored,i)
 report['snapshot']={k:v for k,v in snapshot.items()if k!='entries'}
 for name in ['Allocator','Cache']:
  (build/f'Source/bmalloc/CMakeFiles/bmalloc.dir/bmalloc/{name}.cpp.o').unlink()
 env={**os.environ,'CCACHE_DIR':str(restored)}
 subprocess.run(['ccache','--max-size','2G'],env=env,check=True,timeout=10)
 subprocess.run(['python3',str(here/'webkit-cache-preflight.py'),'--build',str(build),'--output',str(evidence/'pagination-restored-cache-probe')],env=env,check=True,timeout=400)
 result=json.loads((evidence/'pagination-restored-cache-probe/result.json').read_text())
 assert result['status']=='passed'and all(s['hitDelta']==1 and s['missDelta']==0 for s in result['samples'])
 report.update(status='passed',firstInvocations=result['samples'],restoredCache=str(restored),identity=i)
 with open(os.environ['GITHUB_ENV'],'a')as out:out.write('CCACHE_DIR='+str(restored)+'\n')
 shutil.rmtree(bundle) # Final snapshot is taken after owned compiler group stops.
except Exception as error:report.update(status='failed',error=str(error))
finally:(evidence/'pagination-cache-roundtrip.json').write_text(json.dumps(report,indent=2)+'\n')
raise SystemExit(0 if report['status']=='passed'else 1)

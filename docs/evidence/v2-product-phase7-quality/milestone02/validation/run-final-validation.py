#!/usr/bin/env python3
"""Prepared only; execution requires Root's frozen-source CPU GO. Never installs or fixes."""
import argparse,datetime,hashlib,json,os,re,subprocess,time
from pathlib import Path
REPO=Path('/workspace/milkup');OUT=Path(__file__).resolve().parent
INPUT_ROOTS=['apps','packages','plugins','scripts','tests','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','playwright.config.ts','tsconfig.json','.prettierignore','.prettierrc','.prettierrc.json']
ENTRY=['bash','scripts/cloud/pnpm.sh','--config.verify-deps-before-run=false','--config.manage-package-manager-versions=false']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def git(*args):return subprocess.check_output(['git',*args],cwd=REPO,text=True).strip()
def write(path,obj):
 with path.open('x') as f:json.dump(obj,f,indent=2);f.write('\n')
def rows(paths):
 result=[]
 for rel in sorted(set(paths)):
  if not rel:continue
  p=REPO/rel
  if p.is_symlink():raise RuntimeError('Unexpected source symlink: '+rel)
  if not p.is_file():result.append({'path':rel,'missing':True});continue
  h=hashlib.sha256()
  with p.open('rb') as f:
   while chunk:=f.read(1024*1024):h.update(chunk)
  result.append({'path':rel,'bytes':p.stat().st_size,'sha256':h.hexdigest()})
 return result
def snapshot(path):
 tracked=git('ls-files','--',*INPUT_ROOTS).splitlines()
 untracked=git('ls-files','--others','--exclude-standard','--',*INPUT_ROOTS).splitlines()
 generated=[str(p.relative_to(REPO)) for p in (REPO/'apps/desktop/src/bundled-plugins').glob('*.milkup-plugin')]
 source=rows(tracked+untracked);bundles=rows(generated)
 result={'atUtc':now(),'head':git('rev-parse','HEAD'),'status':git('status','--short'),'sourceInputs':source,'bundledInputs':bundles,'inputIdentitySha256':hashlib.sha256(json.dumps({'source':source,'bundles':bundles},sort_keys=True).encode()).hexdigest()}
 write(path,result);return result

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--cpu-go',action='store_true',required=True);parser.add_argument('--run',required=True);parser.add_argument('--expected-head',required=True);parser.add_argument('--mode',choices=['workspace','browser','all'],required=True)
 args=parser.parse_args();assert re.fullmatch(r'[a-z0-9-]+',args.run)
 assert git('rev-parse','HEAD')==args.expected_head,'Unexpected HEAD; obtain fresh freeze approval'
 prefix=OUT/args.run;assert not list(OUT.glob(args.run+'-*')),'Preserve earlier execution'
 env=os.environ.copy();overrides={'NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN':'false','NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS':'false','COREPACK_ENABLE_NETWORK':'0','COREPACK_ENABLE_DOWNLOAD_PROMPT':'0','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD':'1','MILKUP_BROWSER_EXECUTABLE':'/usr/bin/chromium','PYTHONDONTWRITEBYTECODE':'1'};env.update(overrides)
 env['PATH']=str(REPO/'scripts/cloud/bin')+os.pathsep+env['PATH']
 env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(OUT/(args.run+'-browser-report.json'))
 before=snapshot(OUT/(args.run+'-inputs-before.json'))
 write(OUT/(args.run+'-execution.json'),{'state':'running','startedUtc':now(),'mode':args.mode,'expectedHead':args.expected_head,'environmentOverrides':overrides,'browser':subprocess.check_output(['/usr/bin/chromium','--version'],text=True).strip(),'inputIdentitySha256':before['inputIdentitySha256']})
 steps=[]
 if args.mode in {'workspace','all'}:
  steps += [('workspace-tests',ENTRY+['--workspace-concurrency=1','-r','test']),('workspace-types',ENTRY+['typecheck']),('version',ENTRY+['version:check']),('workspace-build',ENTRY+['build']),('full-format',ENTRY+['exec','prettier','--check','.']),('diff-check',['git','diff','--check','HEAD'])]
 if args.mode in {'browser','all'}:
  steps += [('browser-list',ENTRY+['test:e2e','--list','--reporter=line']),('browser',ENTRY+['test:e2e','--workers=2','--retries=0','--trace=retain-on-failure','--reporter=line,json','--output='+str(OUT/(args.run+'-browser-artifacts'))])]
 results=[];drift=False
 for name,command in steps:
  started=now();tick=time.monotonic();logpath=OUT/(args.run+'-'+name+'.log')
  print(json.dumps({'event':'START','name':name,'at':started}),flush=True)
  with logpath.open('xb') as log:
   log.write(('$ '+' '.join(command)+'\n').encode());log.flush()
   process=subprocess.Popen(command,cwd=REPO,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   with (OUT/(args.run+'-processes.jsonl')).open('a') as f:f.write(json.dumps({'name':name,'pid':process.pid,'startedUtc':started})+'\n')
   code=process.wait()
  result={'name':name,'command':command,'startedUtc':started,'finishedUtc':now(),'elapsedSeconds':time.monotonic()-tick,'exitCode':code,'log':str(logpath)}
  if name=='workspace-tests':
   text=logpath.read_text(errors='replace');result['actualSummaryLines']=[line for line in text.splitlines() if re.search(r'Test Files|^\s*Tests\s|# tests|# pass|# fail|ℹ tests|ℹ pass|ℹ fail',line)]
  if name=='browser-list':
   result['listed197']=bool(re.search(r'Total: 197 tests\b',logpath.read_text(errors='replace')))
  if name=='browser':
   reportpath=OUT/(args.run+'-browser-report.json')
   report=json.loads(reportpath.read_text()) if reportpath.exists() else {}
   result['stats']=report.get('stats');result['errors']=report.get('errors')
   stats=result['stats'] or {};result['all197Passed']=stats.get('expected')==197 and all(stats.get(k)==0 for k in ['unexpected','flaky','skipped'])
  write(OUT/(args.run+'-'+name+'.json'),result);results.append(result)
  after=snapshot(OUT/(args.run+'-inputs-after-'+name+'.json'))
  drift=after['head']!=before['head'] or after['inputIdentitySha256']!=before['inputIdentitySha256']
  print(json.dumps({'event':'FINISH',**result,'inputDrift':drift}),flush=True)
  if drift or (name=='browser-list' and (code or not result['listed197'])):break
 allpassed=len(results)==len(steps) and not drift and all(r['exitCode']==0 and r.get('all197Passed',True) for r in results)
 write(OUT/(args.run+'-summary.json'),{'finishedUtc':now(),'steps':results,'inputDrift':drift,'allPassed':allpassed,'noAutomaticRetry':True,'scope':'Original deadlines, no corrections or installation. Full browser acceptance requires 197 actual passes, no skipped/flaky/unexpected cases. Format is check-only; preserve any raw-evidence failures unchanged.'})
 return 0 if allpassed else 1
if __name__=='__main__':raise SystemExit(main())

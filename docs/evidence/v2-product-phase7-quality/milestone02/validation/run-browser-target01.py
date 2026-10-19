import os,json,subprocess,datetime,time,hashlib
from pathlib import Path
repo=Path('/workspace/milkup');out=Path(__file__).resolve().parent
assert not (out/'browser-target01.log').exists()
def snapshot(name):
 paths=subprocess.check_output(['git','ls-files','apps','packages','plugins','scripts','tests/e2e','tests/helpers','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','playwright.config.ts','tsconfig.json'],cwd=repo,text=True).splitlines()
 rows=[]
 for rel in paths:
  p=repo/rel
  if p.is_file():
   b=p.read_bytes();rows.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
 result={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'status':subprocess.check_output(['git','status','--short'],cwd=repo,text=True).strip(),'trackedInputs':rows}
 data=(json.dumps(result,indent=2)+'\n').encode();(out/name).write_bytes(data)
 return hashlib.sha256(data).hexdigest(),result
beforehash,before=snapshot('browser-target01-inputs-before.json')
assert before['head']=='78e9329004d2ff244585d98dbe0d7cdd98ab9495'
env=os.environ.copy();env.update(MILKUP_BROWSER_EXECUTABLE='/usr/bin/chromium',NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN='false',NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS='false',COREPACK_ENABLE_NETWORK='0',COREPACK_ENABLE_DOWNLOAD_PROMPT='0',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1',PLAYWRIGHT_JSON_OUTPUT_FILE=str(out/'browser-target01-report.json'))
env['PATH']=str(repo/'scripts/cloud/bin')+os.pathsep+env['PATH']
cmd=['bash','scripts/cloud/pnpm.sh','--config.verify-deps-before-run=false','--config.manage-package-manager-versions=false','test:e2e','tests/e2e/desktop-formatting.spec.ts','--project=desktop-msedge','--grep=^formatting toolbar geometry 760x520 dark 125%$','--workers=1','--retries=0','--trace=retain-on-failure','--reporter=line,json','--output='+str(out/'browser-target01-artifacts')]
started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic()
metadata={'started':started,'command':cmd,'head':before['head'],'inputsBeforeSha256':beforehash,'browser':subprocess.check_output(['/usr/bin/chromium','--version'],text=True).strip(),'expectedCaseCount':1,'originalTestAndDeadlinesUnchanged':True}
with (out/'browser-target01.log').open('w') as f:
 p=subprocess.Popen(cmd,cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
 (out/'browser-target01-running.json').write_text(json.dumps({**metadata,'pid':p.pid},indent=2)+'\n')
 code=p.wait()
afterhash,after=snapshot('browser-target01-inputs-after.json')
reportpath=out/'browser-target01-report.json';report=json.loads(reportpath.read_text()) if reportpath.exists() else {}
result={**metadata,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-start,'exitCode':code,'inputsAfterSha256':afterhash,'inputsUnchanged':before==after,'stats':report.get('stats'),'errors':report.get('errors')}
(out/'browser-target01-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(code)

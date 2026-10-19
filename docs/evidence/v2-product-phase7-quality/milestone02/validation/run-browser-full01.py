import os,json,subprocess,datetime,time,hashlib
from pathlib import Path
repo=Path('/workspace/milkup'); out=Path(__file__).resolve().parent
log=out/'browser-full01.log'; assert not log.exists(), 'Preserve prior run'
def git(*args): return subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
def snapshot(name):
    paths=git('ls-files','apps','packages','plugins','scripts','tests/e2e','tests/helpers','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','playwright.config.ts','tsconfig.json').splitlines()
    rows=[]
    for rel in paths:
        p=repo/rel
        if p.is_file():
            b=p.read_bytes();rows.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    generated=[]
    for folder in [repo/'apps/desktop/src/generated',repo/'apps/desktop/public/plugins']:
        if folder.exists():
            for p in sorted(folder.rglob('*')):
                if p.is_file() and not p.is_symlink():
                    b=p.read_bytes();generated.append({'path':str(p.relative_to(repo)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    result={'head':git('rev-parse','HEAD'),'status':git('status','--short'),'trackedInputs':rows,'generatedInputs':generated}
    data=(json.dumps(result,indent=2)+'\n').encode();(out/name).write_bytes(data)
    return hashlib.sha256(data).hexdigest(),result
beforehash,before=snapshot('browser-full01-inputs-before.json')
assert before['head']=='78e9329004d2ff244585d98dbe0d7cdd98ab9495'
assert not before['status'],before['status']
env=os.environ.copy();env.update(MILKUP_BROWSER_EXECUTABLE='/usr/bin/chromium',NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN='false',NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS='false',COREPACK_ENABLE_NETWORK='0',COREPACK_ENABLE_DOWNLOAD_PROMPT='0',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1',PLAYWRIGHT_JSON_OUTPUT_FILE=str(out/'browser-full01-report.json'))
env['PATH']=str(repo/'scripts/cloud/bin')+os.pathsep+env['PATH']
base=['bash','scripts/cloud/pnpm.sh','--config.verify-deps-before-run=false','--config.manage-package-manager-versions=false','test:e2e']
listing=subprocess.run(base+['--list','--reporter=line'],cwd=repo,env=env,capture_output=True,text=True)
(out/'browser-full01-list.log').write_text(listing.stdout+listing.stderr)
assert listing.returncode==0,listing.stderr
assert 'Total: 197 tests' in listing.stdout,listing.stdout[-1000:]
cmd=base+['--workers=2','--reporter=line,json','--output='+str(out/'browser-full01-artifacts')]
started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic()
metadata={'started':started,'command':cmd,'head':before['head'],'inputsBeforeSha256':beforehash,'browser':subprocess.check_output(['/usr/bin/chromium','--version'],text=True).strip(),'environmentOverrides':{k:env[k] for k in ['MILKUP_BROWSER_EXECUTABLE','NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN','NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS','COREPACK_ENABLE_NETWORK','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD']},'listCount':197,'timeoutAndTestsUnmodified':True}
with log.open('w') as f:
    p=subprocess.Popen(cmd,cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
    (out/'browser-full01-running.json').write_text(json.dumps({**metadata,'pid':p.pid},indent=2)+'\n')
    code=p.wait()
afterhash,after=snapshot('browser-full01-inputs-after.json')
reportpath=out/'browser-full01-report.json';report=json.loads(reportpath.read_text()) if reportpath.exists() else {}
result={**metadata,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-start,'exitCode':code,'inputsAfterSha256':afterhash,'inputsUnchanged':before==after,'stats':report.get('stats'),'errors':report.get('errors')}
(out/'browser-full01-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result));raise SystemExit(code)

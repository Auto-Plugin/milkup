import os,json,subprocess,datetime,time,shutil
from pathlib import Path
root=Path(__file__).resolve().parent
log=root/'browser-e2e-02.log'
assert not log.exists(), 'Preserve previous run'
env=os.environ.copy();env.update(MILKUP_BROWSER_EXECUTABLE='/usr/bin/chromium',NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN='false',NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS='false')
cmd=['bash','scripts/cloud/pnpm.sh','--config.verify-deps-before-run=false','--config.manage-package-manager-versions=false','test:e2e','--workers=2','--reporter=line']
started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic()
with log.open('w') as f:
 p=subprocess.Popen(cmd,cwd='/workspace/milkup',env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
 birth=Path(f'/proc/{p.pid}/stat').read_text().split(') ',1)[1].split()[19]
 (root/'browser-e2e-02-running.json').write_text(json.dumps(dict(pid=p.pid,birth=birth,started=started,command=cmd),indent=2)+'\n')
 code=p.wait()
artifacts=Path('/workspace/milkup/test-results')
if artifacts.exists():shutil.copytree(artifacts,root/'browser-e2e-02-artifacts')
result=dict(started=started,finished=datetime.datetime.now(datetime.timezone.utc).isoformat(),elapsedSeconds=time.monotonic()-start,exitCode=code,command=cmd)
(root/'browser-e2e-02-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result));raise SystemExit(code)

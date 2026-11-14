import sys,subprocess,hashlib,json,datetime,time,os
from pathlib import Path
root=Path('/workspace/milkup');dest=Path(__file__).parent
name=sys.argv[1];args=sys.argv[2:]
paths=['apps/desktop/src/desktop-plugin-ui.ts','apps/desktop/src/desktop-plugin-ui.test.ts']
def hashes():
 return {x:hashlib.sha256((root/x).read_bytes()).hexdigest() for x in paths}
record={'name':name,'args':args,'startUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'before':hashes()};start=time.monotonic()
env=os.environ.copy();env.update(NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN='false',NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS='false')
cmd=['bash','scripts/cloud/pnpm.sh','--config.verify-deps-before-run=false','--config.manage-package-manager-versions=false']+args
with (dest/(name+'.log')).open('x') as log:
 result=subprocess.run(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
record.update(exitCode=result.returncode,elapsedSeconds=time.monotonic()-start,endUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),after=hashes())
(dest/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record));print((dest/(name+'.log')).read_text()[-7000:])

from pathlib import Path
import json,subprocess,datetime,re
base=Path('/workspace/milkup-export-print-evidence/milestone06/checks');result=base/'final-checks.json';assert not result.exists()
basecmd='source /workspace/.cloud/milkup-v2/env.sh\nexport NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false\nbash scripts/cloud/pnpm.sh --config.verify-deps-before-run=false --config.manage-package-manager-versions=false '
checks=[('workspace-tests-final','-r --workspace-concurrency=1 test'),('workspace-types-final','-r --workspace-concurrency=1 typecheck'),('workspace-build-final','build')]
rows=[]
for name,args in checks:
 row={'check':name,'command':basecmd+args,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()};rows.append(row);result.write_text(json.dumps(rows,indent=2)+'\n');print('START '+name,flush=True)
 log=base/(name+'.log')
 with log.open('x') as f:p=subprocess.run(['bash','-lc',row['command']],cwd='/workspace/milkup',stdout=f,stderr=subprocess.STDOUT)
 row.update(exitCode=p.returncode,endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
 if name=='workspace-tests-final':
  txt=log.read_text(); counts=[int(x) for x in re.findall(r'Tests\s+(\d+) passed',txt)];row.update(vitestWorkspaceCounts=counts,vitestCount=sum(counts),nodeTestSummary=[line for line in txt.splitlines() if re.match(r'[ℹ#] (tests|pass|fail) ',line)])
 result.write_text(json.dumps(rows,indent=2)+'\n');print('END '+name+' exit='+str(p.returncode),flush=True)
print('CHECKS COMPLETE',flush=True)

from pathlib import Path
import json,subprocess,hashlib,datetime,shlex
root=Path('/workspace/milkup-p7-quality-evidence/milestone01');repo=Path('/workspace/milkup');out=root/'performance-repeat';out.mkdir(exist_ok=False)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def inventory(name):
 p=out/(name+'.json')
 with (out/(name+'.log')).open('x') as log:subprocess.run(['bash','-c',f'source /workspace/.cloud/milkup-v2/env.sh; exec python3 {root}/build-tools/native-idle-inventory.py {p}'],stdout=log,stderr=subprocess.STDOUT,check=True)
run='p7-baseline-ordinary-source-repeat-01';runtime=root/'native-ui/runtime';inventory('before-baseline')
files=['tests/native/tauri-production-latency.mjs','tests/helpers/native-production.mjs','tests/helpers/native-process-memory.mjs','tests/helpers/native-startup.mjs']; hashes={p:hashlib.sha256((repo/p).read_bytes()).hexdigest() for p in files}
for p in files:
 target=out/'source'/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((repo/p).read_bytes())
command=['bash','-c',f'source {runtime}/run-env.sh {run} || exit; export MILKUP_LATENCY_BYTES=65536 MILKUP_LATENCY_LINE_BYTES=64 MILKUP_LATENCY_MODE=source MILKUP_LATENCY_CYCLES=20; exec node tests/native/tauri-production-latency.mjs']
row={'run':run,'startedUtc':now(),'command':command,'sourceHashes':hashes}
with (out/'baseline-driver.log').open('x') as log:
 subprocess.run(['python3',str(runtime/'driver-control.py'),'start',run],stdout=log,stderr=subprocess.STDOUT,check=True)
 try:
  with (out/'baseline-run.log').open('x') as output:result=subprocess.run(command,cwd=repo,stdout=output,stderr=subprocess.STDOUT)
  row['harnessExitCode']=result.returncode
 finally:row['driverStopExitCode']=subprocess.run(['python3',str(runtime/'driver-control.py'),'stop',run],stdout=log,stderr=subprocess.STDOUT).returncode
row.update(finishedUtc=now(),sourceHashesAfter={p:hashlib.sha256((repo/p).read_bytes()).hexdigest() for p in files});samples=json.loads((root/'native-ui/runs'/run/'samples.json').read_text());row.update(complete=samples.get('complete'),sampleCount=len(samples['samples']),violations=samples['violations']);(out/'baseline-execution.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row),flush=True)
inventory('after-baseline-before-candidate')
assert row['harnessExitCode']==row['driverStopExitCode']==0 and row['complete'] and hashes==row['sourceHashesAfter'],'Functional failure; stop pair'
candidate=['python3',str(root/'build-tools/run-candidate-performance.py'),'p7-candidate-02-ordinary-source-repeat-01','65536','source',str(root/'candidate-production-02/milkup-desktop'),'8deacbf470f699ad9b0a6c2c2937adbfc7ef6194c38e8f61e707a70bdfc5f9b2']
with (out/'candidate-console.log').open('x') as log:r=subprocess.run(candidate,stdout=log,stderr=subprocess.STDOUT)
(out/'candidate-orchestration-exit.txt').write_text(str(r.returncode)+'\n');inventory('after-candidate')
print('PAIR_DONE candidate orchestration exit '+str(r.returncode),flush=True)

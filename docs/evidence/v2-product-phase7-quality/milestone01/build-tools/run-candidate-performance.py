"""One comparable native run, invoked serially after source freeze/build and display handoff."""
from pathlib import Path
import datetime,hashlib,json,re,shlex,subprocess,sys
assert len(sys.argv)==6,'RUN BYTES MODE CANDIDATE_BINARY SHA'
run,size,mode,binary,digest=sys.argv[1:]
assert re.fullmatch(r'p7-candidate-[a-z0-9-]+',run) and size in ['65536','179200','10485760'] and mode in ['source','live'] and re.fullmatch(r'[a-f0-9]{64}',digest)
repo=Path('/workspace/milkup');evidence=Path('/workspace/milkup-p7-quality-evidence/milestone01');runtime=evidence/'native-ui/candidate-runtime';out=evidence/'performance-candidate'/run;out.mkdir(parents=True,exist_ok=False)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
files=['tests/native/tauri-production-latency.mjs','tests/helpers/native-production.mjs','tests/helpers/native-process-memory.mjs','tests/helpers/native-startup.mjs']
source={p:sha(repo/p) for p in files}
for p in files:
    target=out/'source'/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((repo/p).read_bytes())
args=' '.join(shlex.quote(x) for x in [run,binary,digest]);command=['bash','-c',f'source {runtime}/run-env.sh {args} || exit; export MILKUP_LATENCY_BYTES={size} MILKUP_LATENCY_LINE_BYTES=64 MILKUP_LATENCY_MODE={mode} MILKUP_LATENCY_CYCLES=20; exec node tests/native/tauri-production-latency.mjs']
proof={'run':run,'binary':binary,'binarySha256':digest,'command':command,'sourceBefore':source,'startedUtc':now()}
(out/'execution-before.json').write_text(json.dumps(proof,indent=2)+'\n')
with (out/'driver-control.log').open('x') as log:
    started=subprocess.run(['python3',str(runtime/'driver-control.py'),'start',run,binary,digest],stdout=log,stderr=subprocess.STDOUT)
    proof['driverStartExitCode']=started.returncode
    if started.returncode==0:
        try:
            with (out/'run.log').open('x') as output: result=subprocess.run(command,cwd=repo,stdout=output,stderr=subprocess.STDOUT)
            proof['harnessExitCode']=result.returncode
        finally:
            stop=subprocess.run(['python3',str(runtime/'driver-control.py'),'stop',run],stdout=log,stderr=subprocess.STDOUT);proof['driverStopExitCode']=stop.returncode
proof.update(finishedUtc=now(),sourceAfter={p:sha(repo/p) for p in files})
samples=evidence/'native-ui/runs'/run/'samples.json'
if samples.exists():
    data=json.loads(samples.read_text());proof.update(complete=data.get('complete',False),sampleCount=len(data.get('samples',[])),violations=data.get('violations',[]),samplesSha256=sha(samples))
proof['accepted']=proof.get('harnessExitCode')==0 and proof.get('driverStopExitCode')==0 and proof.get('complete') is True and not proof.get('violations') and proof['sourceAfter']==source
(out/'execution.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:proof[k] for k in ['run','harnessExitCode','driverStartExitCode','driverStopExitCode','complete','sampleCount','violations','accepted'] if k in proof},indent=2));sys.exit(0 if proof['accepted'] else 1)

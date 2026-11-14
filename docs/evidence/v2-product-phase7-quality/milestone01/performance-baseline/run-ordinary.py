import datetime,hashlib,json,subprocess,sys
from pathlib import Path
root=Path('/workspace/milkup');out=Path(__file__).resolve().parent
runtime=out.parent/'native-ui/runtime'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def control(*args):subprocess.run(['python3',str(runtime/'driver-control.py'),*args],check=True)

for run,size,mode in [('p7-baseline-ordinary-source-01',65536,'source'),('p7-baseline-ordinary-live-01',65536,'live')]:
    control('start',run)
    command=['bash','-c',f'source {runtime}/run-env.sh {run}; export MILKUP_LATENCY_BYTES={size} MILKUP_LATENCY_LINE_BYTES=64 MILKUP_LATENCY_MODE={mode} MILKUP_LATENCY_CYCLES=20; exec node tests/native/tauri-production-latency.mjs']
    row={'run':run,'command':command,'startedUtc':now(),'sourceBefore':{k:hashlib.sha256((root/k).read_bytes()).hexdigest() for k in json.loads((out/'source-v2-hashes.json').read_text())}}
    with (out/(run+'.log')).open('x') as log: result=subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT)
    row.update(exitCode=result.returncode,finishedUtc=now(),sourceAfter={k:hashlib.sha256((root/k).read_bytes()).hexdigest() for k in row['sourceBefore']})
    samples=out.parent/'native-ui/runs'/run/'samples.json'
    if samples.exists():
        data=json.loads(samples.read_text());row.update(complete=data.get('complete',False),samples=len(data.get('samples',[])),violations=data.get('violations',[]))
    (out/(run+'-execution.json')).write_text(json.dumps(row,indent=2)+'\n')
    control('stop',run)
    print(json.dumps({'run':run,'exitCode':result.returncode,'complete':row.get('complete'),'samples':row.get('samples'),'violations':len(row.get('violations',[]))}),flush=True)
    if result.returncode or row.get('violations') or not row.get('complete'):sys.exit(1)

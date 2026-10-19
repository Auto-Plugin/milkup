from pathlib import Path
import subprocess,json,datetime
root=Path('/workspace/milkup-p7-quality-evidence/milestone01');out=root/'performance-candidate-03';out.mkdir(exist_ok=False)
def inventory(name):
 with (out/(name+'.log')).open('x') as log:subprocess.run(['bash','-c',f'source /workspace/.cloud/milkup-v2/env.sh; exec python3 {root}/build-tools/native-idle-inventory.py {out}/{name}.json'],stdout=log,stderr=subprocess.STDOUT,check=True)
rows=[];inventory('before-source')
for mode in ['source','live']:
 run='p7-candidate-03-ordinary-'+mode+'-01'
 command=['python3',str(root/'build-tools/run-candidate-performance.py'),run,'65536',mode,str(root/'candidate-production-03/milkup-desktop'),'341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2']
 with (out/(mode+'-console.log')).open('x') as log:result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
 proofpath=root/'performance-candidate'/run/'execution.json'
 if not proofpath.exists():raise RuntimeError('Run did not produce execution proof')
 proof=json.loads(proofpath.read_text());functional=proof.get('harnessExitCode')==0 and proof.get('driverStopExitCode')==0 and proof.get('complete') is True and proof['sourceAfter']==proof['sourceBefore']
 row={'run':run,'command':command,'orchestrationExitCode':result.returncode,'functionalCompletion':functional,'violations':len(proof.get('violations',[]))};rows.append(row)
 (out/'execution.json').write_text(json.dumps({'updatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':rows},indent=2)+'\n');print('CASE_DONE '+json.dumps(row),flush=True)
 inventory('after-'+mode)
 if not functional:raise RuntimeError('Functional failure; stop sequence')

from pathlib import Path
import json,subprocess,sys,datetime
root=Path('/workspace/milkup-p7-quality-evidence/milestone01'); runner=root/'build-tools/run-candidate-performance.py'
binary=str(root/'candidate-production-02/milkup-desktop');digest='8deacbf470f699ad9b0a6c2c2937adbfc7ef6194c38e8f61e707a70bdfc5f9b2'
cases=[('ordinary-live',65536,'live'),('ordinary-source',65536,'source'),('memory-source',179200,'source'),('memory-live',179200,'live'),('native-source',10485760,'source'),('native-live',10485760,'live')]
summary=[]
for label,size,mode in cases:
 run='p7-candidate-02-'+label+'-01'
 result=subprocess.run(['python3',str(runner),run,str(size),mode,binary,digest])
 proofpath=root/'performance-candidate'/run/'execution.json'
 if not proofpath.exists():sys.exit(result.returncode or 1)
 proof=json.loads(proofpath.read_text());functional=proof.get('harnessExitCode')==0 and proof.get('driverStopExitCode')==0 and proof.get('complete') is True and proof['sourceAfter']==proof['sourceBefore']
 row={'run':run,'orchestrationExitCode':result.returncode,'functionalCompletion':functional,'violations':len(proof.get('violations',[]))};summary.append(row)
 (root/'performance-candidate/six-execution.json').write_text(json.dumps({'updatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':summary},indent=2)+'\n')
 print('CASE_DONE '+json.dumps(row),flush=True)
 if not functional:sys.exit(1)

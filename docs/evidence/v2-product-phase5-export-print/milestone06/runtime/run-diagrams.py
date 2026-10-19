import os,json,datetime,subprocess,hashlib
from pathlib import Path
out=Path(os.environ['MILKUP_NATIVE_EVIDENCE_DIR'])
assert not out.exists()
control=out.parent/'control'; control.mkdir(exist_ok=True)
name=out.name
record=control/(name+'-m06-command.json'); log=control/(name+'-m06-harness.log')
assert not record.exists() and not log.exists()
script=Path('tests/native/tauri-p5-diagrams-output.mjs')
row={'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':['node',str(script)],'harnessSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'env':{k:v for k,v in os.environ.items() if k.startswith('MILKUP_P5M6_') or k in ('TAURI_APP_PATH','MILKUP_NATIVE_EXPECTED_BINARY_SHA256','MILKUP_P5_ARCHIVE','MILKUP_P5_ARCHIVE_SHA256','MILKUP_DOM_DIAGNOSTICS','DISPLAY')},'evidence':str(out)}
record.write_text(json.dumps(row,indent=2)+'\n')
with log.open('x') as f: result=subprocess.run(row['command'],stdout=f,stderr=subprocess.STDOUT)
row.update(exitCode=result.returncode,endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
record.write_text(json.dumps(row,indent=2)+'\n')
print(json.dumps(row)); print(log.read_text()[-8000:])
raise SystemExit(result.returncode)

import datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
scripts={'catalog':'tests/native/tauri-p6-catalog.mjs','management':'tests/native/tauri-p6-management.mjs','legacy':'tests/native/tauri-p6-lifecycle.mjs'}
script=Path(scripts[sys.argv[1]])
out=Path(os.environ['MILKUP_NATIVE_EVIDENCE_DIR']); control=out.parent.parent/'control'; control.mkdir(exist_ok=True)
record=control/(out.name+'-command.json');log=control/(out.name+'-harness.log')
assert not record.exists() and not log.exists() and not out.exists()
proofdir=control/(out.name+'-inputs');proofdir.mkdir()
inputs=[]
for p in [script,Path('tests/helpers/p6-catalog-fixtures.mjs'),Path('tests/helpers/native-production.mjs'),Path('tests/helpers/native-updates-fixture.mjs')]:
 b=p.read_bytes();(proofdir/(p.name+'.txt')).write_bytes(b);inputs.append({'path':str(p),'sha256':hashlib.sha256(b).hexdigest()})
row={'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':['node',str(script)],'inputs':inputs,'env':{k:v for k,v in os.environ.items() if k.startswith(('MILKUP_P6_', 'MILKUP_P5_')) or k in ['TAURI_APP_PATH','MILKUP_NATIVE_EXPECTED_BINARY_SHA256','MILKUP_NATIVE_PROFILE_ROOT','DISPLAY']},'evidence':str(out)}
record.write_text(json.dumps(row,indent=2)+'\n')
with log.open('x') as f:r=subprocess.run(row['command'],stdout=f,stderr=subprocess.STDOUT)
row.update(exitCode=r.returncode,endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat());record.write_text(json.dumps(row,indent=2)+'\n')
print(json.dumps({k:v for k,v in row.items() if k not in ['inputs','env']}));print(log.read_text()[-5000:]);raise SystemExit(r.returncode)

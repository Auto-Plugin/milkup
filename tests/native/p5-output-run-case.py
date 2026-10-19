"""Serial P5 wrapper, adapted from production08/run-case.py; never starts a driver."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

stage = sys.argv[1] if len(sys.argv) == 2 else ''
assert stage in ('html', 'pdf', 'cancel', 'selection', 'disable', 'print-cancel', 'print-file', 'overwrite', 'large')
env = dict(os.environ)
assert env.get('MILKUP_P5_BINARY_CONFIRMED') == '1', 'Wait for integrated-build readiness'
binary = Path(env['TAURI_APP_PATH']).resolve()
assert '/target/' not in str(binary)
assert hashlib.sha256(binary.read_bytes()).hexdigest() == env['MILKUP_NATIVE_EXPECTED_BINARY_SHA256']
output = Path(env['MILKUP_NATIVE_EVIDENCE_DIR']).resolve()
assert not output.exists(), 'Use a unique evidence directory for every attempt'
assert 'milkup-export-print-evidence' in output.parts
with urllib.request.urlopen(env['TAURI_DRIVER_URL'] + '/status', timeout=3) as response:
    assert response.status == 200
control = output.parent / 'control'
control.mkdir(parents=True, exist_ok=True)
record = control / (output.name + '-command.json')
log = control / (output.name + '-harness.log')
assert not record.exists() and not log.exists()
env['MILKUP_P5_STAGE'] = stage
command = ['node', 'tests/native/tauri-p5-output.mjs']
row = {'stage': stage, 'command': command, 'cwd': str(Path(__file__).resolve().parents[2]),
       'binary': str(binary), 'binarySha256': env['MILKUP_NATIVE_EXPECTED_BINARY_SHA256'],
       'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'evidence': str(output)}
record.write_text(json.dumps(row, indent=2) + '\n')
with log.open('x') as stream:
    completed = subprocess.run(command, cwd=row['cwd'], env=env, stdout=stream, stderr=subprocess.STDOUT)
row.update(exitCode=completed.returncode, endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
record.write_text(json.dumps(row, indent=2) + '\n')
print(json.dumps(row))
print(log.read_text()[-12000:])
sys.exit(completed.returncode)

import pathlib,json,time,subprocess
root=pathlib.Path('/workspace/.milkup-v2-phase19')
for _ in range(1500):
 d=json.loads((root/'native-checks.json').read_text());candidate=[r for r in d if r['name'].startswith('candidate-')]
 if any(r['exitCode'] for r in candidate):raise SystemExit('candidate failure; no subsequent run')
 if len(candidate)==48:break
 time.sleep(1)
else:raise SystemExit('bounded wait exhausted; no subsequent run')
# Last driver cleanup owns its session; wait for port release, at most 10s.
import socket
for _ in range(20):
 try:
  with socket.create_connection(('127.0.0.1',4444),timeout=.2):pass
 except OSError:break
 time.sleep(.5)
else:raise SystemExit('last matrix driver still bound')
with open(root/'native-regressions.log','w') as f:r=subprocess.run(['python3',str(root/'run-regressions.py')],stdout=f,stderr=subprocess.STDOUT)
raise SystemExit(r.returncode)

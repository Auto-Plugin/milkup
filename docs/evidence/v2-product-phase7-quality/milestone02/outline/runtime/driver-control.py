"""Own one stage's driver process group, checking PID birth before stopping it."""
import datetime, json, os, signal, subprocess, sys, time, urllib.request
from pathlib import Path
root = Path(__file__).resolve().parent
control = root.parent / 'control'
control.mkdir(exist_ok=True)
action, run, *args = sys.argv[1:]
assert run.startswith('p7-candidate-') and all(c.isalnum() or c == '-' for c in run)
record = control / (run + '-driver.json')
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def identity(pid):
    stat = Path(f'/proc/{pid}/stat').read_text()
    return {'pid':pid, 'birth':stat[stat.rfind(')')+2:].split()[19], 'pgid':os.getpgid(pid), 'state':stat[stat.rfind(')')+2:].split()[0]}
def status():
    with urllib.request.urlopen('http://127.0.0.1:4477/status', timeout=2) as response:
        return json.load(response)
if action == 'start':
    assert len(args) == 2 and not record.exists()
    try: status()
    except Exception: pass
    else: raise RuntimeError('Port 4477 already has a driver; do not reuse another stage')
    command = ['bash', str(root/'driver.sh'), run, *args]
    with (control/(run+'-launch.log')).open('x') as log:
        process = subprocess.Popen(command, cwd='/workspace/milkup', stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    row = {'command':command, 'startedUtc':now(), **identity(process.pid)}
    record.write_text(json.dumps(row, indent=2)+'\n')
    for _ in range(150):
        if process.poll() is not None: raise RuntimeError(f'Driver exited {process.returncode}; inspect launch log')
        try:
            result = status()
            assert result.get('value', result).get('ready') is True
            row.update(readyUtc=now(), readiness=result)
            record.write_text(json.dumps(row, indent=2)+'\n')
            print(json.dumps(row)); break
        except Exception: time.sleep(.2)
    else: raise RuntimeError('Driver did not reach ready state; retained process for explicit owned stop')
elif action == 'stop':
    assert not args
    row = json.loads(record.read_text())
    try: current = identity(row['pid'])
    except FileNotFoundError: row['alreadyExited']=True
    else:
        assert all(current[k] == row[k] for k in ('pid','birth','pgid'))
        os.killpg(row['pgid'], signal.SIGTERM)
        for _ in range(50):
            try:
                observed=identity(row['pid'])
                if observed['state']=='Z':
                    row['zombieNotRunning']=True
                    break
            except FileNotFoundError:
                row['reaped']=True
                break
            time.sleep(.1)
        else:
            assert all(identity(row['pid'])[k] == row[k] for k in ('pid','birth','pgid'))
            os.killpg(row['pgid'], signal.SIGKILL)
    row['stoppedUtc']=now(); record.write_text(json.dumps(row, indent=2)+'\n'); print(json.dumps(row))
else: raise RuntimeError('Use start or stop')

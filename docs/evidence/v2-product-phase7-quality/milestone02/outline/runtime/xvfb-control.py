import datetime,json,os,signal,subprocess,sys,time
from pathlib import Path
root=Path(__file__).resolve().parent.parent/'control'
record=root/'xvfb-127.json'
def identity(pid):
    fields=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
    return {'pid':pid,'birth':fields[19],'state':fields[0],'pgid':os.getpgid(pid)}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
if sys.argv[1]=='start':
    assert not record.exists() and not Path('/tmp/.X11-unix/X127').exists() and not Path('/tmp/.X127-lock').exists()
    command=['bash','-c','source /workspace/.cloud/milkup-v2/env.sh; exec Xvfb :127 -screen 0 1600x1000x24 -nolisten tcp']
    with (root/'xvfb-127.log').open('x') as log:p=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    row={**identity(p.pid),'command':command,'startedUtc':now()};record.write_text(json.dumps(row,indent=2)+'\n')
    for _ in range(100):
        assert p.poll() is None, 'Xvfb exited'
        if Path('/tmp/.X11-unix/X127').exists():break
        time.sleep(.1)
    else:raise RuntimeError('Xvfb socket missing')
    row['readyUtc']=now();record.write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row))
elif sys.argv[1]=='stop':
    row=json.loads(record.read_text())
    try:current=identity(row['pid'])
    except FileNotFoundError:row['alreadyReaped']=True
    else:
        assert all(current[k]==row[k] for k in ('pid','birth','pgid'))
        if current['state']!='Z':os.killpg(row['pgid'],signal.SIGTERM)
        for _ in range(50):
            try:current=identity(row['pid'])
            except FileNotFoundError:row['reaped']=True;break
            if current['state']=='Z':row['zombieNotRunning']=True;break
            time.sleep(.1)
        else:raise RuntimeError('Owned Xvfb did not exit; explicit investigation required')
    row['stoppedUtc']=now();record.write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row))
else:raise RuntimeError('start or stop required')

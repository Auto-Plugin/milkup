#!/usr/bin/python3
"""Read-only sampling of this runner's isolated X11 display and helper identities."""
import json, os, pathlib, re, signal, subprocess, time

evidence = pathlib.Path(os.environ['MILKUP_NATIVE_EVIDENCE_DIR'])
stop_file = evidence/'stop-x11-observation'
running = True
def stop(_signal, _frame):
    global running
    running = False
signal.signal(signal.SIGTERM, stop)

def query(argv):
    try:
        r = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
        return {'exitCode': r.returncode, 'stdout': r.stdout[:32768], 'stderr': r.stderr[:2048]}
    except Exception as error:
        return {'error': str(error)}

def processes():
    rows = []
    for p in pathlib.Path('/proc').iterdir():
        if not p.name.isdigit(): continue
        try:
            argv = (p/'cmdline').read_bytes().decode(errors='replace').split('\0')
            if not (argv[0].endswith('/milkup-desktop') or any(a.startswith('--milkup-internal-') for a in argv)):
                continue
            stat = (p/'stat').read_text(); fields = stat[stat.rfind(')')+2:].split()
            nspid = next((line for line in (p/'status').read_text().splitlines() if line.startswith('NSpid:')), None)
            rows.append({'pid': int(p.name), 'birth': fields[19], 'state': fields[0], 'argv': argv, 'namespacePids': nspid})
        except (OSError, ValueError): pass
    return rows

start = time.monotonic_ns(); count = 0; byte_count = 0; limit = 4*1024*1024; overflow = False
previous = None; last_written = 0; polls = 0; gaps = []; last_poll = start
with (evidence/'x11-observations.jsonl').open('x', buffering=1) as out:
    while running and not stop_file.exists() and time.monotonic_ns()-start < 180_000_000_000:
        now = time.monotonic_ns(); gaps.append(now-last_poll); last_poll = now; polls += 1
        active = query(['xprop', '-root', '_NET_ACTIVE_WINDOW', '_NET_CLIENT_LIST_STACKING'])
        tree = query(['xwininfo', '-root', '-tree'])
        signature = json.dumps([active, tree], sort_keys=True)
        if signature != previous or now-last_written >= 250_000_000:
            ids = list(dict.fromkeys(re.findall(r'0x[0-9a-fA-F]+', active.get('stdout',''))))
            record = {'monotonicNs': now, 'activeAndClients': active, 'tree': tree,
                      'clients': {wid: query(['xprop','-id',wid,'_NET_WM_PID','WM_CLASS','_NET_WM_NAME','WM_HINTS','_NET_WM_STATE']) for wid in ids if wid != '0x0'},
                      'productProcesses': processes()}
            line = json.dumps(record, ensure_ascii=False)+'\n'
            if byte_count+len(line.encode()) > limit:
                overflow = True; break
            out.write(line); byte_count += len(line.encode()); count += 1
            previous = signature; last_written = now
        time.sleep(.015)
(evidence/'x11-observation-summary.json').write_text(json.dumps({'readOnly':True,'startedMonotonicNs':start,'finishedMonotonicNs':time.monotonic_ns(),'polls':polls,'retainedSamples':count,'bytes':byte_count,'limit':limit,'overflow':overflow,'maximumPollGapMs':max(gaps or [0])/1e6,'stoppedByHarness':stop_file.exists()},indent=2)+'\n')

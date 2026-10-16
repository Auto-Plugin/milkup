#!/usr/bin/env python3
"""External test observer. No product IPC, runtime hooks or blanket process signals.
The driver, observer and app must share a PID namespace; keep this process and the
namespace alive through the verdict. stdin/stdout carry bounded observer commands.
"""
import argparse, json, os, re, select, signal, sys, time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=False)
root = None
baseline = set()
selected = None
known = {}
private = None
samples = []
events = []


def identity(pid):
    try:
        raw = Path('/proc', str(pid), 'stat').read_text()
        words = raw.rsplit(')', 1)[1].split()
        return {'pid': pid, 'birth': int(words[19]), 'parent': int(words[1]),
                'group': int(words[2]), 'state': words[0],
                'ticks': int(words[11]) + int(words[12]),
                'name': raw[raw.find('(') + 1:raw.rfind(')')]}
    except (OSError, ValueError, IndexError):
        return None


def argv(pid):
    try:
        return Path('/proc', str(pid), 'cmdline').read_bytes().decode().split('\0')[:-1]
    except (OSError, UnicodeError):
        return []


def table():
    return {int(p.name): row for p in Path('/proc').iterdir()
            if p.name.isdigit() and (row := identity(int(p.name))) is not None}


def descend(rows, seeds):
    owned = {pid for pid, birth in seeds.items()
             if pid in rows and rows[pid]['birth'] == birth}
    while True:
        more = {pid for pid, row in rows.items() if row['parent'] in owned} - owned
        if not more:
            return owned
        owned.update(more)


def sample():
    rows = table()
    app_alive = root and rows.get(root['pid'], {}).get('birth') == root['birth']
    guardians = []
    if app_alive:
        for pid, row in rows.items():
            if row['parent'] == root['pid']:
                command = argv(pid)
                if command == [root['argv'][0], '--milkup-internal-dom-helper']:
                    guardians.append(row)
    members = []
    if selected:
        seeds = dict(known)
        seeds[selected['pid']] = selected['birth']
        for pid in descend(rows, seeds):
            known[pid] = rows[pid]['birth']
            members.append(rows[pid])
    record = {'mono': time.monotonic(), 'wall': time.time(), 'appAlive': bool(app_alive),
              'guardians': guardians, 'members': sorted(members, key=lambda p: p['pid']),
              'privateDirectory': private, 'privateDirectoryExists': bool(private and Path(private).exists())}
    samples.append(record)
    with (out / 'samples.ndjson').open('a') as stream:
        stream.write(json.dumps(record) + '\n')
    return record


def handle(message):
    global root, baseline, selected, private
    command = message['command']
    if command == 'root':
        assert root is None
        expected = message['identity']
        actual = identity(int(expected['pid']))
        assert actual and actual['birth'] == int(expected['birth']), 'App identity changed'
        # The JS /proc reader preserves the terminating NUL as a final empty
        # split item. Remove that terminator only, preserving real empty args.
        expected_argv = list(expected['argv'])
        if expected_argv and expected_argv[-1] == '':
            expected_argv.pop()
        assert argv(actual['pid']) == expected_argv, 'App argv differs / PID namespace mismatch'
        root = dict(actual, argv=expected_argv)
        row = sample()
        baseline = {(p['pid'], p['birth']) for p in row['guardians']}
        return dict(row, root=root, clockTicks=os.sysconf('SC_CLK_TCK'), pidNamespace=os.readlink('/proc/self/ns/pid'))
    if command == 'bind':
        assert root and selected is None
        row = sample()
        candidates = [p for p in row['guardians'] if (p['pid'], p['birth']) not in baseline]
        assert len(candidates) == 1, f'Expected one newly installed fixture guardian, got {candidates}'
        selected = candidates[0]
        environment = Path('/proc', str(selected['pid']), 'environ').read_bytes().split(b'\0')
        values = [entry.split(b'=', 1)[1].decode() for entry in environment
                  if entry.startswith(b'MILKUP_INTERNAL_DOM_GUARD_DIR=')]
        assert len(values) == 1 and re.fullmatch(r'/tmp/milkup-dom-[a-f0-9]{48}', values[0]), values
        private = values[0]
        instances = [entry.split(b'=', 1)[1].decode() for entry in environment
                     if entry.startswith(b'MILKUP_INTERNAL_DOM_INSTANCE_ID=')]
        assert len(instances) == 1 and re.fullmatch(r'[a-f0-9]{48}', instances[0])
        selected['instanceId'] = instances[0]
        assert Path(private).is_dir()
        return dict(sample(), selectedGuardian=selected)
    if command == 'status':
        return sample()
    if command == 'kill-app':
        assert selected and root, 'Bind fixture before fault injection'
        fd = os.pidfd_open(root['pid'])
        try:
            actual = identity(root['pid'])
            assert actual and actual['birth'] == root['birth'] and argv(root['pid']) == root['argv']
            event = {'event': 'SIGKILL-exact-app', 'mono': time.monotonic(), 'wall': time.time(), 'identity': root}
            signal.pidfd_send_signal(fd, signal.SIGKILL)
            events.append(event)
            (out / 'events.json').write_text(json.dumps(events, indent=2) + '\n')
            return event
        finally:
            os.close(fd)
    if command == 'finish':
        row = sample()
        summary = {'last': row, 'root': root, 'selectedGuardian': selected,
                   'knownPidBirth': known, 'events': events, 'sampleCount': len(samples),
                   'cleanupObserved': bool(selected and not row['members'] and not row['privateDirectoryExists'])}
        (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        return summary
    raise ValueError('Unsupported observer command')


while True:
    if select.select([sys.stdin], [], [], 0.025)[0]:
        line = sys.stdin.buffer.readline(16385)
        if not line:
            break
        request = {}
        try:
            assert len(line) <= 16384 and line.endswith(b'\n'), 'Oversize observer command'
            request = json.loads(line)
            result = handle(request)
            print(json.dumps({'id': request['id'], 'ok': True, 'value': result}), flush=True)
            if request['command'] == 'finish':
                break
        except BaseException as error:
            print(json.dumps({'id': request.get('id'), 'ok': False, 'error': repr(error)}), flush=True)
    elif root:
        sample()

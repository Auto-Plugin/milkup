#!/usr/bin/env python3
"""Test-only, one Linux process, no process-name/group/descendant signals."""
import hashlib
import json
import os
import pathlib
import re
import select
import signal
import sys
import time


def identity(pid):
    proc = pathlib.Path('/proc') / str(pid)
    stat = (proc/'stat').read_text()
    tail = stat[stat.rindex(')')+2:].split()
    uid_line = next(line for line in (proc/'status').read_text().splitlines() if line.startswith('Uid:'))
    with (proc/'exe').open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    return {'pid': pid, 'birth': tail[19], 'state': tail[0],
            'uids': list(map(int, uid_line.split()[1:])),
            'executable': os.readlink(proc/'exe'), 'sha256': digest,
            'argv': (proc/'cmdline').read_bytes().rstrip(b'\0').decode().split('\0')}


def open_verified(request):
    pid = request['pid']
    assert type(pid) is int and pid > 1 and pid not in [os.getpid(), os.getppid()]
    assert request['uid'] == os.getuid() != 0
    assert re.fullmatch(r'[0-9]{1,30}', request['birth'])
    assert re.fullmatch(r'[0-9a-f]{64}', request['sha256'])
    root = pathlib.Path(request['root'])
    fixture = pathlib.Path(request['fixture'])
    assert root.is_absolute() and root.resolve() == root and root != pathlib.Path('/')
    assert fixture.is_absolute() and fixture.resolve() == fixture and fixture.is_relative_to(root)
    assert fixture.is_file() and not fixture.is_symlink() and fixture.stat().st_uid == os.getuid()
    fd = os.pidfd_open(pid, 0)
    try:
        first = identity(pid)
        for observed in [first, identity(pid)]:
            assert observed['birth'] == request['birth'], 'Process birth mismatch'
            assert observed['state'] not in ['Z', 'X'], 'Process already exited'
            assert observed['uids'] == [request['uid']] * 4, 'Process owner mismatch'
            assert observed['executable'] == request['executable'], 'Executable mismatch'
            assert observed['sha256'] == request['sha256'], 'Executable hash mismatch'
            assert observed['argv'][0] == request['executable'], 'argv executable mismatch'
            assert request['fixture'] in observed['argv'][1:], 'Owned launch fixture missing'
        return fd, first
    except BaseException:
        os.close(fd)
        raise


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('MILKUP_NATIVE_EXCLUSIVE_DISPLAY') == '1'
    raw = sys.stdin.buffer.read(4097)
    assert len(raw) <= 4096
    request = json.loads(raw)
    root = pathlib.Path(os.environ['MILKUP_NATIVE_EVIDENCE_DIR']).resolve()
    assert root.is_relative_to(pathlib.Path(os.environ['RUNNER_TEMP']).resolve())
    assert request['root'] == str(root)
    assert request['executable'] == os.environ['TAURI_APP_PATH'] == '/usr/bin/milkup-desktop'
    assert request['sha256'] == os.environ['MILKUP_NATIVE_EXPECTED_BINARY_SHA256']
    fd, observed = open_verified(request)
    try:
        started = time.monotonic_ns()
        # The descriptor pins the verified instance, even if its numeric PID is
        # reused after the last identity read. Never signal through the PID number.
        signal.pidfd_send_signal(fd, signal.SIGKILL, None, 0)
        poll = select.poll()
        poll.register(fd, select.POLLIN)
        exited = bool(poll.poll(10000))
        result = {'identity': observed, 'signal': 'SIGKILL', 'method': 'pidfd_send_signal',
                  'pidfdExited': exited, 'elapsedMs': (time.monotonic_ns()-started)/1e6,
                  'classification': 'controlled abrupt termination, not spontaneous crash or power loss'}
        print(json.dumps(result), flush=True)
        assert exited, 'Verified process did not reach pidfd exit within 10 seconds'
    finally:
        os.close(fd)


if __name__ == '__main__':
    main()

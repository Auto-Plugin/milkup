#!/usr/bin/env python3
"""Real tauri-driver, inert native-driver adapter and real child exec. No GUI claim."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

KEY = 'MILKUP_QA_PUBLIC_SENTINEL'
VALUE = 'public-process-boundary-v1-not-a-key'


def identity():
    return {'pid': os.getpid(), 'ppid': os.getppid(), 'uid': os.getuid(),
            'birth': Path('/proc/self/stat').read_text().rsplit(') ', 1)[1].split()[19]}


def adapter():
    port = int(next(v.split('=')[1] for v in sys.argv if v.startswith('--port=')))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send(self, value):
            body = json.dumps({'value': value}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            assert self.path == '/status'
            self.send({'ready': True, 'nativeIdentity': identity()})

        def do_POST(self):
            assert self.path == '/session'
            size = int(self.headers['Content-Length'])
            assert size < 4096
            options = json.loads(self.rfile.read(size))['capabilities']['alwaysMatch']
            assert 'tauri:options' not in options  # actual proxy translation occurred
            browser = options['webkitgtk:browserOptions']
            assert browser == {'binary': sys.executable,
                               'args': [str(Path(__file__).resolve()), '--probe']}
            # Like the native driver: execute on session request, inherit the
            # driver's environment. Neither the request nor argv carries VALUE.
            output = subprocess.check_output([browser['binary'], *browser['args']], timeout=3)
            self.send({'sessionId': 'owned-inert-session', 'probe': json.loads(output),
                       'nativeIdentity': identity()})

    HTTPServer(('127.0.0.1', port), Handler).serve_forever()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--driver', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert os.getuid() != 0 and args.driver.is_file()
    assert not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
    report = {'scope': 'actual tauri-driver HTTP translation and subprocess inheritance; inert native adapter, not WebKit GUI',
              'driverSha256': hashlib.sha256(args.driver.read_bytes()).hexdigest(), 'cases': []}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    previous = os.environ.pop(KEY, None)
    try:
        with tempfile.TemporaryDirectory(prefix='milkup-boundary-') as tmp:
            shim = Path(tmp) / 'owned-native-driver'
            shim.write_text('#!' + sys.executable + '\nimport runpy,sys\nsys.argv.insert(1,"--adapter")\nrunpy.run_path(' + repr(str(Path(__file__).resolve())) + ',run_name="__main__")\n')
            shim.chmod(0o700)
            for early in [False, True]:
                os.environ.pop(KEY, None)
                if early:
                    os.environ[KEY] = VALUE
                port, native_port = free_port(), free_port()
                assert port != native_port
                process = subprocess.Popen([str(args.driver), '--port', str(port), '--native-port', str(native_port),
                                            '--native-host', '127.0.0.1', '--native-driver', str(shim)],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
                try:
                    def request(route, payload=None):
                        req = urllib.request.Request(f'http://127.0.0.1:{port}{route}',
                                                     data=None if payload is None else json.dumps(payload).encode(),
                                                     headers={'Content-Type': 'application/json'})
                        with opener.open(req, timeout=4) as res:
                            return json.loads(res.read(16384))['value']
                    end = time.monotonic() + 8
                    while True:
                        assert process.poll() is None, 'Owned driver exited before ready'
                        try:
                            ready = request('/status')
                            break
                        except OSError:
                            if time.monotonic() >= end:
                                raise
                            time.sleep(.05)
                    os.environ[KEY] = VALUE  # deliberately too late for the negative case
                    row = request('/session', {'capabilities': {'alwaysMatch': {'tauri:options': {
                        'application': sys.executable, 'args': [str(Path(__file__).resolve()), '--probe']}}}})
                    probe = row['probe']
                    assert probe['ppid'] == ready['nativeIdentity']['pid'] == row['nativeIdentity']['pid']
                    assert row['nativeIdentity']['ppid'] == process.pid
                    assert probe['uid'] == os.getuid()
                    assert probe['present'] is early and probe['matches'] is early
                    assert os.environ[KEY] == VALUE
                    report['cases'].append({'earlyExport': early, 'driverPid': process.pid,
                                            'native': row['nativeIdentity'], 'probe': probe, 'passed': True})
                finally:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.communicate(timeout=5)
        report['status'] = 'passed-process-boundary-only'
    finally:
        os.environ.pop(KEY, None)
        if previous is not None:
            os.environ[KEY] = previous
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    if '--probe' in sys.argv:
        print(json.dumps({**identity(), 'present': KEY in os.environ, 'matches': os.environ.get(KEY) == VALUE}))
    elif '--adapter' in sys.argv:
        adapter()
    else:
        main()

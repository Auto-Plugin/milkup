#!/usr/bin/env python3
"""Bounded, own-process X11/driver plumbing gate before compiling the QA app."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time
import urllib.request

COMMANDS = ['node', 'python3', 'bash', 'openssl', 'curl', 'sha256sum', 'cut', 'seq', 'sleep',
            'mkdir', 'id', 'timeout', 'tee', 'xvfb-run', 'xauth', 'dbus-run-session',
            'xdotool', 'xprop', 'xwininfo', 'tauri-driver', 'WebKitWebDriver']


def require_commands(names, resolver=shutil.which):
    found = {name: resolver(name) for name in names}
    assert all(found.values()), 'Missing required commands: ' + repr([k for k, v in found.items() if not v])
    return found


def until(fn, label, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = fn()
        if result:
            return result
        time.sleep(.1)
    raise AssertionError('Preflight timeout: ' + label)


def capture(argv):
    return subprocess.check_output(argv, text=True, stderr=subprocess.DEVNULL, timeout=3).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('close_helper', type=Path)
    args = parser.parse_args()
    assert os.getuid() != 0 and os.environ.get('DISPLAY')
    assert not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'status': 'running', 'uid': os.getuid(), 'commands': require_commands(COMMANDS)}
    driver = window = None
    try:
        assert args.close_helper.is_absolute() and os.access(args.close_helper, os.X_OK)
        scripts = ['scripts/ci/linux-update-download-gui.mjs', 'scripts/ci/check-linux-update-unit.mjs',
                   'tests/helpers/native-production.mjs', 'tests/helpers/native-startup.mjs',
                   'tests/helpers/native-updates-fixture.mjs', 'scripts/release/test-support/in-app-update-server.mjs',
                   'scripts/release/test-support/linux-download-signing-fixture.mjs']
        for file in scripts:
            subprocess.run(['node', '--check', file], check=True, timeout=5)
        subprocess.run(['bash', '-n', 'scripts/ci/run-linux-update-download.sh'], check=True, timeout=5)
        subprocess.run(['node', '--input-type=module', '-e', "await import('./tests/helpers/native-production.mjs');await import('./tests/helpers/native-updates-fixture.mjs');await import('./scripts/release/test-support/in-app-update-server.mjs')"], check=True, timeout=5)
        report['syntaxAndImports'] = 'passed'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 4444))  # refuse a pre-existing driver/listener
        with (args.output / 'driver.log').open('wb') as log:
            driver = subprocess.Popen(['tauri-driver', '--native-driver', report['commands']['WebKitWebDriver']], stdout=log, stderr=log, start_new_session=True)
            def status():
                assert driver.poll() is None, 'Driver exited during preflight'
                try:
                    with urllib.request.urlopen('http://127.0.0.1:4444/status', timeout=1) as res:
                        return json.loads(res.read(16384))
                except OSError:
                    return None
            report['driverStatus'] = until(status, 'actual driver HTTP status')
            subprocess.run(['curl', '--fail', '--silent', '--max-time', '3', 'http://127.0.0.1:4444/status'], check=True, stdout=subprocess.DEVNULL, timeout=4)
        child = args.output / 'owned-window.py'
        child.write_text('''import gi,json,os,sys
gi.require_version('Gtk','3.0')
from gi.repository import Gtk
w=Gtk.Window(title='MILKUP_UPDATE_PLUMBING');w.set_default_size(480,160)
e=Gtk.Entry();w.add(e)
def close(*unused):
 value=e.get_text();print(json.dumps({'pid':os.getpid(),'text':value,'normalDeleteEvent':True}),flush=True)
 Gtk.main_quit();return False
w.connect('delete-event',close);w.show_all();e.grab_focus();Gtk.main()
''')
        with (args.output / 'window.log').open('wb') as log:
            window = subprocess.Popen(['python3', str(child)], stdout=log, stderr=log)
            birth = Path(f'/proc/{window.pid}/stat').read_text().rsplit(') ', 1)[1].split()[19]
            def find_window():
                assert window.poll() is None, 'GTK plumbing window exited'
                try:
                    found = capture(['xdotool', 'search', '--all', '--onlyvisible', '--pid', str(window.pid), '--name', '^MILKUP_UPDATE_PLUMBING$']).splitlines()
                    assert len(found) == 1
                    return found[0]
                except subprocess.CalledProcessError:
                    return None
            xid = until(find_window, 'exact owned GTK window')
            assert capture(['xdotool', 'getwindowpid', xid]) == str(window.pid)
            report['windowOwnerProperty'] = capture(['xprop', '-id', xid, '_NET_WM_PID'])
            assert report['windowOwnerProperty'].endswith('= ' + str(window.pid))
            report['windowGeometry'] = capture(['xwininfo', '-id', xid])
            assert Path(f'/proc/{window.pid}/stat').read_text().rsplit(') ', 1)[1].split()[19] == birth
            wrong = subprocess.run([str(args.close_helper), xid, str(window.pid + 100000)], check=False, timeout=3, stdout=subprocess.DEVNULL)
            assert wrong.returncode == 4, 'Wrong-PID close not refused'
            assert window.poll() is None
            subprocess.run(['xdotool', 'windowfocus', '--sync', xid, 'type', '--clearmodifiers', '--delay', '3', '--', 'OWNED_NATIVE_KEYS'], check=True, timeout=5)
            time.sleep(.2)
            report['closeRequest'] = json.loads(capture([str(args.close_helper), xid, str(window.pid)]))
            assert window.wait(timeout=5) == 0
        rows = [json.loads(line) for line in (args.output / 'window.log').read_text().splitlines() if line.startswith('{')]
        assert rows == [{'pid': window.pid, 'text': 'OWNED_NATIVE_KEYS', 'normalDeleteEvent': True}]
        report['nativeKeysAndNormalClose'] = rows[0]
        report['status'] = 'passed-plumbing-only'
    except Exception as error:
        report.update(status='failed', error=repr(error))
        raise
    finally:
        if window and window.poll() is None:
            window.terminate()
            window.wait(timeout=5)
            report['forcedWindowCleanup'] = True
        if driver and driver.poll() is None:
            os.killpg(driver.pid, signal.SIGTERM)
            driver.wait(timeout=5)
        (args.output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()

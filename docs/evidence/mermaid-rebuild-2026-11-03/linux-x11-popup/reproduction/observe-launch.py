#!/usr/bin/python3
"""Test-only waitpid observer; never substitutes termination for normal UI exit."""
import hashlib, json, os, pathlib, subprocess, sys, threading, time

def publish_json(name, value):
    target = pathlib.Path(name)
    temporary = target.with_name(target.name + '.partial-' + str(os.getpid()))
    with temporary.open('x') as out:
        json.dump(value, out, indent=2)
        out.write('\n')
    # Atomic visibility, and fail rather than overwrite an existing record.
    os.link(temporary, target)
    temporary.unlink()

binary = pathlib.Path(os.environ['MILKUP_OBSERVED_BINARY'])
expected = os.environ['MILKUP_OBSERVED_SHA256']
assert hashlib.sha256(binary.read_bytes()).hexdigest() == expected
started = time.monotonic_ns()
child = subprocess.Popen([str(binary), *sys.argv[1:]], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
stat = pathlib.Path('/proc/%d/stat' % child.pid).read_text()
birth = stat[stat.rfind(')') + 2:].split()[19]
record = {'binary': str(binary), 'binarySha256': expected, 'pid': child.pid,
          'birth': birth, 'argv': [str(binary), *sys.argv[1:]], 'observerPid': os.getpid(),
          'startedMonotonicNs': started, 'terminationRequestedByObserver': False}
publish_json(os.environ['MILKUP_OBSERVED_START_RECORD'], record)
capture = {'bytesSeen': 0, 'bytesRetained': 0, 'overflow': False, 'eof': False}
limit = 2 * 1024 * 1024

def drain():
    try:
        with open(os.environ['MILKUP_OBSERVED_APP_LOG'], 'xb', buffering=0) as output:
            while True:
                data = child.stdout.read1(8192)
                if not data:
                    capture['eof'] = True
                    break
                capture['bytesSeen'] += len(data)
                keep = data[:max(0, limit - capture['bytesRetained'])]
                output.write(keep)
                capture['bytesRetained'] += len(keep)
                if capture['bytesSeen'] > limit:
                    capture['overflow'] = True
    except Exception as error:
        capture['error'] = str(error)

reader = threading.Thread(target=drain, daemon=True)
reader.start()
code = child.wait()
record.update({'exitObservedMonotonicNs': time.monotonic_ns(), 'returnCode': code,
               'exitCode': code if code >= 0 else None, 'signal': -code if code < 0 else None})
reader.join(timeout=5)
record['capture'] = dict(capture)
record['stdioCompleted'] = not reader.is_alive() and capture['eof'] and 'error' not in capture
publish_json(os.environ['MILKUP_OBSERVED_EXIT_RECORD'], record)
if capture['overflow'] or not record['stdioCompleted']:
    sys.exit(98)
sys.exit(code if code >= 0 else 128 - code)

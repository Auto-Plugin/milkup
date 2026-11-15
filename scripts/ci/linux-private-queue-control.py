"""Controls only the private loopback scheduler; never the system CUPS server."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import cups

root = Path(os.environ['MILKUP_PRIVATE_CUPS_ROOT']).resolve()
queue = os.environ['MILKUP_QUEUE_NAME']
assert re.fullmatch(r'MilkupPrivate[0-9]+', queue)
assert os.getuid() != 0
assert os.environ['CUPS_SERVER'] == '127.0.0.1:18632'
connection = cups.Connection(host='127.0.0.1', port=18632)
def jobs():
    result = connection.getJobs(which_jobs='all', my_jobs=False)
    for identifier in result:
        attrs = connection.getJobAttributes(identifier)
        assert attrs['job-printer-uri'].endswith('/printers/' + queue)
        assert attrs['job-originating-user-name'] == __import__('pwd').getpwuid(os.getuid()).pw_name
    return result
def wait(fn):
    start = time.monotonic()
    while time.monotonic() - start < 15:
        result = fn()
        if result:
            return result
        time.sleep(.1)
    raise AssertionError('Private queue bounded wait expired')
action = sys.argv[1]
if action == 'jobs':
    result = {'ids': sorted(jobs())}
elif action == 'pause':
    connection.disablePrinter(queue)
    assert connection.getPrinters()[queue]['printer-state'] == 5
    result = {'paused': True}
elif action == 'receipt':
    previous_count = int(sys.argv[2])
    marker = sys.argv[3]
    current = wait(lambda: jobs() if len(jobs()) == previous_count + 1 else None)
    identifier = max(current)
    attrs = wait(lambda: (a if (a := connection.getJobAttributes(identifier))['job-state'] == 9 else None))
    files = list((root / 'receiver').glob('*.pdf'))
    assert len(files) == 1, 'Exactly one received document, no ambient jobs'
    data = files[0].read_bytes()
    assert data.startswith(b'%PDF-') and len(data) < 4 * 1024 * 1024
    info = subprocess.check_output(['pdfinfo', str(files[0])], text=True, timeout=5)
    text = subprocess.check_output(['pdftotext', '-raw', str(files[0]), '-'], text=True, timeout=5)
    pages = int(re.search(r'^Pages:\s+(\d+)', info, re.M)[1])
    (root / 'receipt-pdfinfo.txt').write_text(info)
    (root / 'receipt-text.txt').write_text(text)
    result = {'jobId': identifier, 'attributes': attrs, 'pages': pages,
              'markerCount': text.count(marker), 'receivedFile': files[0].name,
              'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
              'transport': 'private CUPS IPP backend to loopback ippeveprinter',
              'physicalOutput': False}
elif action == 'cancel-new':
    previous = set(json.loads(sys.argv[2]))
    current = wait(lambda: jobs() if len(set(jobs()) - previous) == 1 else None)
    identifier, = set(current) - previous
    before = connection.getJobAttributes(identifier)
    assert before['job-state'] in (3, 4), 'Only this pending job may be cancelled'
    connection.cancelJob(identifier, purge_job=False)
    attrs = wait(lambda: (a if (a := connection.getJobAttributes(identifier))['job-state'] == 7 else None))
    active = connection.getJobs(which_jobs='not-completed', my_jobs=False)
    assert identifier not in active
    assert len(list((root / 'receiver').glob('*.pdf'))) == 1, 'Cancelled job must not reach receiver'
    result = {'jobId': identifier, 'before': before, 'after': attrs,
              'state': attrs['job-state'], 'remainingActive': identifier in active,
              'scope': 'Cancelled from private CUPS queue; not automatic rollback or app-side cancellation'}
else:
    raise AssertionError('Unknown action')
print(json.dumps(result, sort_keys=True))

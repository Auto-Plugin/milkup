#!/usr/bin/env python3
"""Re-audit retained failure bytes before spending a native candidate build."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import zipfile

archive, destination = map(pathlib.Path, sys.argv[1:])
assert archive.stat().st_size == 2229319
assert hashlib.sha256(archive.read_bytes()).hexdigest() == '0cde8e2e975995f2fd51480cf93aa8310925dcd3ae0ad2f68409910b5a180e71'
original = destination / 'original'
check = destination / 'recheck'
original.mkdir(parents=True)
check.mkdir()
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None and sum(i.file_size for i in z.infolist()) < 50000000
    for i in z.infolist():
        assert not pathlib.PurePosixPath(i.filename).is_absolute() and '..' not in pathlib.PurePosixPath(i.filename).parts
    z.extractall(original)
for f in ['complex-pagination.md','expectations.json','a4-portrait.pdf','letter-landscape.pdf']:
    shutil.copyfile(original/'gui'/f, check/f)
run = subprocess.run([sys.executable,'scripts/ci/complex-pagination-audit.py','audit',str(check)], timeout=150)
assert run.returncode == 1, 'Original product must still fail corrected pagination gate'
report = json.loads((check/'pagination-audit.json').read_text())
assert report['errors'] == ['a4-portrait: T: orphan heading'], report['errors']
assert all(len(p['renderedGuards']) == 172 for p in report['papers'])
assert all(p['uriAnnotations'] == [] for p in report['papers'])
assert all(not next(d for d in p['mappingDiagnostics'] if d['source']=='中文春风又绿明月')['exact'] for p in report['papers'])
(destination/'baseline-verification.json').write_text(json.dumps({'status':'expected-real-failure-preserved','artifact':14151117902,'run':43688690760,'errors':report['errors'],'sourceSha256':json.loads((check/'expectations.json').read_text())['sourceSha256']},indent=2)+'\n')

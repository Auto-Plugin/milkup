#!/usr/bin/env python3
"""Fetch only the exact small upstream text snapshots listed in the manifest.
No repository, engine archive, runtime, toolchain or binary is downloaded.
Existing local source files are verified rather than overwritten.
"""
from pathlib import Path
import hashlib
import json
import urllib.request

root = Path(__file__).resolve().parent
prefix = 'https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/'
manifest = json.loads((root / 'source-manifest.json').read_text())
assert sum(x.get('bytes', 0) for x in manifest) < 2 * 1024 * 1024
for entry in manifest:
    assert 'error' not in entry, entry
    relative = Path(entry['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    assert entry['url'] == prefix + relative.as_posix()
    target = root / 'sources' / relative
    if target.exists():
        data = target.read_bytes()
    else:
        with urllib.request.urlopen(entry['url'], timeout=20) as response:
            data = response.read(1024 * 1024 + 1)
    assert len(data) == entry['bytes'] <= 1024 * 1024, entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
print(json.dumps({'verifiedFiles': len(manifest), 'bytes': sum(x['bytes'] for x in manifest)}))

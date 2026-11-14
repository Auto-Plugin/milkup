#!/usr/bin/env python3
"""Validate frozen evidence bytes; a recorded failure remains a failure."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent
index=json.loads((root/'final-index.json').read_text())
listed=set()
for item in index['files']:
 rel=item['path'];p=root/rel
 assert not Path(rel).is_absolute() and '..' not in Path(rel).parts,rel
 assert rel not in listed,rel
 listed.add(rel)
 assert p.is_file() and not p.is_symlink(),rel
 data=p.read_bytes()
 assert len(data)==item['bytes'],rel
 assert hashlib.sha256(data).hexdigest()==item['sha256'],rel
actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='final-index.json'}
assert listed==actual, {'missing':sorted(listed-actual),'unlisted':sorted(actual-listed)}
print(f'PASS {len(listed)} evidence files; statuses remain those of individual run/review records')

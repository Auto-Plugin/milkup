"""Verify retained beta.5 evidence bytes without executing the artifacts."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
index = json.loads((root / 'index.json').read_text())
seen = set()
for record in index['files']:
    relative = record['path']
    path = root / relative
    assert not Path(relative).is_absolute() and '..' not in Path(relative).parts
    assert relative not in seen and not path.is_symlink() and path.is_file()
    seen.add(relative)
    data = path.read_bytes()
    assert len(data) == record['bytes'], relative
    assert hashlib.sha256(data).hexdigest() == record['sha256'], relative
actual = {
    str(path.relative_to(root))
    for path in root.rglob('*')
    if path.is_file() and path != root / 'index.json'
}
assert actual == seen, {'unindexed': sorted(actual - seen), 'missing': sorted(seen - actual)}
print(f'PASS: {len(seen)} beta.5 evidence files match exact size and SHA-256')

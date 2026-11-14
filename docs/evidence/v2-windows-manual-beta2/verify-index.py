from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent
index=json.loads((root/'index.json').read_text())
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name!='index.json'}
assert actual==set(index['files'])
for name,digest in index['files'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
print(f"Verified {len(actual)} original evidence files")

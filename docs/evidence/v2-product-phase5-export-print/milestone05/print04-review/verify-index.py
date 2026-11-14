from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent
index=json.loads((root/'index.json').read_text())
for item in index['files']:
 data=(root/item['path']).read_bytes()
 assert len(data)==item['bytes'],item['path']
 assert hashlib.sha256(data).hexdigest()==item['sha256'],item['path']
print(f"Verified {len(index['files'])} files ({sum(x['bytes'] for x in index['files'])} bytes)")

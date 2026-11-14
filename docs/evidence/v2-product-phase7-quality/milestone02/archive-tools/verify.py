#!/usr/bin/env python3
import gzip,hashlib,json,sys
from pathlib import Path
from common import digest,safe_relative

def verify(root):
    m=json.loads((root/'archive-manifest.json').read_text()); expected={'archive-manifest.json','ARCHIVE-INDEX.md','archive-metadata-checksums.json'}
    checks=json.loads((root/'archive-metadata-checksums.json').read_text())
    if set(checks)!={'archive-manifest.json','ARCHIVE-INDEX.md'}: raise RuntimeError('Invalid metadata checksums')
    for name,c in checks.items():
        if digest(root/name)!=(c['bytes'],c['sha256']): raise RuntimeError('Metadata hash mismatch')
    for e in m['entries']:
        rel=safe_relative(e['path']); p=root/rel
        if str(rel) in expected: raise RuntimeError('Duplicate archive entry')
        expected.add(str(rel))
        if p.is_symlink() or any(q.is_symlink() for q in p.parents) or not p.is_file(): raise RuntimeError('Unsafe archive member')
        if digest(p)!=(e['archiveBytes'],e['archiveSha256']): raise RuntimeError('Archive hash mismatch: '+str(rel))
        if e['encoding']=='gzip':
            h=hashlib.sha256(); size=0
            with gzip.open(p,'rb') as f:
                while b:=f.read(1024*1024):
                    size+=len(b)
                    if size>e['originalBytes']: raise RuntimeError('Unexpected decompressed size')
                    h.update(b)
            actual=(size,h.hexdigest())
        elif e['encoding']=='identity': actual=digest(p)
        else: raise RuntimeError('Unknown encoding')
        if actual!=(e['originalBytes'],e['originalSha256']): raise RuntimeError('Original hash mismatch: '+str(rel))
    files={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() or p.is_symlink()}
    if files!=expected: raise RuntimeError('Missing or unlisted archive files')
    print(json.dumps({'verifiedFiles':len(m['entries']),'gzipFiles':sum(e['encoding']=='gzip' for e in m['entries'])}))
if __name__=='__main__': verify(Path(sys.argv[1]))

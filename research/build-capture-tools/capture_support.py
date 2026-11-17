"""Small stdlib-only graph helpers; no source report, build or network action."""
import gzip
import hashlib
import json
from pathlib import PurePosixPath
EVIDENCE_SHA = '68d61f216c3bab3b04f79c947b80d56a9b742a01aa923eb107057896561bed15'
SOURCE_ROOT = '/home/runner/work/_temp/milkup-current-source-gate/source/'
BUILD_ROOT = '/home/runner/work/_temp/milkup-current-source-gate/build/'
def require(value, message):
    if not value:
        raise ValueError(message)

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def relative(name):
    p = PurePosixPath(name)
    require(str(p) == name and not p.is_absolute() and '..' not in p.parts
            and name not in ('', '.'), 'Canonical relative input')
    return name

def restore_parts(z, name):
    manifest = json.loads(z.read('graph/' + name + '.parts.json'))
    require(manifest['encoding'] == 'ordered-gzip-parts'
            and 0 < manifest['rawBytes'] <= 64 * 1024**2
            and 0 < len(manifest['parts']) <= 4, 'Bounded graph manifest')
    chunks = []
    for i, part in enumerate(manifest['parts']):
        require(part['file'] == f'{name}.part-{i:03d}.gz', 'Ordered graph parts')
        stored = z.read('graph/' + part['file'])
        require(len(stored) == part['storedBytes'] and sha(stored) == part['storedSha256'],
                'Stored graph part identity')
        # The outer ZIP is pinned before this function is used.
        raw = gzip.decompress(stored)
        require(len(raw) == part['rawBytes'] and sha(raw) == part['rawSha256'],
                'Raw graph part identity')
        chunks.append(raw)
    raw = b''.join(chunks)
    require(len(raw) == manifest['rawBytes'] and sha(raw) == manifest['rawSha256'],
            'Whole graph identity')
    return raw

def graph_records(text):
    records = []; current = None
    for line in text.splitlines():
        if line.startswith('build '):
            left, right = line[6:].split(': ', 1)
            explicit = left.split(' | ')[0]
            current = None
            if '$' in explicit:
                continue
            parts = right.split(' || ')[0].split()
            current = {'outputs': explicit.split(), 'rule': parts[0],
                       'inputs': [x for x in parts[1:] if x != '|'],
                       'edgeSha256': sha(line.encode()), 'variables': {}}
            records.append(current)
        elif current is not None and line.startswith('  ') and ' = ' in line:
            key, value = line.strip().split(' = ', 1)
            current['variables'][key] = value
        elif line and not line.startswith(' '):
            current = None
    return records

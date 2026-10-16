#!/usr/bin/env python3
"""Read-only checkpoint integrity check; no product/test execution.

Default verifies repository copies and README relative links.
Use --sources while original executor paths remain available to verify those too.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sources', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent
index = json.loads((root / 'index.json').read_text(encoding='utf-8'))
errors = []
seen = set()
byte_count = 0
for row in index['files']:
    relative = Path(row['stored'])
    if relative.is_absolute() or '..' in relative.parts or row['stored'] in seen:
        errors.append(f"Unsafe/duplicate stored path: {relative}")
        continue
    seen.add(row['stored'])
    paths = [root / relative]
    if args.sources:
        paths.append(Path(row['source']))
    for path in paths:
        if not path.is_file() or path.is_symlink():
            errors.append(f'Missing/non-regular file: {path}')
            continue
        data = path.read_bytes()
        if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
            errors.append(f'Byte/hash mismatch: {path}')
    byte_count += row['bytes']
for target in re.findall(r'\]\(([^)]+)\)', (root / 'README.md').read_text(encoding='utf-8')):
    if '://' not in target and not (root / target.split('#', 1)[0]).exists():
        errors.append(f'Missing README link: {target}')
if len(seen) != index['totalFiles'] or byte_count != index['totalBytes']:
    errors.append('Index totals mismatch')
if index.get('selectionHashMismatches'):
    errors.append('Original selection hash mismatches recorded')
actual = {str(p.relative_to(root)) for p in (root / 'research').rglob('*') if p.is_file()}
if actual != seen:
    errors.append(f'Unindexed/missing files: {sorted(actual ^ seen)}')
print(json.dumps({'ok': not errors, 'files': len(seen), 'bytes': byte_count,
                  'sourcesChecked': args.sources, 'errors': errors}, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))

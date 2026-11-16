"""Offline object-retention preparation. No runtime, compiler, upload or restore.

The caller must first stop/reap its compiler group. These are evidence objects,
not a substitute for Ninja/ccache dependency checking on any later build.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat

MAX_BYTES = 2 * 1024**3
MAX_OBJECT = 64 * 1024**2
MAX_COUNT = 4000
IDENTITY_FIELDS = {'sourceArchives', 'observationPatch', 'compiler', 'configureArgs',
                   'compileDatabase', 'generatedHeaders'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def key(identity):
    if set(identity) != IDENTITY_FIELDS or not all(
            isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in identity.values()):
        raise ValueError('Exact input digests required; no environment or credentials')
    return 'pagination-objects-v1-' + digest(json.dumps(identity, sort_keys=True).encode())


def relative_object(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or str(path) != name or not name.endswith('.o'):
        raise ValueError('Only normalized relative object paths')
    return path


def read_object(build, name):
    path = relative_object(name)
    current = build
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Symlink not an owned object')
    fd = os.open(current, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 64 <= before.st_size <= MAX_OBJECT:
            raise ValueError('Unbounded or non-regular object')
        data = bytearray()
        while len(data) <= before.st_size:
            chunk = os.read(fd, min(1024**2, before.st_size + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns) or len(data) != before.st_size:
            raise ValueError('Object changed during capture')
    finally:
        os.close(fd)
    # A shared library or executable, even renamed .o, must not enter this store.
    if data[:6] != b'\x7fELF\x02\x01' or int.from_bytes(data[16:18], 'little') != 1:
        raise ValueError('Only little-endian ELF64 ET_REL objects')
    return bytes(data)


def capture(build, destination, identity, commands, completed):
    """All-or-fail bounded snapshot of explicitly selected completed objects.

    Does not recurse over a workspace or read arbitrary environment variables.
    No bundle can be reused unless its expected identity is supplied separately.
    """
    build = Path(build).resolve(strict=True)
    destination = Path(destination)
    if destination.exists() or not completed or len(completed) > MAX_COUNT or len(completed) != len(set(completed)):
        raise ValueError('Fresh destination and bounded unique selection required')
    identity_key = key(identity)
    configured = {}
    for entry in commands:
        argv = entry.get('arguments') or shlex.split(entry['command'])
        if argv.count('-o') != 1 or argv.count('-c') != 1 or Path(entry['directory']).resolve() != build:
            raise ValueError('Exact compile command required')
        name = argv[argv.index('-o') + 1]
        relative_object(name)
        if name in configured:
            raise ValueError('Ambiguous output')
        configured[name] = digest(json.dumps(argv, separators=(',', ':')).encode())
    rows, total = [], 0
    destination.mkdir(parents=True)
    try:
        for name in sorted(completed):
            if name not in configured:
                raise ValueError('Not in configured compile graph')
            data = read_object(build, name)
            total += len(data)
            if total > MAX_BYTES:
                raise ValueError('Object store exceeds 2 GiB; no complete receipt')
            value = digest(data)
            (destination / (value + '.o')).write_bytes(data)
            rows.append({'target': name, 'sha256': value, 'bytes': len(data),
                         'commandSha256': configured[name]})
        receipt = {'key': identity_key, 'identity': identity, 'objects': rows,
                   'bytes': total, 'restorationAuthorized': False}
        (destination / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        return receipt
    except Exception:
        # Only newly created files at this fresh destination belong to us.
        for path in destination.iterdir():
            path.unlink()
        destination.rmdir()
        raise


def verify(destination, expected_identity):
    destination = Path(destination)
    metadata = destination / 'receipt.json'
    if destination.is_symlink() or metadata.is_symlink() or metadata.stat().st_size > 4 * 1024**2:
        raise ValueError('Untrusted or oversized receipt')
    receipt = json.loads(metadata.read_text())
    if receipt['key'] != key(expected_identity) or receipt['identity'] != expected_identity:
        raise ValueError('Input identity mismatch')
    rows = receipt['objects']
    if not rows or len(rows) > MAX_COUNT or len({r['target'] for r in rows}) != len(rows):
        raise ValueError('Invalid object selection')
    expected_files = {'receipt.json'}
    total = 0
    for row in rows:
        relative_object(row['target'])
        if not re.fullmatch('[0-9a-f]{64}', row['sha256']) or not re.fullmatch('[0-9a-f]{64}', row['commandSha256']):
            raise ValueError('Invalid object hash')
        name = row['sha256'] + '.o'
        data = read_object(destination, name)
        if digest(data) != row['sha256'] or len(data) != row['bytes']:
            raise ValueError('Truncated or altered object')
        total += len(data)
        expected_files.add(name)
    if total != receipt['bytes'] or total > MAX_BYTES or {p.name for p in destination.iterdir()} != expected_files:
        raise ValueError('Extra files or total budget mismatch')
    return receipt

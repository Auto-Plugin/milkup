"""Bind limited PDF.js notices to bytes extracted from a real GResource container.

Does not execute payloads, install anything, assert a complete SBOM or approve
licenses. A standalone bundle is not evidence that a final ELF/package contains it.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import selectors
import shutil
import stat
import subprocess
import time

_spec = importlib.util.spec_from_file_location(
    'pdfjs_notices', Path(__file__).with_name('webkit-pdfjs-notices.py'))
notices = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(notices)
PREFIX = '/org/webkit/pdfjs/'


def bounded_command(argv, limit, seconds=10):
    """Bound both bytes and time, including a stalled decompressor; never use a shell."""
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    data = bytearray()
    deadline = time.monotonic() + seconds
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError('Resource command timed out')
                if not selector.select(min(remaining, 0.1)):
                    continue
                chunk = os.read(proc.stdout.fileno(), min(65536, limit + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > limit:
                    raise ValueError('Resource command output budget exceeded')
        if proc.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
            raise ValueError('Resource extraction failed')
        return bytes(data)
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait(timeout=5)
        proc.stdout.close()


def identity(path):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Resource container symlink rejected')
    st = path.stat()
    if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= 1024 ** 3:
        raise ValueError('Bounded regular resource container required')
    def stamp(info):
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    digest = hashlib.sha256()
    count = 0
    with path.open('rb') as stream:
        if stamp(os.fstat(stream.fileno())) != stamp(st):
            raise ValueError('Resource container changed before hashing')
        while chunk := stream.read(min(1024 ** 2, st.st_size + 1 - count)):
            count += len(chunk)
            if count > st.st_size:
                raise ValueError('Resource container grew during hashing')
            digest.update(chunk)
        if count != st.st_size or stamp(os.fstat(stream.fileno())) != stamp(st):
            raise ValueError('Resource container changed during hashing')
    return {'sha256': digest.hexdigest(), 'bytes': count}, stamp(st)



def verify(pdfjs_root, notice_payload, container, expected_sha256):
    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("Exact resource container SHA-256 required")
    manifest = notices.verify(pdfjs_root, notice_payload)
    container = Path(container).absolute()
    before, token = identity(container)
    if before['sha256'] != expected_sha256:
        raise ValueError('Resource container identity mismatch')
    executable = shutil.which('gresource')
    if not executable:
        raise ValueError('Official GLib gresource tool required')
    listing = bounded_command([executable, 'list', str(container)], 1024 ** 2).decode('utf-8').splitlines()
    if not listing or len(listing) != len(set(listing)):
        raise ValueError('Nonempty unique resource listing required')
    rows = []
    for asset in manifest['assets']:
        name = PREFIX + asset['path']
        if name not in listing:
            raise ValueError('Missing embedded resource: ' + name)
        data = bounded_command([executable, 'extract', str(container), name], 256 * 1024)
        if len(data) != asset['bytes'] or hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise ValueError('Embedded resource differs from reviewed source: ' + name)
        rows.append({**asset, 'resourceName': name})
    after, after_token = identity(container)
    if after != before or after_token != token:
        raise ValueError('Resource container changed during verification')
    # Recheck the notice payload/source too; evidence binds these actual bytes.
    if notices.verify(pdfjs_root, notice_payload) != manifest:
        raise ValueError('Notice/source changed during verification')
    return {
        'schemaVersion': 1,
        'status': 'limited-resource-notice-binding-not-package-or-release-approval',
        'resourceContainer': before,
        'resourceListingCount': len(listing),
        'assets': rows,
        'notices': manifest['notices'],
        'completeSbom': False,
        'installedPayloadVerified': False,
        'finalRuntimeMembershipVerified': False,
        'legalApproval': False,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdfjs_root', type=Path)
    parser.add_argument('notice_payload', type=Path)
    parser.add_argument('container', type=Path)
    parser.add_argument('expected_sha256')
    args = parser.parse_args()
    print(json.dumps(verify(args.pdfjs_root, args.notice_payload, args.container, args.expected_sha256), indent=2))

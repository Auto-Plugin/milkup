"""Bounded static NSIS member reading. Never execute or import installer bytes."""
import hashlib
import os
from pathlib import Path
import re
import selectors
import stat
import struct
import subprocess
import tempfile
import time

from package_evidence import ENGINE_PATH, BOOTSTRAP_PATH, ENGINE_SHA, match_bytes, record
from product_evidence import require, sha256, read_input

MIB = 1024 * 1024


def bounded_process(arguments, maximum_stdout, timeout=30):
    require(isinstance(arguments, list) and all(isinstance(x, str) for x in arguments), 'Structured static command required')
    chunks = {'stdout': bytearray(), 'stderr': bytearray()}
    process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               shell=False, close_fds=True)
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            for name in chunks:
                pipe = getattr(process, name); os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            while selector.get_map():
                require(time.monotonic() < deadline, 'Static extraction exceeded its fixed deadline')
                for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                    limit = maximum_stdout if key.data == 'stdout' else MIB
                    data = os.read(key.fileobj.fileno(), min(65536, limit + 1 - len(chunks[key.data])))
                    if not data:
                        selector.unregister(key.fileobj); continue
                    chunks[key.data].extend(data)
                    require(len(chunks[key.data]) <= limit, 'Static tool ' + key.data + ' exceeded byte cap')
            result = process.wait(timeout=max(0.01, deadline - time.monotonic()))
            require(result == 0, 'Static tool failed: ' + chunks['stderr'].decode(errors='replace')[:500])
    finally:
        if process.poll() is None: process.kill()
        process.wait(timeout=5)
        process.stdout.close(); process.stderr.close()
    return bytes(chunks['stdout']), bytes(chunks['stderr'])


def exact_member(name):
    require(isinstance(name, str) and 0 < len(name) <= 512 and not name.startswith(('/', '-')) and
            not any(c in name for c in '\\:*?\x00\r\n') and all(x not in ('', '.', '..') for x in name.split('/')) and
            name.split('/')[-1] == 'milkup-desktop.exe', 'Only exact reviewed NSIS application member may be read')
    return name


def inspect_static(installer, package, source, sevenzip):
    tool = Path(sevenzip)
    tool_bytes = read_input(tool, 32 * MIB)
    require(tool_bytes[:4] == b'\x7fELF' and os.access(tool, os.X_OK), 'Installed native ELF static inspection tool required')
    packaging = package['packaging']; match_bytes(packaging['installer'], installer, 'Installer changed before static inspection')
    member = exact_member(package['nsisMember'])
    # Only this copy of the new, API-hash-bound installer is made readable by
    # the static archive tool. It is never marked executable or launched.
    with tempfile.TemporaryDirectory(prefix='milkup-current-installer-static-') as temporary:
        path = Path(temporary) / 'current-api-verified-installer.exe'
        with path.open('xb') as stream: stream.write(installer)
        path.chmod(stat.S_IRUSR)
        listing, listing_stderr = bounded_process([str(tool), 'l', '-slt', '-sccUTF-8', str(path)], 2 * MIB)
        text = listing.decode('utf-8-sig')
        require(re.search(r'^Type = Nsis\r?$', text, re.M) is not None, 'Actual archive is not recognized as NSIS')
        listed = re.findall(r'^Path = ([^\r\n]+)\r?$', text, re.M)
        require(sum(x.replace('\\', '/') == member for x in listed) == 1, 'Exact NSIS member missing or ambiguous')
        image, stderr = bounded_process([str(tool), 'e', '-so', '-y', '-spd', '-sccUTF-8', str(path), member], 64 * MIB)
        require(read_input(path, 80 * MIB) == installer, 'Static tool changed installer bytes')
    match_bytes(packaging['extractedApplication'], image, 'Actual installer member is not expected NSS image')
    require(len(image) >= 64 and image[:2] == b'MZ', 'Actual embedded PE missing')
    pe = struct.unpack_from('<I', image, 0x3c)[0]
    require(pe + 24 <= len(image) and image[pe:pe + 4] == b'PE\0\0' and
            struct.unpack_from('<H', image, pe + 4)[0] == 0x8664, 'Embedded application is not PE x64')
    marker = b'__TAURI_BUNDLE_TYPE_VAR_NSS'; offset = package['nsis']['markerOffset']
    require(image[offset:offset + len(marker)] == marker and image.find(marker) == offset and
            image.find(marker, offset + 1) == -1, 'Actual NSS marker missing/ambiguous/at another offset')
    engine = source.read(ENGINE_PATH)
    require(len(engine) == 5494801 and sha256(engine) == ENGINE_SHA, 'Official fixed engine source changed')
    bootstrap = source.read(BOOTSTRAP_PATH)
    versions = [('exact-git-bytes', bootstrap)]
    if b'\r' not in bootstrap: versions.append(('exact-git-LF-to-CRLF', bootstrap.replace(b'\n', b'\r\n')))
    embedded = package['verification']['embedded']
    require(embedded.get('engineVersion') == '12.2.0' and embedded.get('changedBytes') == 3 and
            embedded.get('markerOffset') == offset and embedded.get('compiledSha256') == packaging['compiledApplication']['sha256'] and
            embedded.get('extractedSha256') == sha256(image), 'Embedded engine proof identity mismatch')
    results = {}
    for name, options in [('engine', [('exact-official-source', engine)]), ('bootstrap', versions)]:
        expected = embedded['extracted'][name]
        choices = [(transform, data) for transform, data in options if record(data) == {k: expected.get(k) for k in ('bytes', 'sha256')}]
        require(len(choices) == 1, 'Embedded asset does not match exact candidate source variants: ' + name)
        transform, data = choices[0]; position = image.find(data)
        require(position >= 0 and position == expected.get('offset'), 'Complete embedded source absent/offset differs: ' + name)
        require(embedded['compiled'][name].get('bytes') == len(data) and embedded['compiled'][name].get('sha256') == sha256(data),
                'Reported compiled asset identity differs: ' + name)
        results[name] = {**record(data), 'offset': position, 'sourceTransform': transform}
    version = package['manifest']['version']
    # Windows FileVersionInfo in the run provides semantic version parsing;
    # local static bytes independently retain the exact Unicode version string.
    require((version + '\0').encode('utf-16le') in image, 'Exact candidate version string absent from PE bytes')
    return {'status': 'passed', 'readOnlyStaticInspection': True, 'tool': str(tool), 'toolSha256': sha256(tool_bytes),
            'installer': record(installer), 'member': member, 'application': record(image), 'peMachine': '0x8664',
            'embeddedAssets': results, 'listingSha256': sha256(listing),
            'staticStderrBytes': len(listing_stderr) + len(stderr), 'installerExecuted': False,
            'compiledToNssLocallyRecomputed': False,
            'compiledToNssScope': 'Compiled EXE is not an input; full transform is bound to the two actual Windows comparison reports'}

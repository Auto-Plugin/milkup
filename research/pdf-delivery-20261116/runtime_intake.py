"""Consume the one completed normal CMake install; never build, install or run it.

Archive authentication precedes extraction. ELF inspection uses readelf only.
The result explicitly is not an application package, sandbox or native PDF pass.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import zipfile

import package_boundary as boundary

HERE = Path(__file__).resolve().parent
RUNTIME_SHA = '34e4e12cda98933eef024ede2317b3fbf255631936376312d3e8e33d915aaf7c'
EVIDENCE_SHA = '68d61f216c3bab3b04f79c947b80d56a9b742a01aa923eb107057896561bed15'
TAR_SHA = '24222e13da4ea05d2fbebe93633d986ad54c001bf5dbc980b5dcbda51300fed1'
HARNESS_SHA = 'f084ae61eb3fc115c0368390d2ed87b1e8f7fb89'
SCOPE = 'normal-cmake-staged-runtime-not-application-package-or-native-accepted'


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_members(archive, receipt, manifest, prefix):
    require(receipt['scope'] == SCOPE and receipt['prefix'] == prefix, 'Runtime scope/prefix')
    require(receipt['runtimeBytesIncluded'] is True and receipt['objectCheckpoint'] is False, 'Runtime kind')
    require(0 < len(receipt['files']) <= 5000, 'File count budget')
    rows = {r['path']: r for r in receipt['files']}
    require(len(rows) == len(receipt['files']), 'Duplicate receipt paths')
    paths = manifest.decode('utf-8').splitlines()
    require(len(paths) == len(set(paths)) == len(rows), 'Install manifest count')
    require(set(paths) == {'/' + p for p in rows}, 'Install manifest identity')
    require(hashlib.sha256(manifest).hexdigest() == receipt['installManifestSha256'], 'Install manifest hash')
    members = archive.getmembers()
    require(len(members) == len(rows) and {m.name for m in members} == set(rows), 'Archive exact inventory')
    total = 0
    for member in members:
        p = PurePosixPath(member.name)
        require(str(p) == member.name and not p.is_absolute() and '..' not in p.parts, 'Noncanonical archive path')
        require(('/' + member.name).startswith(prefix + '/'), 'Outside final prefix')
        require(set(member.pax_headers) <= {'path','mtime'}, 'Unexpected PAX metadata')
        require(member.pax_headers.get('path', member.name) == member.name, 'PAX path identity')
        if 'mtime' in member.pax_headers:
            require(re.fullmatch(r'[0-9]{1,12}(?:\.[0-9]{1,9})?', member.pax_headers['mtime']), 'PAX timestamp')
        row = rows[member.name]
        if row['kind'] == 'symlink':
            target = row['target']
            require(member.issym() and member.linkname == target, 'Link identity')
            require(target not in ('', '.', '..') and '/' not in target, 'Local basename link required')
        else:
            require(row['kind'] == 'file' and member.isfile(), 'Regular file required')
            require(member.mode == row['mode'] and member.mode in (0o644, 0o755), 'Exact CMake file mode')
            require(member.size == row['bytes'] and 0 <= member.size <= 2 * 1024**3, 'File byte budget')
            total += member.size
            require(re.fullmatch('[0-9a-f]{64}', row['sha256']), 'File hash required')
        require(not any(str(a) in rows for a in p.parents if str(a) != '.'), 'File or link used as parent')
    require(total <= 2 * 1024**3, 'Total extracted byte budget')
    for row in rows.values():
        if row['kind'] != 'symlink':
            continue
        seen = set()
        current = row
        while current['kind'] == 'symlink':
            require(current['path'] not in seen and len(seen) < 8, 'Link cycle/depth')
            seen.add(current['path'])
            target = str(PurePosixPath(current['path']).parent / current['target'])
            require(target in rows, 'Undeclared link target')
            current = rows[target]
        require(current['kind'] == 'file', 'Regular link destination')
    return members, total


def extract(archive_path, receipt, manifest, prefix, dest):
    require(not dest.exists(), 'Fresh destination required')
    require(archive_path.stat().st_size == receipt['archive']['bytes'] <= 512 * 1024**2, 'Archive byte budget')
    require(digest(archive_path) == receipt['archive']['sha256'], 'Archive hash')
    with tarfile.open(archive_path, 'r:gz') as archive:
        members, total = validate_members(archive, receipt, manifest, prefix)
        require(shutil.disk_usage(dest.parent).free >= total + 128 * 1024**2, 'Extraction reserve')
        dest.mkdir(mode=0o755)
        rows = {r['path']: r for r in receipt['files']}
        for member in members:
            if member.issym():
                continue
            out = dest / member.name
            out.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as src, out.open('xb') as target:
                shutil.copyfileobj(src, target, 1024**2)
            out.chmod(member.mode)
            require(out.stat().st_size == member.size and digest(out) == rows[member.name]['sha256'], 'Extracted file identity')
        for member in members:
            if member.issym():
                out = dest / member.name
                out.parent.mkdir(parents=True, exist_ok=True)
                out.symlink_to(member.linkname)
    return total


def restore_graph(z, out):
    out.mkdir()
    for name in ['CMakeCache.txt', 'cmakeconfig.h']:
        data = z.read('graph/' + name)
        require(len(data) <= 1024**2, 'Configuration size')
        (out / name).write_bytes(data)
    receipt = json.loads(z.read('graph/compile_commands.json.parts.json'))
    require(receipt['encoding'] == 'ordered-gzip-parts' and 0 < receipt['rawBytes'] <= 128 * 1024**2, 'Graph budget')
    require(1 <= len(receipt['parts']) <= 4, 'Graph parts budget')
    target = out / 'compile_commands.json'
    with target.open('xb') as stream:
        for i, part in enumerate(receipt['parts']):
            require(part['file'] == f'compile_commands.json.part-{i:03d}.gz', 'Graph part order')
            data = z.read('graph/' + part['file'])
            require(len(data) == part['storedBytes'] <= 32 * 1024**2 and hashlib.sha256(data).hexdigest() == part['storedSha256'], 'Stored graph part')
            import io
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as raw:
                decoded = raw.read(32 * 1024**2 + 1)
                require(len(decoded) <= 32 * 1024**2 and not raw.read(1), 'Decoded graph budget')
            require(len(decoded) == part['rawBytes'] and hashlib.sha256(decoded).hexdigest() == part['rawSha256'], 'Raw graph part')
            stream.write(decoded)
    require(target.stat().st_size == receipt['rawBytes'] and digest(target) == receipt['rawSha256'], 'Complete graph identity')
    return receipt


def inspect_runtime(dest, receipt, recipe):
    elf = {}
    resources = []
    excluded = {}
    for row in receipt['files']:
        p = dest / row['path']
        if '/include/' in row['path'] or '/pkgconfig/' in row['path'] or '/share/gir-' in row['path']:
            excluded['/' + row['path']] = 'Development headers or build-time introspection metadata; not executable runtime payload'
        elif row['path'].endswith('/jsc'):
            excluded['/' + row['path']] = 'Standalone JavaScript developer shell, not invoked by the application'
        elif row['path'].endswith(('.so',)) and p.is_symlink():
            excluded['/' + row['path']] = 'Unversioned linker alias; runtime binds the exact real SONAME filename'
        elif row['kind'] == 'file' and p.open('rb').read(4) == b'\x7fELF':
            info = boundary.elf(p)
            require(info['searchPath'] == recipe['lib'], 'Actual final RPATH mismatch')
            mode = 0o644 if info['soname'] or p.name == 'libwebkit2gtkinjectedbundle.so' else 0o755
            require(row['mode'] == mode, 'Actual ELF role mode mismatch')
            elf['/' + row['path']] = {**info, 'sha256': row['sha256'], 'bytes': row['bytes'], 'mode': row['mode']}
        elif row['kind'] == 'file':
            require('/share/locale/' in row['path'] or '/girepository-1.0/' in row['path'], 'Unclassified CMake runtime resource: ' + row['path'])
            resources.append(row)
    require(len(elf) == 7, 'Exact two libraries, three helpers, bundle and driver')
    needed = sorted(set(n for e in elf.values() for n in e['needed']))
    private = {e['soname'] for e in elf.values() if e['soname']}
    require(private == {'libwebkit2gtk-4.1.so.0', 'libjavascriptcoregtk-4.1.so.0'}, 'Exact runtime SONAME family')
    return {'elf': elf, 'resources': resources, 'excludedEntries': excluded, 'directHostSonames': [n for n in needed if n not in private]}


def consume(runtime_zip, evidence_zip, output):
    require(not output.exists(), 'Fresh output required')
    require(runtime_zip.stat().st_size == 283921787 and digest(runtime_zip) == RUNTIME_SHA, 'Pinned runtime ZIP')
    require(evidence_zip.stat().st_size <= 64 * 1024**2 and digest(evidence_zip) == EVIDENCE_SHA, 'Pinned evidence ZIP')
    recipe = json.loads((HERE / 'qa-final-path-profile.json').read_text())
    require(recipe == boundary.profile(recipe['patchSha256']), 'Exact recipe')
    output.mkdir()
    with zipfile.ZipFile(runtime_zip) as z, zipfile.ZipFile(evidence_zip) as evidence:
        require(len(z.infolist()) == 3 and set(z.namelist()) == {'receipt.json', 'install_manifest.txt', 'normal-cmake-install.tar.gz'}, 'Exact runtime ZIP inventory')
        for name, limit in [('receipt.json', 1024**2), ('install_manifest.txt', 1024**2), ('normal-cmake-install.tar.gz', 512*1024**2)]:
            require(z.getinfo(name).file_size <= limit, 'ZIP member budget')
            with z.open(name) as src, (output / name).open('xb') as target:
                shutil.copyfileobj(src, target, 1024**2)
        receipt = json.loads((output / 'receipt.json').read_text())
        manifest = (output / 'install_manifest.txt').read_bytes()
        require(z.read('receipt.json') == evidence.read('normal-runtime/receipt.json') and manifest == evidence.read('normal-runtime/install_manifest.txt'), 'Cross-artifact install identity')
        require(receipt['archive']['sha256'] == TAR_SHA, 'Pinned inner runtime')
        result = json.loads(evidence.read('result.json'))
        require(result['status'] == 'passed-normal-engine-build-not-package' and result['harnessSha'] == HARNESS_SHA, 'Completed exact engine build')
        require(result['sourceArchiveSha256'] == recipe['sourceArchiveSha256'] and result['patchSha256'] == recipe['patchSha256'], 'Source/behavior identity')
        for name in ['normal-all-complete', 'normal-cmake-install']:
            steps = [s for s in result['steps'] if s['name'] == name]
            require(len(steps) == 1 and steps[0]['exitCode'] == 0, 'Complete normal build/install step')
            if name == 'normal-all-complete':
                require('stopReason' in steps[0] and steps[0]['stopReason'] is None, 'Build not forcibly stopped')
            else:
                require(steps[0]['timedOut'] is False, 'Install not timed out')
        graph = restore_graph(evidence, output / 'graph')
        config = output / 'graph/cmakeconfig.h'
        require(digest(config) == result['configuration']['configSha256'], 'Generated config identity')
        cache = output / 'graph/CMakeCache.txt'
        require(digest(cache) == result['configuration']['cacheSha256'], 'Configure cache identity')
        require(graph['rawSha256'] == result['compileDatabaseSha256'], 'Actual compile graph identity')
        values = boundary.cache_values(cache)
        for key, value in recipe['cmake'].items():
            require(values.get(key) == value, 'Configured recipe: ' + key)
        for key, value in [('ENABLE_2022_GLIB_API','0'), ('ENABLE_DEVELOPER_MODE','0'), ('ENABLE_BUBBLEWRAP_SANDBOX','1'), ('HAVE_GTK_UNIX_PRINTING','1')]:
            require(re.findall(r'^#define '+key+r'\s+(\S+)\s*$', config.read_text(), re.M) == [value], 'Generated feature: '+key)
        require(re.findall(r'^#define WEBKITGTK_API_VERSION\s+"([^"]+)"',config.read_text(),re.M)==['4.1'], 'Generated API')
    total = extract(output / 'normal-cmake-install.tar.gz', receipt, manifest, recipe['prefix'], output / 'destdir')
    report = {'status': 'authenticated-staging-not-package-or-native-accepted', 'runtimeArtifactId': 14265020653, 'runtimeZipSha256': RUNTIME_SHA, 'evidenceArtifactId': 14264011071, 'evidenceZipSha256': EVIDENCE_SHA, 'buildRun': 43921562333, 'harnessSha': HARNESS_SHA, 'sourceArchiveSha256': recipe['sourceArchiveSha256'], 'patchSha256': recipe['patchSha256'], 'prefix': recipe['prefix'], 'fileCount': len(receipt['files']), 'rawBytes': total, 'compileGraphSha256': graph['rawSha256'], **inspect_runtime(output/'destdir', receipt, recipe), 'notExecuted': ['Application build/binding', 'Installed runtime process mappings and default sandbox', 'Same-package PDF and daily use', 'Installation/upgrade/recovery/uninstall'], 'remainingBoundaries': ['Host transitive dependencies and symbol versions on Ubuntu 26.04', 'Build-derived static dependency/license inventory and SBOM', 'Application resources and final-prefix package assembly', 'Runtime-loaded modules and resources', 'Security maintenance ownership and supported distribution delivery']}
    (output / 'intake.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('runtime_zip',type=Path);p.add_argument('evidence_zip',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    result=consume(a.runtime_zip,a.evidence_zip,a.output)
    print(result['status'])

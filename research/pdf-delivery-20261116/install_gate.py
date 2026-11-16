"""Non-installing QA entrance: CMake provenance -> staged boundary -> installed bytes.
No package manager invocation, payload execution, loader overrides or chmod/chown.
Synthetic tests validate rejection logic only; CLI requires real independent inputs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile
import tempfile
import threading
import sys

import package_boundary as boundary

APPLICATION_SHA = '546796b005390642ee5cc655440b4b350a730717'
RUNTIME_ROLES = {'webkit', 'javascriptcore', 'web-process', 'network-process',
                 'gpu-process', 'injected-bundle', 'qa-driver', 'resource'}
FORBIDDEN_ENV = {'LD_LIBRARY_PATH', 'LD_PRELOAD', 'WEBKIT_INJECTED_BUNDLE_PATH',
                 'WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS', 'MILKUP_RESEARCH_RUNTIME_PREFIX',
                 'WEBKIT_EXEC_PATH', 'WEBKIT_FORCE_SANDBOX'}


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def absolute(text):
    require(isinstance(text, str) and '\x00' not in text and '\n' not in text, 'Invalid path')
    p = PurePosixPath(text)
    require(p.is_absolute() and '..' not in p.parts and str(p) == text, 'Noncanonical absolute path')
    return p


def read_install_manifest(path, prefix):
    require(path.stat().st_size <= 4 * 1024 * 1024, 'CMake manifest size budget')
    lines = path.read_text().splitlines()
    require(0 < len(lines) <= 20000 and len(lines) == len(set(lines)), 'CMake manifest count/duplicate')
    prefix = absolute(prefix)
    for line in lines:
        require(absolute(line).is_relative_to(prefix), 'CMake destination outside exact prefix')
    return set(lines)


def cmake_source(destdir, name, entries, prefix):
    """Validate the final regular file of a declared install-time link chain."""
    require(name in entries and absolute(name).is_relative_to(absolute(prefix)), 'Undeclared CMake source')
    p = destdir / name.lstrip('/')
    for parent in p.parents:
        if parent == destdir:
            break
        require(not parent.is_symlink(), 'CMake directory alias')
    info = p.lstat()
    require(not info.st_mode & 0o7022, 'Unsafe CMake source mode')
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'CMake source must be a unique regular file')
    return p


def resolve_cmake_file(destdir, name, entries, prefix):
    # Separate link resolution from permission checks: symlink 0777 is not write permission.
    current = str(absolute(name)); seen = []
    for _ in range(8):
        require(current in entries and absolute(current).is_relative_to(absolute(prefix)),
                'CMake source or symlink target outside declared prefix')
        require(current not in seen, 'CMake symlink cycle')
        seen.append(current)
        p = destdir / current.lstrip('/')
        for parent in p.parents:
            if parent == destdir:
                break
            require(not parent.is_symlink(), 'CMake directory alias')
        if p.is_symlink():
            target = os.readlink(p)
            require(not PurePosixPath(target).is_absolute() and '..' not in PurePosixPath(target).parts,
                    'Only local non-parent CMake file symlinks allowed')
            current = str(absolute(str(PurePosixPath(current).parent / target)))
            continue
        final = cmake_source(destdir, current, entries, prefix)
        return final, seen
    raise ValueError('CMake symlink depth')


def bind_staging(stage, destdir, recipe, manifest, install_manifest, cache, commands, config):
    require(not sys.flags.optimize, 'Boundary assertions must not be disabled')
    require(manifest['applicationSourceSha'] == manifest['sourceSha'] == APPLICATION_SHA, 'Unvalidated application source candidate')
    proof = manifest['cmakeInstall']
    require(proof['manifestSha256'] == digest(install_manifest), 'CMake install manifest identity')
    require(proof['cacheSha256'] == digest(cache), 'CMake cache identity')
    entries = read_install_manifest(install_manifest, recipe['prefix'])
    require(destdir.is_dir() and destdir.resolve() == destdir and stage.resolve() == stage,
            'Canonical independent staging roots')
    require(not stage.is_relative_to(destdir) and not destdir.is_relative_to(stage),
            'Assembled package cannot alias CMake DESTDIR')
    result = boundary.audit(stage, recipe, manifest, cache, commands, config)
    origins = []
    used = set()
    for row in manifest['files']:
        if row['role'] not in RUNTIME_ROLES:
            continue
        source, chain = resolve_cmake_file(destdir, row['path'], entries, recipe['prefix'])
        require(source.stat().st_size == row['bytes'] and digest(source) == row['sha256'],
                'CMake-installed source differs from staged runtime')
        require((source.stat().st_mode & 0o777) == ((stage / row['path'].lstrip('/')).stat().st_mode & 0o777),
                'Staging changed runtime mode')
        origins.append({'path': row['path'], 'installChain': chain, 'sha256': row['sha256']})
        used.update(chain)
    # Account for every excluded SDK/development path individually, with review rationale.
    omitted = proof['excludedEntries']
    require(isinstance(omitted, dict) and set(omitted) == entries - used,
            'Every CMake-installed file must be included or explicitly reviewed')
    require(all(isinstance(reason, str) and len(reason.strip()) >= 12 for reason in omitted.values()),
            'CMake exclusions require specific review rationale')
    return {'schema': 1, 'status': 'staging-origin-bound-not-installed',
            'applicationSourceSha': APPLICATION_SHA, 'prefix': recipe['prefix'],
            'cmakeManifestSha256': digest(install_manifest), 'origins': origins,
            'excludedEntries': omitted, 'boundary': result}


def package_entries(tar, manifest):
    rows = {r['path']: r for r in manifest['files']}
    found = set()
    seen = set()
    total = 0
    for member in tar:
        name = member.name[2:] if member.name.startswith('./') else member.name
        if name in ('', '.') and member.isdir():
            continue
        require(not name.startswith('/') and '..' not in PurePosixPath(name).parts, 'Package path escape')
        name = '/' + name
        require(str(absolute(name)) == name, 'Noncanonical package path')
        require(name not in seen, 'Duplicate package entry')
        seen.add(name)
        if member.isdir():
            require(any(p.startswith(name.rstrip('/') + '/') for p in rows), 'Unexpected package directory')
            require(member.uid == 0 and member.gid == 0 and member.mode == 0o755, 'Unsafe package directory')
            continue
        require(member.isfile() and name in rows and name not in found, 'Extra/link/duplicate package payload')
        require(member.uid == 0 and member.gid == 0 and not member.mode & 0o7022, 'Unsafe package ownership/mode')
        row = rows[name]
        require(member.size == row['bytes'] and member.size <= 2 * 1024**3, 'Package size mismatch/budget')
        total += member.size
        require(total <= 4 * 1024**3, 'Package unpacked budget')
        require(hashlib.file_digest(tar.extractfile(member), 'sha256').hexdigest() == row['sha256'], 'Package payload hash')
        required_mode = 0o644 if row['role'] in {'resource', 'license', 'sbom'} else 0o755
        require(member.mode == required_mode, 'Exact package role mode')
        found.add(name)
    require(found == set(rows), 'Missing package payload')
    return len(found)


def protected(path):
    """Check each actual parent, UID/mode and effective-user ACL access; never change it."""
    for p in [*reversed(path.parents), path]:
        st = p.lstat()
        require(not stat.S_ISLNK(st.st_mode), 'Installed prefix alias')
        require(st.st_uid == 0 and not st.st_mode & 0o7022, 'Installed path not root-owned/protected')
        require(not os.access(p, os.W_OK, effective_ids=True), 'Installed path writable by this ordinary user')


def installed(manifest, recipe, package, receipt, application, driver):
    require(not sys.flags.optimize, 'Boundary assertions must not be disabled')
    require(os.geteuid() != 0, 'Installed gate must run as ordinary user')
    require(not any(os.environ.get(k) for k in FORBIDDEN_ENV), 'Loader/sandbox override forbidden')
    require(manifest['applicationSourceSha'] == manifest['sourceSha'] == APPLICATION_SHA, 'Wrong installed application source')
    require(recipe == boundary.profile(recipe['patchSha256']), 'Exact final profile required')
    require(receipt['status'] == 'staging-origin-bound-not-installed', 'Successful staging origin gate required')
    require(receipt['prefix'] == recipe['prefix'] and receipt['applicationSourceSha'] == APPLICATION_SHA,
            'Staging receipt identity')
    require(receipt['manifestSha256'] == hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'Staging receipt manifest binding')
    wanted = manifest['installer']
    require(package.name == wanted['name'] and Path(wanted['name']).name == wanted['name'], 'Exact package filename')
    require(package.stat().st_size == wanted['bytes'] and digest(package) == wanted['sha256'], 'Exact package bytes required')
    # Read data only, with a bounded subprocess. Never invoke dpkg installation or payload code.
    with tempfile.TemporaryFile() as error:
        proc = subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(package)], stdout=subprocess.PIPE, stderr=error)
        expired = threading.Event()
        def stop():
            expired.set()
            if proc.poll() is None:
                proc.kill()
        timer = threading.Timer(60, stop); timer.start()
        try:
            with tarfile.open(fileobj=proc.stdout, mode='r|') as tar:
                count = package_entries(tar, manifest)
            proc.stdout.close()
            require(proc.wait(timeout=30) == 0 and not expired.is_set(), 'dpkg-deb data stream failed or timed out')
        finally:
            timer.cancel()
            if proc.poll() is None:
                proc.kill(); proc.wait(timeout=5)
    expected = {r['role']: r['path'] for r in manifest['files'] if r['role'] in {'application', 'qa-driver'}}
    require(str(application) == expected['application'] and str(driver) == expected['qa-driver'], 'Application/driver exact final paths')
    prefix = Path(recipe['prefix']); protected(prefix)
    actual = {str(p) for p in prefix.rglob('*') if not p.is_dir()}
    require(actual == {r['path'] for r in manifest['files']}, 'Installed closure extra/missing entries')
    for p in prefix.rglob('*'):
        protected(p)
    elf = {}
    for row in manifest['files']:
        p = Path(row['path']); s = p.stat()
        expected_mode = 0o644 if row['role'] in {'resource', 'license', 'sbom'} else 0o755
        require(s.st_gid == 0 and stat.S_IMODE(s.st_mode) == expected_mode, 'Installed role ownership/mode')
        require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size == row['bytes'] and digest(p) == row['sha256'], 'Installed payload identity')
        if row['role'] not in {'resource', 'license', 'sbom'}:
            elf[row['role']] = boundary.elf(p)
            require(elf[row['role']]['searchPath'] == recipe['lib'], 'Installed ELF loader path')
    return {'schema': 1, 'status': 'installed-bytes-and-protection-only-not-native-accepted',
            'uid': os.geteuid(), 'packageSha256': wanted['sha256'], 'payloadCount': count,
            'applicationSourceSha': APPLICATION_SHA, 'prefix': str(prefix),
            'application': str(application), 'nativeDriver': str(driver), 'elf': elf,
            'pending': ['ordinary launch and actual PID/birth/library mappings', 'default sandbox',
                        'same-package PDF 15 cases', 'IME/edit/#255/external reload/normal exit',
                        'package control/maintainer-script review and upgrade/recovery/uninstall', 'security-maintenance approval']}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('mode', choices=['stage', 'installed'])
    p.add_argument('--manifest', required=True, type=Path)
    p.add_argument('--recipe', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    for name in ['stage', 'destdir', 'install-manifest', 'cache', 'commands', 'config', 'package', 'receipt', 'application', 'driver']:
        p.add_argument('--' + name, type=Path)
    a = p.parse_args()
    require(not a.output.exists(), 'Never overwrite previous gate evidence')
    result = {'schema': 1, 'status': 'failed', 'mode': a.mode}
    try:
        manifest = json.loads(a.manifest.read_text()); recipe = json.loads(a.recipe.read_text())
        if a.mode == 'stage':
            result = bind_staging(a.stage, a.destdir, recipe, manifest, a.install_manifest, a.cache, a.commands, a.config)
            result['manifestSha256'] = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        else:
            require(a.package.resolve().parent == a.manifest.resolve().parent, 'Native manifest must reside beside exact package')
            result = installed(manifest, recipe, a.package, json.loads(a.receipt.read_text()), a.application, a.driver)
            result['nativePackageManifest'] = str(a.manifest.resolve())
    except Exception as error:
        result['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        with a.output.open('x') as stream:
            json.dump(result, stream, indent=2); stream.write('\n')
    print(result['status'])


if __name__ == '__main__':
    main()

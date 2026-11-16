"""Normal upstream all-target completion and separate CMake DESTDIR retention.
Never turns an object checkpoint into a runtime artifact or installed package.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import stat
import tarfile

PINNED_MANIFEST_SHA = '8b93cf05e949f240f9484bcb93f77ed67f3f746b300e32b71a868fbed82d9295'
PINNED_ARCHIVE_SHA = '779c8abe048660286e79828f54eec7d3d56f7350c042171230f97be9bd6a1f20'
PINNED_PRODUCER = '9dbb2062faa983185b993f8b8f7681ee769a70f6'
REPO_PREFIX = '/home/runner/work/milkup/milkup/'
REVIEWED_HARNESS = {
    'research/pdf-delivery-20261116/current_engine.py': '11d5eff965458f52cd3925c1742ac9ae0e28fbc4886ecd90b6131583bba0ad74',
    'research/pdf-delivery-20261116/package_boundary.py': '61670f6af6f5c8c2a9b3f14bb9e40c0b0a77b743fc2c827f973f28d85f05ad9c',
    '.github/workflows/linux-webkit-build-research.yml': 'a345c7d58e5b9281bccb67977b5dc117cc94a873234ae8eda67499aaad84c4c4',
}
NEW_HARNESS = REPO_PREFIX + 'research/pdf-delivery-20261116/normal_completion.py'


def sha(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def pinned(path):
    assert sha(path) == PINNED_MANIFEST_SHA, 'Exact reviewed predecessor manifest'
    value = json.loads(gzip.decompress(path.read_bytes()))
    assert value['producerSha'] == PINNED_PRODUCER
    assert value['compiledObjectCount'] == 367 and value['pchCount'] == 2
    assert not value['runtimeBytesArchived'] and not value['pchBytesArchived']
    return value


def reviewed_identity(old, current):
    """Explicit harness-only migration; never drop compiled input/config/tool checks.
    Return incompatibility before build writes so a valid but unusable cache can be
    skipped for the already-authorized original normal build in this same clean job.
    """
    assert old.keys() == current.keys(), 'Unexpected frontier identity schema'
    previous = old['harnessFiles']; actual = current['harnessFiles']
    assert actual.keys() == previous.keys() | {NEW_HARNESS}, 'Unreviewed harness file set'
    changes = {}
    for name, digest in previous.items():
        if digest == actual[name]:
            continue
        assert name.startswith(REPO_PREFIX)
        relative = name[len(REPO_PREFIX):]
        assert REVIEWED_HARNESS.get(relative) == digest, 'Unreviewed predecessor harness change'
        changes[name] = {'before': digest, 'after': actual[name]}
    changes[NEW_HARNESS] = {'before': None, 'after': actual[NEW_HARNESS]}
    incompatible = [k for k in old if k != 'harnessFiles' and old[k] != current[k]]
    return {'reviewedHarnessChanges': changes, 'incompatibleCompiledIdentityFields': incompatible}


def native_all_arguments():
    # Preserve the upstream graph and its link pool; two jobs globally. Shared
    # libraries can be genuine prerequisites of generated headers/object targets.
    return ['ninja', '-v', '-d', 'keepdepfile', '-k', '0', '-j', '2', 'all']


def stage_inventory(destdir, prefix, install_manifest):
    destdir = destdir.resolve(); prefix = Path(prefix)
    assert prefix.is_absolute() and '..' not in prefix.parts
    lines = install_manifest.read_text().splitlines()
    assert 0 < len(lines) <= 20000 and len(lines) == len(set(lines))
    listed = set(lines)
    assert all(Path(p).is_relative_to(prefix) and '..' not in Path(p).parts for p in listed)
    rows = []
    for file in sorted(destdir.rglob('*')):
        if file.is_dir() and not file.is_symlink():
            continue
        relative = file.relative_to(destdir); name = '/' + str(relative)
        assert name in listed, 'Undeclared CMake staged output'
        info = file.lstat()
        if file.is_symlink():
            target = os.readlink(file)
            assert not Path(target).is_absolute() and '..' not in Path(target).parts
            resolved = file.resolve(); assert resolved.is_relative_to(destdir / str(prefix).lstrip('/'))
            assert resolved.is_file()
            rows.append({'path': str(relative), 'kind': 'symlink', 'target': target})
        else:
            assert stat.S_ISREG(info.st_mode) and not info.st_mode & 0o7022 and info.st_nlink == 1
            rows.append({'path': str(relative), 'kind': 'file', 'bytes': info.st_size,
                         'sha256': sha(file), 'mode': stat.S_IMODE(info.st_mode)})
    assert {'/' + r['path'] for r in rows} == listed, 'CMake install manifest/payload mismatch'
    assert sum(r.get('bytes', 0) for r in rows) <= 6 * 1024**3, 'Runtime retention raw budget'
    required = [str(prefix).lstrip('/') + '/' + suffix for suffix in [
        'bin/WebKitWebDriver',
        'lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess',
        'lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess',
        'lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitGPUProcess']]
    assert all(any(r['path'] == p and r['kind'] == 'file' for r in rows) for p in required), 'Required matching installed helpers/driver'
    return rows


def archive_stage(destdir, rows, output):
    assert not output.exists()
    with tarfile.open(output, 'w:gz', compresslevel=1) as archive:
        for row in rows:
            file = destdir / row['path']
            if row['kind'] == 'file':
                assert file.is_file() and not file.is_symlink() and sha(file) == row['sha256']
            else:
                assert file.is_symlink() and os.readlink(file) == row['target']
            archive.add(file, arcname=row['path'], recursive=False)
    assert output.stat().st_size <= 3 * 1024**3, 'Runtime retention compressed budget'
    return {'sha256': sha(output), 'bytes': output.stat().st_size}


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('destdir', type=Path); p.add_argument('prefix')
    p.add_argument('install_manifest', type=Path); p.add_argument('output', type=Path)
    a = p.parse_args()
    assert not a.output.exists(); a.output.mkdir()
    rows = stage_inventory(a.destdir, a.prefix, a.install_manifest)
    (a.output / 'install_manifest.txt').write_bytes(a.install_manifest.read_bytes())
    receipt = {'scope': 'normal-cmake-staged-runtime-not-application-package-or-native-accepted',
               'prefix': a.prefix, 'files': rows, 'runtimeBytesIncluded': True,
               'objectCheckpoint': False, 'installManifestSha256': sha(a.install_manifest)}
    receipt['archive'] = archive_stage(a.destdir, rows, a.output / 'normal-cmake-install.tar.gz')
    (a.output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

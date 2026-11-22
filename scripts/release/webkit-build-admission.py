"""Read-only Ubuntu engine admission. Never downloads, installs, compiles or uploads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

BASELINE = '209c3fcd3baab736dd8ad204e33cce739396b027'
GIB = 1024 ** 3
REQUEST_PATH = 'release/webkit-admission-request.json'
SOURCE = '2779c1b46f88762e8400650271ba14452dc4e30b37059981552d8b562b7d0862'
PATCH = '855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5'
TOOLS = ['python3', 'cmake', 'ninja', 'clang-19', 'clang++-19', 'ld', 'ar', 'readelf', 'pkg-config', 'ruby', 'perl', 'bison', 'flex', 'gperf', 'unifdef', 'gpgv', 'dpkg-deb']
MODULES = ['gtk+-3.0', 'gtk+-unix-print-3.0', 'libsoup-3.0', 'glib-2.0', 'gio-2.0', 'icu-uc', 'icu-i18n', 'harfbuzz', 'freetype2', 'fontconfig', 'gstreamer-1.0', 'gstreamer-pbutils-1.0', 'gstreamer-mpegts-1.0', 'libgcrypt', 'libxml-2.0', 'libxslt', 'sqlite3', 'libpng', 'libjpeg', 'libwebp', 'libavif', 'libjxl', 'lcms2', 'libdrm', 'gbm', 'epoxy', 'libseccomp', 'libsystemd']
NAMESPACE_ARGS = ['--unshare-user', '--unshare-pid', '--unshare-uts', '--unshare-net', '--die-with-parent', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '/bin/true']


def command(args, cwd=None):
    # Only fixed public tool/package queries; never dump env, config secrets or log payloads.
    clean_env = {key: os.environ[key] for key in ['PATH', 'HOME', 'LANG', 'TMPDIR'] if key in os.environ}
    r = subprocess.run(args, cwd=cwd, env=clean_env, text=True, capture_output=True, timeout=20)
    if len(r.stdout) + len(r.stderr) > 1024 ** 2:
        raise ValueError('Query output budget')
    return r


def git(repo, *args):
    r = command(['git', *args], repo)
    if r.returncode:
        raise ValueError('Git identity query failed')
    return r.stdout.strip()


def validate_request(request, context, head, parents, changed):
    expected = {'schemaVersion': 1, 'mode': 'capacity-sdk-native-preflight-only', 'sourceVersion': '2.54.3', 'sourceSha256': SOURCE, 'patchSha256': PATCH}
    if set(request) != set(expected) | {'expectedParentSha', 'requestId'}:
        raise ValueError('Exact request fields required')
    if any(request[k] != v for k, v in expected.items()):
        raise ValueError('Locked source and mode required')
    if not re.fullmatch('[a-f0-9]{40}', request['expectedParentSha']):
        raise ValueError('Exact parent required')
    if not re.fullmatch('[a-f0-9]{32}', request['requestId']):
        raise ValueError('Unique bounded request ID required')
    if context != {'repository': 'Auto-Plugin/milkup', 'ref': 'refs/heads/v2', 'event': 'push', 'sha': head, 'before': BASELINE}:
        raise ValueError('Exact v2 push identity required')
    if not re.fullmatch('[a-f0-9]{40}', head) or parents != [request['expectedParentSha']]:
        raise ValueError('Single exact reviewed parent required')
    if changed != [REQUEST_PATH]:
        raise ValueError('Only the explicit request may change in trigger commit')
    return expected


def validate_checkout(repo, context):
    if git(repo, 'status', '--porcelain'):
        raise ValueError('Clean checkout required')
    head = git(repo, 'rev-parse', 'HEAD')
    parents = git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split()[1:]
    if git(repo, 'rev-parse', 'HEAD~2') != BASELINE:
        raise ValueError('Exact two-commit reviewed fast-forward required')
    path = repo / REQUEST_PATH
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
        raise ValueError('Bounded regular request required')
    request = json.loads(path.read_text())
    changed = git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').splitlines()
    validate_request(request, context, head, parents, changed)
    return {'checkoutSha': head, 'parentSha': parents[0], 'requestId': request['requestId'], 'requestSha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def read_os_release(path=Path('/etc/os-release')):
    return {k: v.strip('"') for k, v in (line.split('=', 1) for line in path.read_text().splitlines() if '=' in line and not line.startswith('#'))}


def resources(work):
    disk = os.statvfs(work)
    mem = {k: int(v.strip().split()[0]) * 1024 for k, v in (line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines()) if k in ['MemTotal', 'MemAvailable']}
    limits = []
    for p in [Path('/sys/fs/cgroup/memory.max'), Path('/sys/fs/cgroup/memory/memory.limit_in_bytes')]:
        if p.is_file():
            value = p.read_text().strip()
            if value.isdigit():
                limits.append(int(value))
    return {'diskFreeBytes': disk.f_bavail * disk.f_frsize, 'freeInodes': disk.f_favail, 'memoryTotalBytes': mem['MemTotal'], 'memoryAvailableBytes': mem['MemAvailable'], 'memoryEffectiveLimitBytes': min([mem['MemTotal'], *limits]), 'cpuAffinityCount': len(os.sched_getaffinity(0))}


def evaluate_capacity(os_release, arch, uid, measured):
    reasons = []
    if os_release.get('ID') != 'ubuntu' or os_release.get('VERSION_ID') != '26.04': reasons.append('requires-ubuntu-26.04')
    if arch != 'x86_64': reasons.append('requires-amd64')
    if uid == 0: reasons.append('ordinary-user-required')
    for field, minimum in [('diskFreeBytes', 60 * GIB), ('freeInodes', 200000), ('memoryEffectiveLimitBytes', 14 * GIB), ('memoryAvailableBytes', 10 * GIB), ('cpuAffinityCount', 2)]:
        if measured[field] < minimum: reasons.append('insufficient-' + field)
    return reasons


def toolchain():
    tools, modules, missing = {}, {}, []
    for name in TOOLS:
        path = shutil.which(name)
        if path is None:
            missing.append('tool:' + name)
        else:
            actual = Path(path).resolve()
            with actual.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            tools[name] = {'path': str(actual), 'sha256': digest}
    pkg = shutil.which('pkg-config')
    for name in MODULES:
        r = command([pkg, '--modversion', name]) if pkg else None
        if r is None or r.returncode:
            missing.append('pkg-config:' + name)
        else:
            version = r.stdout.strip()
            if not re.fullmatch('[0-9A-Za-z.+~_-]{1,100}', version):
                raise ValueError('Invalid package version query')
            modules[name] = version
    return {'tools': tools, 'modules': modules, 'missing': missing, 'completeSdkProven': False, 'note': 'Required baseline only; exact signed Ubuntu package provenance, full feature closure and real generated configuration still required'}


def native_preflight(enabled):
    result = {'status': 'not-run', 'fullWebProcessOrDisplayVerified': False, 'networkNamespaceRequired': True}
    if not enabled: return result
    bwrap = shutil.which('bwrap')
    display = shutil.which('Xvfb')
    driver = shutil.which('WebKitWebDriver')
    result.update({'bwrapPresent': bool(bwrap), 'isolatedDisplayToolPresent': bool(display), 'driverPresent': bool(driver)})
    if not bwrap:
        result['status'] = 'blocked-missing-bwrap'
        return result
    r = command([bwrap, *NAMESPACE_ARGS])
    # Preserve bounded diagnostic for this deliberately trivial namespace command only.
    result.update({'namespaceExitCode': r.returncode, 'namespaceDiagnostic': ('netlink-route-denied' if 'NETLINK_ROUTE' in r.stderr and 'Operation not permitted' in r.stderr else 'namespace-not-permitted' if 'Operation not permitted' in r.stderr else 'uid-map-read-only' if 'uid_map' in r.stderr and 'Read-only' in r.stderr else 'none' if r.returncode == 0 else 'other-error-details-withheld'), 'status': 'namespace-prerequisite-passed-not-native-accepted' if r.returncode == 0 else 'blocked-namespace'})
    if r.returncode == 0 and (not display or not driver): result['status'] = 'blocked-display-or-driver'
    return result


def probe(work, check_native=False):
    release = read_os_release()
    measured = resources(work)
    reasons = evaluate_capacity(release, platform.machine(), os.getuid(), measured)
    sdk = toolchain()
    reasons += sdk['missing']
    return {'schemaVersion': 1, 'status': 'blocked' if reasons else 'capacity-and-baseline-sdk-observed-not-engine-admission', 'blockingReasons': reasons, 'os': {k: release.get(k) for k in ['ID', 'VERSION_ID', 'VERSION']}, 'resources': measured, 'sdk': sdk, 'native': native_preflight(check_native), 'engineBuildAdmitted': False, 'checkpointRestoreProven': False, 'sourceOrPatchDownloaded': False, 'buildExecuted': False, 'releaseReady': False}


def sanitized(result):
    return {key: result[key] for key in ['schemaVersion', 'status', 'blockingReasons', 'os', 'resources', 'native', 'engineBuildAdmitted', 'checkpointRestoreProven', 'sourceOrPatchDownloaded', 'buildExecuted', 'releaseReady', 'checkout']} | {'sdk': {'missing': result['sdk']['missing'], 'observedToolCount': len(result['sdk']['tools']), 'observedModuleCount': len(result['sdk']['modules']), 'completeSdkProven': False}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--native-preflight', action='store_true')
    args = parser.parse_args()
    identity = None
    if args.repo:
        context = {'repository': os.environ.get('GITHUB_REPOSITORY'), 'ref': os.environ.get('GITHUB_REF'), 'event': os.environ.get('GITHUB_EVENT_NAME'), 'sha': os.environ.get('GITHUB_SHA'), 'before': os.environ.get('MILKUP_PUSH_BEFORE')}
        identity = validate_checkout(args.repo, context)
    result = probe(args.work, args.native_preflight)
    result['checkout'] = identity
    print(json.dumps(sanitized(result), indent=2))
    raise SystemExit(1 if result['blockingReasons'] or result['native']['status'].startswith('blocked') else 0)

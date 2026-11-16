"""Bounded real app/embedded-guard compilation; never install or run the app.

Uses only the retained normal runtime, exact product checkout and derived SDK.
The upload directory contains explicit build receipts/logs, not source audits.
"""
import argparse
import hashlib
import json
import mmap
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import zipfile

import app_sdk_binding as sdk
import runtime_intake as intake

RETAINED_SHA = '9904f4221d23ad70079fa8b8013539dfdecb661877be85c24ae8a2a08cc0aa2e'
RETAINED_BYTES = 300171844
TOTAL_SECONDS = 3000
GUARDS = {'plugin_dom_guard.c': 'libmilkup_dom_guard.so', 'output_guard.c': 'libmilkup_output_guard.so'}
require = intake.require
digest = intake.digest


def receive(archive, output):
    require(not output.exists(), 'Fresh retained-input directory')
    require(archive.stat().st_size == RETAINED_BYTES and digest(archive) == RETAINED_SHA,
            'Exact retained artifact 14264654984')
    expected = {'runtime-original.zip': (283921787, intake.RUNTIME_SHA),
                'evidence-original.zip': (16249482, intake.EVIDENCE_SHA), 'SHA256SUMS': (175, None)}
    with zipfile.ZipFile(archive) as z:
        require(len(z.infolist()) == 3 and set(z.namelist()) == set(expected), 'Retained exact inventory')
        output.mkdir()
        for name, (size, checksum) in expected.items():
            require(z.getinfo(name).file_size == size, 'Retained member size')
            with z.open(name) as src, (output/name).open('xb') as dst:
                shutil.copyfileobj(src, dst, 1024**2)
            if checksum:
                require(digest(output/name) == checksum, 'Original inner ZIP identity')
    return {'artifactId': 14264654984, 'sha256': RETAINED_SHA,
            'runtimeZipSha256': intake.RUNTIME_SHA, 'evidenceZipSha256': intake.EVIDENCE_SHA}


def capture_cc(args):
    """CC shim delegates unchanged to cc; captures only the two real guard calls."""
    selected = [x for x in args if Path(x).name in GUARDS]
    record = None
    if selected:
        require(len(selected) == 1 and args.count('-o') == 1, 'One real guard output')
        source = Path(selected[0]).resolve()
        root = Path(os.environ['MILKUP_COMPILE_SOURCE']).resolve()
        require(source == root/'apps/desktop/src-tauri/src'/source.name, 'Exact guard input')
        target = Path(args[args.index('-o')+1]).resolve()
        capture = Path(os.environ['MILKUP_COMPILE_CAPTURE']).resolve()
        require(target.is_relative_to(capture.parent/'cargo-target') and target.name == GUARDS[source.name],
                'Guard output belongs to this fresh Cargo build')
        require(not target.exists(), 'No stale guard output')
        record = {'source': str(source), 'sourceSha256': digest(source), 'output': str(target),
                  'argv': ['/usr/bin/cc', *args]}
    p = subprocess.run(['/usr/bin/cc', *args])
    if record is not None:
        record['exitCode'] = p.returncode
        if p.returncode == 0:
            require(target.is_file() and not target.is_symlink(), 'Actual guard output')
            record.update(sha256=digest(target), bytes=target.stat().st_size)
        # One build.rs invocation compiles each guard once. A second invocation
        # fails evidence collection rather than silently selecting a stale ELF.
        with (capture/(source.name+'.json')).open('x') as out:
            json.dump(record, out, indent=2); out.write('\n')
    return p.returncode


def verify_link(info, final_lib, role):
    require(info['searchPath'] == final_lib, 'Exact final runtime RPATH: '+role)
    require('libwebkit2gtk-4.1.so.0' in info['needed'], 'Explicit WebKit API4.1 dependency: '+role)
    family = {n for n in info['needed'] if 'webkit' in n.lower() or 'javascriptcore' in n.lower()}
    require(family <= {'libwebkit2gtk-4.1.so.0', 'libjavascriptcoregtk-4.1.so.0'}, 'No other runtime family')


def verify_embedded(application, guard):
    require(0 < guard.stat().st_size <= 16*1024**2 and application.stat().st_size <= 512*1024**2,
            'Bounded application/guard ELF')
    data = guard.read_bytes()
    with application.open('rb') as src, mmap.mmap(src.fileno(), 0, access=mmap.ACCESS_READ) as image:
        first = image.find(data)
        require(first >= 0 and image.find(data, first+1) == -1, 'Exact compiled guard embedded once')
    return {'offset': first, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class Build:
    def __init__(self, source, runtime, output):
        require(not output.exists(), 'Fresh compile evidence/build directory')
        output.mkdir(); self.source = source; self.runtime = runtime; self.output = output
        self.evidence = output/'evidence'; self.evidence.mkdir()
        self.payload = output/'compiled-not-package'; self.payload.mkdir()
        self.deadline = time.monotonic()+TOTAL_SECONDS
        self.report = {'status': 'not-started', 'applicationSourceSha': sdk.install_gate.APPLICATION_SHA,
                       'runtimeZipSha256': intake.RUNTIME_SHA, 'hardBudgetSeconds': TOTAL_SECONDS,
                       'steps': [], 'installed': False, 'runtimeExecuted': False,
                       'completeSbom': False, 'releaseReady': False,
                       'notRun': ['Installation', 'Actual process mappings/default sandbox',
                                  'Native PDF/printing/editor acceptance', 'Complete SBOM/release approval']}
        self.persist()

    def persist(self):
        (self.evidence/'result.json').write_text(json.dumps(self.report, indent=2)+'\n')

    def run(self, name, args, environment, seconds):
        limit = min(seconds, self.deadline-time.monotonic())
        require(limit > 0, 'Total build deadline reached before '+name)
        row = {'name': name, 'argv': args, 'budgetSeconds': limit}; self.report['steps'].append(row); self.persist()
        started = time.monotonic(); stop = None; log = self.evidence/(name+'.log')
        with log.open('xb') as stream:
            p = subprocess.Popen(args, cwd=self.source, env=environment, stdout=stream,
                                 stderr=subprocess.STDOUT, start_new_session=True)
            try:
                while p.poll() is None:
                    if time.monotonic()-started >= limit: stop = 'deadline'
                    elif log.stat().st_size > 32*1024**2: stop = 'bounded-build-log'
                    elif shutil.disk_usage(self.output).free < 2*1024**3: stop = 'disk-reserve'
                    if stop:
                        os.killpg(p.pid, signal.SIGTERM)
                        try: p.wait(timeout=10)
                        except subprocess.TimeoutExpired: pass
                        # Also stop children remaining after their parent exits.
                        try: os.killpg(p.pid, signal.SIGKILL)
                        except ProcessLookupError: pass
                        p.wait(timeout=10); break
                    time.sleep(0.5)
            finally:
                if p.poll() is None:
                    try: os.killpg(p.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    p.wait(timeout=10)
                row.update(exitCode=p.returncode, stopReason=stop, durationSeconds=time.monotonic()-started,
                           logBytes=log.stat().st_size, logSha256=digest(log))
                self.persist()
        require(p.returncode == 0 and stop is None, 'Build step failed: '+name)

    def execute(self):
        try:
            require(os.getuid() != 0 and os.environ.get('GITHUB_ACTIONS') == 'true'
                    and os.environ.get('GITHUB_REPOSITORY') == 'Auto-Plugin/milkup'
                    and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch', 'Explicit ordinary-user QA job only')
            require(self.output.is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve()), 'Runner-owned output')
            release = Path('/etc/os-release').read_text()
            require('ID=ubuntu\n' in release and 'VERSION_ID="26.04"' in release
                    and '26.04.1' in release, 'Exact supported Ubuntu 26.04.1 host')
            require(shutil.disk_usage(self.output).free >= 20*1024**3, '20 GiB free before real compilation')
            require(os.environ.get('RUSTUP_TOOLCHAIN') == '1.99.0', 'Locked Rust toolchain')
            for key in ['CC', 'CXX', 'TAURI_SIGNING_PRIVATE_KEY', 'WINDOWS_CERTIFICATE']:
                require(not os.environ.get(key), 'No unreviewed compiler/signing override: '+key)
            binding = sdk.prepare(self.source, self.runtime, self.output/'sdk')
            self.report['sdk'] = binding
            self.report['pkgConfig'] = sdk.verify_pkgconfig(binding)
            self.persist()
            env = dict(os.environ, **binding['environment'])
            env.update(CARGO_TARGET_DIR=str(self.output/'cargo-target'), CARGO_BUILD_JOBS='2',
                       CARGO_INCREMENTAL='0', CARGO_PROFILE_RELEASE_DEBUG='0', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1')
            self.run('tools', ['python3', '-c', 'import subprocess; [subprocess.run(x,check=True) for x in [["rustc","--version"],["cargo","--version"],["node","--version"],["pnpm","--version"]]]'], env, 30)
            self.run('frozen-workspace', ['pnpm','install','--frozen-lockfile','--config.manage-package-manager-versions=false'], env, 600)
            math = self.output/'math-input'
            self.run('reviewed-math-input', ['npm','install','--prefix',str(math),'--ignore-scripts',
                                           '--no-audit','--no-fund','katex@0.19.0'], env, 180)
            link = self.source/'plugins/math/node_modules/katex'
            require(not link.exists() and not link.is_symlink(), 'Fresh reviewed math input')
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(math/'node_modules/katex', target_is_directory=True)
            self.run('version-check', ['node','scripts/check-versions.mjs'], env, 30)
            self.run('trusted-plugins', ['node','scripts/ci/prepare-bundled-plugins.mjs'], env, 180)
            self.run('desktop-typecheck', ['pnpm','--filter','@milkup/desktop','typecheck'], env, 180)
            capture = self.output/'guard-capture'; capture.mkdir()
            wrapper = self.output/'cc-capture'
            wrapper.write_text('#!/usr/bin/python3\nimport sys\nsys.path.insert(0, '+repr(str(Path(__file__).parent))+')\nimport app_compile_gate\nsys.exit(app_compile_gate.capture_cc(sys.argv[1:]))\n')
            wrapper.chmod(0o755)
            env.update(CC=str(wrapper), MILKUP_COMPILE_SOURCE=str(self.source), MILKUP_COMPILE_CAPTURE=str(capture))
            self.run('real-tauri-build', ['pnpm','--filter','@milkup/desktop','tauri','build','--ci',
                                        '--no-bundle','--','--locked'], env, 2700)
            require(sdk.source_identity(self.source, sdk.install_gate.APPLICATION_SHA) == binding['sourceInputs'],
                    'Build did not change product inputs')
            application = self.output/'cargo-target/release/milkup-desktop'
            require(application.is_file() and not application.is_symlink(), 'Real newly built app ELF')
            app_info = intake.boundary.elf(application)
            final_lib = binding['finalPrefix']+'/lib/x86_64-linux-gnu'
            verify_link(app_info, final_lib, 'application')
            self.report['application'] = {**app_info, 'sha256': digest(application), 'bytes': application.stat().st_size}
            records = []
            require({p.name for p in capture.iterdir()} == {name+'.json' for name in GUARDS}, 'Exact two guard receipts')
            for name, filename in GUARDS.items():
                row = json.loads((capture/(name+'.json')).read_text())
                guard = Path(row['output'])
                require(row['exitCode'] == 0 and digest(guard) == row['sha256']
                        and guard.name == filename and guard.is_relative_to(self.output/'cargo-target'), 'Actual guard identity')
                require(row['sourceSha256'] == digest(self.source/'apps/desktop/src-tauri/src'/name), 'Exact compiled guard source')
                info = intake.boundary.elf(guard); verify_link(info, final_lib, name)
                row.update(elf=info, embedded=verify_embedded(application, guard)); records.append(row)
                shutil.copyfile(guard, self.payload/filename)
            shutil.copyfile(application, self.payload/application.name)
            self.report['guards'] = records
            self.report['status'] = 'passed-real-app-and-embedded-guard-link-not-installed-or-loaded'
            self.persist()
            (self.payload/'receipt.json').write_text(json.dumps(self.report, indent=2)+'\n')
        except Exception as error:
            self.report.update(status='failed-real-app-compile-gate', error=str(error)); self.persist(); raise


if __name__ == '__main__':
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest='mode', required=True)
    r = sub.add_parser('receive'); r.add_argument('archive', type=Path); r.add_argument('output', type=Path)
    b = sub.add_parser('build'); b.add_argument('source', type=Path); b.add_argument('runtime', type=Path); b.add_argument('output', type=Path)
    a = p.parse_args()
    if a.mode == 'receive': print(json.dumps(receive(a.archive.resolve(), a.output.resolve())))
    else: Build(a.source.resolve(), a.runtime.resolve(), a.output.resolve()).execute()

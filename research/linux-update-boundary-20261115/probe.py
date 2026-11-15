#!/usr/bin/env python3
"""Offline source-boundary probe, NOT an installed application update test.

Compiles the unchanged vendored privilege-dispatch methods with std-only error/log
adapters, then executes them against inert command fixtures in a private PATH.
No real pkexec/sudo/dpkg, authentication, network or package mutation is invoked.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--deb', type=Path, required=True)
    p.add_argument('--binary', type=Path, required=True)
    p.add_argument('--rustc', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    assert os.getuid() != 0, 'ordinary user required'
    assert args.deb.is_absolute() and args.binary.is_absolute()
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'scope': 'offline source methods + exact existing package inspection; no native UI or signed download',
              'status': 'running', 'cases': [], 'ciDispatched': False}
    try:
        assert digest(args.deb.read_bytes()) == '9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde'
        binary = args.binary.read_bytes()
        assert digest(binary) == '42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6'
        config = (args.source / 'release/update-channel.json').read_bytes()
        assert json.loads(config) == {'channel': 'beta', 'endpoints': [], 'publicKey': None}
        assert config in binary, 'exact unconfigured channel bytes must be in actual executable'
        report['package'] = {'source': '58c78973101acb0a22ca0cb5d24ef24bd9edc199',
                             'sha256': digest(args.deb.read_bytes()), 'binarySha256': digest(binary),
                             'metadata': subprocess.check_output(['dpkg-deb', '--field', str(args.deb), 'Package', 'Version', 'Architecture'], text=True),
                             'embeddedChannel': json.loads(config), 'channelOccurrences': binary.count(config)}
        source = args.source / 'vendor/tauri-plugin-updater/src/updater.rs'
        text = source.read_text()
        start = text.index('    fn try_install_with_privileges(')
        end = text.index('\n}\n\n/// MacOS', start)
        methods = text[start:end]
        (args.output / 'exact-methods.rs').write_text(methods)
        report['source'] = {'vendorSha256': digest(source.read_bytes()), 'methodsSha256': digest(methods.encode()),
                            'methodsStartLine': text[:start].count('\n') + 1,
                            'hostSha256': digest((args.source / 'apps/desktop/src-tauri/src/updates.rs').read_bytes()),
                            'channelSha256': digest(config)}
        paths = ['vendor/tauri-plugin-updater/src/updater.rs', 'apps/desktop/src-tauri/src/updates.rs', 'release/update-channel.json']
        report['unchangedFromPackageSource'] = {}
        for name in paths:
            old = subprocess.check_output(['git', '-C', str(args.source), 'show', '58c78973101acb0a22ca0cb5d24ef24bd9edc199:' + name])
            assert old == (args.source / name).read_bytes(), 'package/source update boundary changed'
            report['unchangedFromPackageSource'][name] = digest(old)
        report['nativeReadiness'] = {
            'status': 'blocked-existing-package',
            'checkDownloadVerify': 'compiled empty endpoints/public key; no runtime test-authority injection in this package',
            'install': 'real path invokes privilege helpers; not executed under no-automatic-elevation scope',
            'windowsFixtureReusableAsLinuxBinary': False,
            'packageMutationPerformed': False,
        }
        harness = '''extern crate self as log;
#[macro_export] macro_rules! debug { ($($tokens:tt)*) => {{}}; }
use std::path::Path;
#[derive(Debug)] enum Error { PackageInstallFailed, AuthenticationFailed, Io(std::io::Error) }
impl From<std::io::Error> for Error { fn from(e:std::io::Error)->Self { Self::Io(e) } }
type Result<T> = std::result::Result<T,Error>;
struct Update;
impl Update {
''' + methods + '''
}
fn main() {
    let package = std::env::args().nth(1).expect("own inert package path");
    println!("{:?}", Update.try_install_with_privileges(Path::new(&package), "dpkg", "-i"));
}
'''
        (args.output / 'harness.rs').write_text(harness)
        subprocess.run([str(args.rustc), '--edition=2021', '-A', 'dead_code', str(args.output / 'harness.rs'), '-o', str(args.output / 'probe')], check=True, timeout=30)
        cases = [
            ('pkexec-success-fixture', 0, 1, 1, 1, ['pkexec'], 'Ok(())'),
            ('pkexec-126-all-refused', 126, 1, 1, 1, ['pkexec', 'zenity', 'kdialog', 'sudo'], 'Err(PackageInstallFailed)'),
            ('pkexec-127-all-refused', 127, 1, 1, 1, ['pkexec', 'zenity', 'kdialog', 'sudo'], 'Err(PackageInstallFailed)'),
            ('graphic-password-rejected', 126, 0, 1, 1, ['pkexec', 'zenity', 'sudo', 'sudo'], 'Err(PackageInstallFailed)'),
        ]
        with tempfile.TemporaryDirectory(prefix='milkup-inert-update-', dir='/tmp') as temp:
            root = Path(temp)
            for name, pk, ze, kd, su, expected, result in cases:
                case = root / name
                case.mkdir(mode=0o700)
                commands = case / 'commands'
                commands.mkdir(mode=0o700)
                trace = case / 'trace'
                # Fixtures log argv only, never invoke argv or installed commands.
                # Fixed dummy password exercises stdin dispatch without real secrets.
                for command, status in [('pkexec', pk), ('zenity', ze), ('kdialog', kd), ('sudo', su)]:
                    body = '#!/bin/sh\nprintf \'%s\' "${0##*/}" >> "$INERT_TRACE"\nfor arg do printf \'|%s\' "$arg" >> "$INERT_TRACE"; done\nprintf \'\\n\' >> "$INERT_TRACE"\n'
                    if command == 'zenity' and status == 0:
                        body += "printf '%s\\n' 'synthetic-not-a-password'\n"
                    if command == 'sudo':
                        body += 'if [ "$1" = "-S" ]; then IFS= read -r ignored; fi\n'
                    body += f'exit {status}\n'
                    f = commands / command
                    f.write_text(body)
                    f.chmod(0o700)
                # If a future method calls dpkg directly, fail the evidence contract.
                trap = commands / 'dpkg'
                trap.write_text('#!/bin/sh\nprintf \'DIRECT-DPKG\\n\' >> "$INERT_TRACE"\nexit 99\n')
                trap.chmod(0o700)
                package = case / 'inert-package.deb'
                package.write_bytes(b'not an installer; dispatch-only fixture')
                completed = subprocess.run([str(args.output / 'probe'), str(package)], env={'PATH': str(commands), 'INERT_TRACE': str(trace)}, text=True, capture_output=True, timeout=5)
                calls = trace.read_text().splitlines()
                assert completed.returncode == 0 and completed.stdout.strip() == result
                assert [line.split('|')[0] for line in calls] == expected
                assert package.read_bytes() == b'not an installer; dispatch-only fixture'
                for line in calls:
                    if line.startswith(('pkexec|', 'sudo|')):
                        assert line.endswith('|dpkg|-i|' + str(package))
                report['cases'].append({'name': name, 'result': result, 'calls': calls, 'packageUnchanged': True})
        report['status'] = 'passed-offline-boundary-only'
    finally:
        (args.output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

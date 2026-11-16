"""Synthetic sources/ELFs/archive/protection mocks only. No installation or native pass."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile
import sys
import unittest
from unittest.mock import patch

import install_gate as g
import test_package_boundary as fixture


class InstallGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture.Boundary.setUpClass()

    @classmethod
    def tearDownClass(cls):
        fixture.Boundary.tearDownClass()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='install-gate-synthetic-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.stage = self.root / 'assembled'
        self.dest = self.root / 'cmake-destdir'
        shutil.copytree(fixture.Boundary.stage, self.stage)
        shutil.copytree(fixture.Boundary.stage, self.dest)
        self.recipe = copy.deepcopy(fixture.Boundary.recipe)
        self.manifest = copy.deepcopy(fixture.Boundary.manifest)
        self.manifest['applicationSourceSha'] = g.APPLICATION_SHA
        self.manifest['sourceSha'] = g.APPLICATION_SHA
        self.entries = [r['path'] for r in self.manifest['files'] if r['role'] in g.RUNTIME_ROLES]
        self.list = self.root / 'install_manifest.txt'
        self.list.write_text('\n'.join(self.entries) + '\n')
        self.manifest['cmakeInstall'] = {'manifestSha256': g.digest(self.list),
            'cacheSha256': g.digest(fixture.Boundary.cache), 'excludedEntries': {}}

    def stage_gate(self):
        return g.bind_staging(self.stage, self.dest, self.recipe, self.manifest,
            self.list, fixture.Boundary.cache, fixture.Boundary.commands, fixture.Boundary.config)

    def test_real_cli_stage_and_failure_receipts_are_not_native_acceptance(self):
        manifest = self.root / 'candidate.json'; recipe = self.root / 'recipe.json'
        manifest.write_text(json.dumps(self.manifest)); recipe.write_text(json.dumps(self.recipe))
        output = self.root / 'positive.json'
        command = [sys.executable, str(Path(g.__file__)), 'stage', '--manifest', str(manifest),
            '--recipe', str(recipe), '--stage', str(self.stage), '--destdir', str(self.dest),
            '--install-manifest', str(self.list), '--cache', str(fixture.Boundary.cache),
            '--commands', str(fixture.Boundary.commands), '--config', str(fixture.Boundary.config), '--output']
        result = subprocess.run(command + [str(output)], text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(output.read_text())['status'], 'staging-origin-bound-not-installed')
        self.list.write_text('/wrong/prefix\n')
        failed = self.root / 'failed.json'
        result = subprocess.run(command + [str(failed)], text=True, capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(failed.read_text())['status'], 'failed')
        self.assertIn('manifest identity', json.loads(failed.read_text())['error'])
        before = output.read_bytes()
        result = subprocess.run(command + [str(output)], text=True, capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0); self.assertEqual(output.read_bytes(), before)

    def test_daily_wrapper_stops_before_driver_on_wrong_candidate(self):
        root = Path(__file__).resolve().parents[2]
        manifest = self.root / 'candidate.json'; recipe = self.root / 'recipe.json'
        bad = copy.deepcopy(self.manifest); bad['sourceSha'] = 'f' * 40
        manifest.write_text(json.dumps(bad)); recipe.write_text(json.dumps(self.recipe))
        receipt = self.root / 'stage.json'; receipt.write_text('{}')
        evidence = self.root / 'evidence'; evidence.mkdir()
        fake_bin = self.root / 'bin'; fake_bin.mkdir()
        marker = self.root / 'driver-must-not-run'
        stub = fake_bin / 'tauri-driver'
        stub.write_text('#!/bin/sh\nprintf unsafe > "' + str(marker) + '"\nexit 1\n'); stub.chmod(0o755)
        env = dict(os.environ)
        for name in g.FORBIDDEN_ENV: env.pop(name, None)
        env.update({'PATH': str(fake_bin) + os.pathsep + env['PATH'], 'DISPLAY': ':synthetic-not-used',
            'MILKUP_FINAL_MANIFEST': str(manifest), 'MILKUP_FINAL_RECIPE': str(recipe),
            'MILKUP_FINAL_STAGING_RECEIPT': str(receipt), 'MILKUP_FINAL_PACKAGE': str(self.root / 'not-created.deb'),
            'MILKUP_FINAL_APPLICATION': '/wrong/app', 'MILKUP_FINAL_DRIVER': '/wrong/driver',
            'MILKUP_NATIVE_EVIDENCE_DIR': str(evidence), 'MILKUP_NATIVE_EXTRACTED_APP': '/not/executed',
            'MILKUP_NATIVE_PROFILE_ROOT': str(self.root), 'MILKUP_NATIVE_CLOSE_HELPER': '/not/executed',
            'MILKUP_NATIVE_EXCLUSIVE_DISPLAY': '1'})
        result = subprocess.run(['bash', 'scripts/ci/run-linux-final-prefix-daily.sh'], cwd=root,
            env=env, text=True, capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0); self.assertFalse(marker.exists())
        if os.geteuid() != 0:
            row = json.loads((evidence / 'final-prefix-installed-gate.json').read_text())
            self.assertEqual(row['status'], 'failed'); self.assertIn('application source', row['error'])

    def test_synthetic_positive_never_claims_installation(self):
        result = self.stage_gate()
        self.assertEqual(result['status'], 'staging-origin-bound-not-installed')
        self.assertEqual(len(result['origins']), 7)
        self.assertTrue(any(r['path'].endswith('/WebKitWebDriver') for r in result['origins']))

    def test_wrong_source_cache_or_install_identity_rejected(self):
        for key in ['manifestSha256', 'cacheSha256']:
            with self.subTest(key=key):
                old = self.manifest['cmakeInstall'][key]
                self.manifest['cmakeInstall'][key] = '0' * 64
                with self.assertRaises(ValueError): self.stage_gate()
                self.manifest['cmakeInstall'][key] = old
        self.manifest['applicationSourceSha'] = '0' * 40
        with self.assertRaisesRegex(ValueError, 'application source'): self.stage_gate()

    def test_cmake_extra_must_be_individually_reviewed(self):
        name = self.recipe['prefix'] + '/include/SDK.h'
        self.list.write_text(self.list.read_text() + name + '\n')
        self.manifest['cmakeInstall']['manifestSha256'] = g.digest(self.list)
        with self.assertRaisesRegex(ValueError, 'explicitly reviewed'): self.stage_gate()
        self.manifest['cmakeInstall']['excludedEntries'] = {name: 'SDK header, not loaded by ordinary application'}
        self.assertEqual(self.stage_gate()['excludedEntries'][name], self.manifest['cmakeInstall']['excludedEntries'][name])

    def test_cmake_destination_escape_duplicate_and_wrong_prefix(self):
        for text in ['/usr/lib/foreign.so\n', self.entries[0] + '\n' + self.entries[0] + '\n',
                     self.recipe['prefix'] + '/../escape\n']:
            with self.subTest(text=text):
                self.list.write_text(text)
                self.manifest['cmakeInstall']['manifestSha256'] = g.digest(self.list)
                with self.assertRaises(ValueError): self.stage_gate()

    def test_unrelated_cmake_contents_and_missing_driver_rejected(self):
        row = next(r for r in self.manifest['files'] if r['role'] == 'qa-driver')
        p = self.dest / row['path'].lstrip('/')
        original = p.read_bytes(); p.write_bytes(b'WRONG')
        with self.assertRaisesRegex(ValueError, 'differs'): self.stage_gate()
        p.write_bytes(original)
        self.manifest['files'].remove(row)
        with self.assertRaises(AssertionError): self.stage_gate()

    def test_local_declared_soname_link_is_flattened_but_host_link_rejected(self):
        name = self.entries[0]; p = self.dest / name.lstrip('/')
        real = p.with_name(p.name + '.99'); p.rename(real); p.symlink_to(real.name)
        self.list.write_text(self.list.read_text() + str(Path(name).with_name(real.name)) + '\n')
        self.manifest['cmakeInstall']['manifestSha256'] = g.digest(self.list)
        self.assertEqual(len(self.stage_gate()['origins'][0]['installChain']), 2)
        p.unlink(); p.symlink_to('/usr/lib/foreign.so')
        with self.assertRaisesRegex(ValueError, 'local non-parent'): self.stage_gate()

    def test_alias_and_unsafe_permissions_rejected(self):
        p = self.dest / self.entries[0].lstrip('/')
        p.chmod(0o777)
        with self.assertRaisesRegex(ValueError, 'mode'): self.stage_gate()
        p.chmod(g.boundary.role_mode(self.manifest['files'][0]['role']))
        with self.assertRaisesRegex(ValueError, 'alias'): g.bind_staging(self.stage, self.stage,
            self.recipe, self.manifest, self.list, fixture.Boundary.cache, fixture.Boundary.commands, fixture.Boundary.config)

    def archive(self, mutate=None):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as tar:
            for index, row in enumerate(self.manifest['files']):
                p = self.stage / row['path'].lstrip('/')
                member = tarfile.TarInfo('.' + row['path'])
                member.uid = member.gid = 0
                member.mode = g.boundary.role_mode(row['role'])
                payload = p.read_bytes(); member.size = len(payload)
                if mutate: payload = mutate(index, member, payload)
                tar.addfile(member, io.BytesIO(payload) if member.isfile() else None)
        data.seek(0)
        return tarfile.open(fileobj=data, mode='r:')

    def test_exact_archive_bytes_and_modes(self):
        with self.archive() as tar:
            self.assertEqual(g.package_entries(tar, self.manifest), len(self.manifest['files']))

    def test_corrupt_archive_role_identity_ownership_escape_and_link(self):
        def mutate(kind):
            def change(index, member, data):
                if index != 0: return data
                if kind == 'corrupt': return b'!' + data[1:]
                if kind == 'owner': member.uid = os.getuid() or 1234
                if kind == 'mode': member.mode = 0o777
                if kind == 'path': member.name = '../escape'
                if kind == 'link': member.type = tarfile.SYMTYPE; member.linkname = '/tmp/wrong'
                return data
            return change
        for kind in ['corrupt', 'owner', 'mode', 'path', 'link']:
            with self.subTest(kind=kind), self.archive(mutate(kind)) as tar:
                with self.assertRaises(ValueError): g.package_entries(tar, self.manifest)

    def test_real_synthetic_deb_rejects_wrong_package_app_driver_and_receipt(self):
        package_root = self.root / 'deb-root'
        shutil.copytree(self.stage, package_root)
        control = package_root / 'DEBIAN'
        control.mkdir()
        control.chmod(0o755)
        for directory in package_root.rglob('*'):
            if directory.is_dir(): directory.chmod(0o755)
        package_root.chmod(0o755)
        (control / 'control').write_text('Package: milkup-synthetic-gate-only\nVersion: 0.0.1\nArchitecture: amd64\nMaintainer: Synthetic Test <test@example.invalid>\nDescription: Synthetic checker fixture, never install\n')
        package = self.root / 'synthetic.deb'
        built = subprocess.run(['dpkg-deb', '--root-owner-group', '--build', str(package_root), str(package)], capture_output=True, text=True, timeout=20)
        self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
        self.manifest['installer'] = {'name': package.name, 'bytes': package.stat().st_size, 'sha256': g.digest(package)}
        receipt = self.stage_gate()
        receipt['manifestSha256'] = hashlib.sha256(json.dumps(self.manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        app = Path(self.recipe['prefix']) / 'bin/milkup-desktop'
        driver = Path(self.recipe['prefix']) / 'bin/WebKitWebDriver'
        with patch.object(os, 'geteuid', return_value=1000), patch.dict(os.environ, {}, clear=True):
            for a, d in [(Path('/usr/bin/milkup-desktop'), driver), (app, Path('/usr/bin/WebKitWebDriver'))]:
                with self.subTest(a=a, d=d), self.assertRaisesRegex(ValueError, 'exact final paths'):
                    g.installed(self.manifest, self.recipe, package, receipt, a, d)
            bad_receipt = {**receipt, 'manifestSha256': '0' * 64}
            with self.assertRaisesRegex(ValueError, 'manifest binding'):
                g.installed(self.manifest, self.recipe, package, bad_receipt, app, driver)
            package.write_bytes(package.read_bytes() + b'corrupt')
            with self.assertRaisesRegex(ValueError, 'Exact package bytes'):
                g.installed(self.manifest, self.recipe, package, receipt, app, driver)

    def test_real_user_owned_tmpfs_is_rejected_as_final_install(self):
        with self.assertRaisesRegex(ValueError, 'root-owned|writable'):
            g.protected(self.stage)

    def test_protection_positive_and_acl_or_owner_negative_are_only_mock_contracts(self):
        class Info:
            st_uid = 0
            st_mode = stat.S_IFDIR | 0o755
        with patch.object(Path, 'lstat', return_value=Info()), patch.object(os, 'access', return_value=False):
            g.protected(Path(self.recipe['prefix']))
        with patch.object(Path, 'lstat', return_value=Info()), patch.object(os, 'access', return_value=True):
            with self.assertRaisesRegex(ValueError, 'writable'): g.protected(Path(self.recipe['prefix']))
        Info.st_uid = 1001
        with patch.object(Path, 'lstat', return_value=Info()), patch.object(os, 'access', return_value=False):
            with self.assertRaisesRegex(ValueError, 'root-owned'): g.protected(Path(self.recipe['prefix']))

    def test_installed_entrance_rejects_privilege_loader_and_wrong_receipt_before_execution(self):
        args = (self.manifest, self.recipe, self.root / 'not-created.deb', {}, Path('/wrong'), Path('/wrong-driver'))
        with patch.object(os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(ValueError, 'ordinary'): g.installed(*args)
        with patch.object(os, 'geteuid', return_value=1000), patch.dict(os.environ, {'LD_LIBRARY_PATH': '/tmp/runtime'}):
            with self.assertRaisesRegex(ValueError, 'override'): g.installed(*args)
        with patch.object(os, 'geteuid', return_value=1000), patch.dict(os.environ, {}, clear=True):
            args = (*args[:3], {'status': 'passed'}, *args[4:])
            with self.assertRaisesRegex(ValueError, 'staging'): g.installed(*args)


if __name__ == '__main__': unittest.main()

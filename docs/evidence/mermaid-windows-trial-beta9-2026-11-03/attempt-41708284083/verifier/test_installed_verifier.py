"""Synthetic unit fixtures only; no installer, plugin, browser, or Windows run."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import package_evidence as K
import product_evidence as P
import static_installer as S
import verify_installed_dual as V


def encoded(value): return (json.dumps(value, separators=(',', ':')) + '\n').encode()


def installation_fixture(kind='pure-standard'):
    sid = 'S-1-5-21-11-22-33-1003'; filtered = kind == 'filtered-admin'; version = '2.0.0-beta.9'
    token = dict(sid=sid, ownerSid=sid, ownerIsUser=True, privilegesComplete=True, elevated=False, uiAccess=False,
                 seDebugPrivilegePresent=False, tokenType=1, sessionId=2, integrityRid=8192,
                 elevationType=3 if filtered else 1, hostDisallowedPrivilegeCount=0, pureStandardUser=not filtered,
                 filteredAdmin=filtered, administratorsGroupPresentIncludingDenyOnly=filtered,
                 administratorsGroupAttributes=16 if filtered else None, privilegeCount=1,
                 privileges=[{'name': 'SeChangeNotifyPrivilege', 'attributes': 3}])
    scratch = r'C:\Users\Synthetic\.milkup-mermaid-product-' + 'b' * 32; stage = r'C:\staged'
    image = {'path': scratch + r'\install\milkup-desktop.exe', 'bytes': 100, 'sha256': 'c' * 64,
             'fileVersion': version, 'productVersion': version, 'peMachine': '0x8664'}
    installer = {'path': stage + r'\code\candidate-installer.exe', 'bytes': 200, 'sha256': 'd' * 64}
    comparison = {'status': 'passed', 'bytes': 100, 'builtSha256': 'e' * 64, 'expectedInstalledSha256': 'c' * 64,
                  'installedSha256': 'c' * 64, 'bundleMarkerOffset': 20, 'transformation': '__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS', 'bundlerVersion': '2.9.4'}
    def run(label, pid, out_len):
        return dict(status='passed', tool=label, started=True, exited=True, streamsDrained=True, timedOut=False,
                    captureExceeded=False, forcedNodeTermination=False, forcedProcessTermination=False,
                    useShellExecute=False, credentialsSpecified=False, breakawayRequested=False, exitCode=0,
                    error=None, cleanupErrors=[], pid=pid, captureLimitPerStream=2 * K.MIB, stdoutBytes=out_len, stderrBytes=0)
    actual = run('Installer', 11, 0); actual.update(expectedAccountKind=kind, identityRequired=True, identityVerified=True)
    for field, pid in [('callerIdentity', 10), ('startedProcess', 11)]:
        actual[field] = dict(pid=pid, token=copy.deepcopy(token), sessionId=2, inJob=True,
                             expectedAccountKind=kind, accountKindVerified=True)
    actual['startedProcess'].update(image=installer['path'], imageTruncated=False, creationFileTime='1234567')
    compare_run = run('Node', 12, len(encoded(comparison))); compare_run.update(identityRequired=False, identityVerified=False, expectedAccountKind=None)
    plugins = [{'id': 'plugin.p' + str(i), 'version': '1.0.0', 'archiveFile': 'p' + str(i), 'bytes': 1, 'sha256': 'f' * 64} for i in range(10)]
    resources = [{'relativePath': 'file.ico', 'bytes': 4, 'sha256': 'f' * 64}]
    installation = dict(schema=1, status='passed', mode='nsis-current-user', candidateSha='a' * 40,
        expectedAccountKind=kind, actualSid=sid, expectedSid=sid, sessionId=2, expectedSessionId=2,
        productAcceptance='passed', cleanupErrors=[], installDirectory=scratch + r'\install', installedBinary=image,
        installer=installer, installerRun=actual, comparisonRun=compare_run, binaryComparison=comparison,
        bundledPlugins=plugins, resources=[{**x, 'verified': True} for x in resources], embeddedPluginBinding='exact-installed-image-byte-comparison')
    outer = {'accountSid': sid, 'standardContext': {'sessionId': 2, 'scratchRoot': scratch}, 'stage': stage, 'supervisor': {'pid': 10}}
    product = {'applicationSha256': image['sha256'], 'application': image['path'], 'steps': [{'bundledPluginsObserved': [
        {'id': x['id'], 'version': x['version'], 'checked': 'false', 'busy': 'false'} for x in plugins]}]}
    package = {'packaging': {'installer': installer, 'compiledApplication': {'sha256': 'e' * 64}, 'extractedApplication': image},
               'manifest': {'version': version}, 'installerInput': {'bundledPlugins': plugins, 'resources': resources}, 'nsis': {'markerOffset': 20}}
    files = {'installation-result.json': encoded(installation), 'installed-binary-comparison.json': encoded(comparison),
             'windows-standard-product-audit.json': encoded(outer), 'mermaid-product-e2e.json': encoded(product),
             'installer-stdout.log': b'', 'installer-stderr.log': b'', 'installed-binary-comparison-stderr.log': b''}
    return files, package, SimpleNamespace(candidate='a' * 40)


class InstalledVerifierTests(unittest.TestCase):
    def test_both_account_installation_binding_positive(self):
        for kind in K.KINDS:
            files, package, source = installation_fixture(kind)
            value = K.installation_account(files, kind, package, source)
            self.assertEqual(value['observedInitiallyDisabledPlugins'], 10)
            self.assertFalse(value['installerExactJobHandleIndependentlyQueried'])

    def test_actual_installer_tokens_reject_elevation_and_wrong_kind(self):
        for kind in K.KINDS:
            for field, value in [('elevated', True), ('elevationType', 2), ('integrityRid', 12288), ('tokenType', 2),
                                 ('seDebugPrivilegePresent', True), ('ownerSid', 'S-1-5-32-544')]:
                with self.subTest(kind=kind, field=field):
                    files, package, source = installation_fixture(kind); data = P.parse_json(files['installation-result.json'])
                    data['installerRun']['startedProcess']['token'][field] = value; files['installation-result.json'] = encoded(data)
                    with self.assertRaises(ValueError): K.installation_account(files, kind, package, source)

    def test_original_comparison_bytes_are_bound(self):
        files, package, source = installation_fixture(); files['installed-binary-comparison.json'] += b' '
        with self.assertRaises(ValueError): K.installation_account(files, K.KINDS[0], package, source)

    def test_full_comparison_cannot_be_replaced_with_status_only(self):
        files, package, source = installation_fixture(); raw = {'status': 'passed'}
        files['installed-binary-comparison.json'] = encoded(raw)
        data = P.parse_json(files['installation-result.json']); data['binaryComparison'] = raw
        data['comparisonRun']['stdoutBytes'] = len(encoded(raw)); files['installation-result.json'] = encoded(data)
        with self.assertRaises(ValueError): K.installation_account(files, K.KINDS[0], package, source)

    def test_installed_path_cannot_be_linked_source_binary(self):
        files, package, source = installation_fixture(); data = P.parse_json(files['mermaid-product-e2e.json'])
        data['application'] = r'C:\staged\code\milkup-desktop.exe'; files['mermaid-product-e2e.json'] = encoded(data)
        with self.assertRaises(ValueError): K.installation_account(files, K.KINDS[0], package, source)

    def test_initial_plugin_state_and_version_must_be_observed(self):
        for key, value in [('checked', 'true'), ('busy', 'true'), ('version', '9.9.9'), ('id', 'unknown')]:
            files, package, source = installation_fixture(); data = P.parse_json(files['mermaid-product-e2e.json'])
            data['steps'][0]['bundledPluginsObserved'][0][key] = value; files['mermaid-product-e2e.json'] = encoded(data)
            with self.assertRaises(ValueError): K.installation_account(files, K.KINDS[0], package, source)

    def test_exact_installer_image_sid_and_handle_metadata_required(self):
        for key, value in [('image', r'C:\other.exe'), ('pid', 999), ('imageTruncated', True), ('creationFileTime', '')]:
            files, package, source = installation_fixture(); data = P.parse_json(files['installation-result.json'])
            data['installerRun']['startedProcess'][key] = value; files['installation-result.json'] = encoded(data)
            with self.assertRaises(ValueError): K.installation_account(files, K.KINDS[0], package, source)

    def test_capture_forced_cleanup_is_not_passing_installation(self):
        for field in ('forcedProcessTermination', 'timedOut', 'captureExceeded'):
            files, package, source = installation_fixture(); data = P.parse_json(files['installation-result.json'])
            data['installerRun'][field] = True; files['installation-result.json'] = encoded(data)
            with self.assertRaises(ValueError): K.installation_account(files, K.KINDS[0], package, source)

    def test_checksum_manifest_closed_exact_members(self):
        files = {'a.txt': b'content'}; files['SHA256SUMS.txt'] = (P.sha256(files['a.txt']) + '  a.txt\n').encode()
        self.assertEqual(V.checksum_manifest(files)['filesHashed'], 1)
        for mutated in [{**files, 'unlisted.txt': b'x'}, {**files, 'a.txt': b'changed'},
                        {**files, 'SHA256SUMS.txt': files['SHA256SUMS.txt'] * 2}]:
            with self.assertRaises(ValueError): V.checksum_manifest(mutated)

    def test_inspection_manifest_retains_missing_acceptance_as_missing(self):
        files = {'packaging-record.json': b'{}'}
        files['manifest.json'] = encoded({'candidateSha': 'a' * 40, 'includesBinariesOrProfiles': False,
                                          'files': [{'name': 'packaging-record.json', **K.record(b'{}')}]})
        value = K.inspection_manifest(files, 'a' * 40)
        self.assertTrue(value['missingForAcceptance'])
        self.assertEqual(value['manifestFiles'], 1)
        with self.assertRaises(ValueError): K.inspection_manifest({**files, 'extra.json': b'{}'}, 'a' * 40)

    def test_dependency_report_reparsed_from_raw_imports(self):
        raw = b'    KERNEL32.dll\r\n    USER32.dll\r\n'
        proof = {'schema': 1, 'status': 'passed', 'readOnly': True, 'architecture': 'x86_64', 'applicationSha256': 'a' * 64,
                 'source': {'importsSha256': P.sha256(raw), 'dumpbinSha256': 'b' * 64}, 'dlls': ['KERNEL32.DLL', 'USER32.DLL'],
                 'apiSets': [], 'extraVcRuntimeDlls': [], 'webview2Loader': 'static-no-loader-dll-import',
                 'webview2Runtime': 'external-existing-Evergreen', 'nodeOrPnpmRequiredAtRuntime': False}
        self.assertEqual(K.dependencies(proof, raw, 'a' * 64)['dlls'], proof['dlls'])
        proof['dlls'] = []
        with self.assertRaises(ValueError): K.dependencies(proof, raw, 'a' * 64)

    def test_static_member_exact_bounded_no_glob(self):
        self.assertEqual(S.exact_member('milkup-desktop.exe'), 'milkup-desktop.exe')
        self.assertEqual(S.exact_member('$_OUTDIR/milkup-desktop.exe'), '$_OUTDIR/milkup-desktop.exe')
        for name in ('../milkup-desktop.exe', '/milkup-desktop.exe', '*/milkup-desktop.exe', '-switch/milkup-desktop.exe',
                     'C:/milkup-desktop.exe', 'other.exe', 'a\\milkup-desktop.exe'):
            with self.assertRaises(ValueError): S.exact_member(name)

    def test_bounded_static_tool_process_stdout(self):
        out, err = S.bounded_process([sys.executable, '-c', "print('synthetic')"], 100, timeout=2)
        self.assertEqual(out, b'synthetic\n'); self.assertEqual(err, b'')
        with self.assertRaises(ValueError):
            S.bounded_process([sys.executable, '-c', "print('x'*10000)"], 30, timeout=2)

    def test_bounded_static_tool_process_deadline_and_failure(self):
        with self.assertRaises(ValueError): S.bounded_process([sys.executable, '-c', 'import time; time.sleep(3)'], 100, timeout=.05)
        with self.assertRaises(ValueError): S.bounded_process([sys.executable, '-c', 'raise SystemExit(2)'], 100, timeout=2)

    def test_no_installer_tool_means_no_static_acceptance(self):
        with self.assertRaises(FileNotFoundError): S.inspect_static(b'', {}, None, '/nonexistent/synthetic-7zz')

    def test_raw_mermaid_package_seals_are_deterministic_and_path_safe(self):
        archive = {'format': 'milkup-plugin', 'version': 1, 'manifest': {'name': '中文', 'id': 'test'},
                   'files': [{'path': 'dist/plugin.js', 'encoding': 'utf8', 'content': 'synthetic'}]}
        actual = K.package_seals(archive)
        self.assertEqual(actual, K.package_seals(copy.deepcopy(archive)))
        archive['files'][0]['path'] = '../outside'
        with self.assertRaises(ValueError): K.package_seals(archive)

    def test_grouped_harness_provenance_is_exact_and_candidate_bound(self):
        raw = b"import assert from 'node:assert/strict'\n"; windows = raw.replace(b'\n', b'\r\n'); candidate = 'a' * 40
        info = {'gitPath': 'tests/windows/mermaid-product-e2e.mjs', 'gitBlob': hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest(),
                'gitBlobBytes': len(raw), 'gitBlobSha256': P.sha256(raw), 'lfCount': 1, 'crCount': 0,
                'derivedWindowsBytes': len(windows), 'derivedWindowsSha256': P.sha256(windows)}
        source = SimpleNamespace(candidate=candidate, read=lambda name: raw)
        with tempfile.TemporaryDirectory(prefix='synthetic-harness-source-') as temporary:
            harness = Path(temporary) / 'harness.mjs'; provenance = Path(temporary) / 'source.json'
            harness.write_bytes(raw); provenance.write_bytes(encoded({'candidateSha': candidate, 'files': [info]}))
            self.assertEqual(K.verify_harness(source, harness, provenance)['windowsCRLF']['bytes'], len(windows))
            harness.write_bytes(raw + b' ')
            with self.assertRaises(ValueError): K.verify_harness(source, harness, provenance)

    def test_native_audit_line_budget_is_production_8192(self):
        files = {fixture + '-product.log': b'' for fixture in P.FIXTURES}
        files['ordinary-product.log'] = b'MILKUP_MERMAID_NATIVE_AUDIT ' + b' ' * 8193 + b'\n'
        with self.assertRaises(ValueError): P.read_native_records(files)

    def test_same_account_sid_cannot_satisfy_two_account_matrix(self):
        accounts = {kind: {'installation': {'sid': 'same'}} for kind in K.KINDS}
        with self.assertRaises(ValueError): V.distinct_sids(accounts)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(InstalledVerifierTests)
    names = [test.id() for test in suite]; stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    sys.stderr.write(stream.getvalue())
    report = {'scope': 'Synthetic local validation only; no Windows or installer execution',
              'status': 'passed' if result.wasSuccessful() else 'failed', 'tests': result.testsRun,
              'failures': len(result.failures), 'errors': len(result.errors), 'cases': names,
              'windowsInstallerExecuted': False, 'networkAccessed': False}
    if len(sys.argv) == 2: Path(sys.argv[1]).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)

"""Read-only cross-artifact package/installation checks; never execute payloads."""
import base64
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import product_evidence as P

MIB = 1024 * 1024
REPORTS = ('installation-result.json', 'installed-binary-comparison.json',
           'windows-standard-product-audit.json', 'mermaid-product-e2e.json')
KINDS = ('pure-standard', 'filtered-admin')
INSPECTION_NAMES = {
    'mermaid-source-checkout.json', 'mermaid-source-desktop-check.json', 'mermaid-source-final.json',
    'nsis-image-proof.json', 'packaging-record.json', 'installer-input.json',
    'packaged-production-binary-manifest.json', 'packaged-production-binary.manifest',
    'public-plugins-staged-bundles.json', 'public-plugins-verification.json',
    'mermaid-trial-preparation.json', 'mermaid-trial-finalization.json',
    'windows-runtime-dependencies.json', 'windows-runtime-imports.log', 'owned-process-regression.log',
}
ENGINE_PATH = 'apps/desktop/src-tauri/mermaid-engine/assets/mermaid-12.2.0.min.js'
BOOTSTRAP_PATH = 'apps/desktop/src-tauri/mermaid-engine/assets/bootstrap.js'
ENGINE_SHA = 'a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f'
require, sha, parse = P.require, P.sha256, P.parse_json


def equal(a, b, label):
    require(P._outer_equal(a, b), label)


def record(data):
    return {'bytes': len(data), 'sha256': sha(data)}


def match_bytes(value, data, label):
    require(isinstance(value, dict) and type(value.get('bytes')) is int and
            value['bytes'] == len(data) and value.get('sha256') == sha(data), label)


class FrozenSource:
    def __init__(self, repo, candidate):
        require(re.fullmatch(r'[a-f0-9]{40}', candidate) is not None, 'Exact candidate required')
        self.repo, self.candidate, self.cache = str(repo), candidate, {}

    def read(self, name):
        require(re.fullmatch(r'[A-Za-z0-9_./-]+', name) and not name.startswith('/') and
                all(x not in ('', '.', '..') for x in name.split('/')), 'Safe exact Git source path required')
        if name not in self.cache:
            result = subprocess.run(['git', 'cat-file', 'blob', self.candidate + ':' + name],
                                    cwd=self.repo, capture_output=True, timeout=10, check=False)
            require(result.returncode == 0 and len(result.stdout) <= 8 * MIB and len(result.stderr) <= MIB,
                    'Exact candidate Git blob unavailable: ' + name)
            self.cache[name] = result.stdout
        return self.cache[name]

    def inventory(self):
        entries = parse(self.read('release/bundled-plugins.json'))
        require(isinstance(entries, list) and 0 < len(entries) <= 64, 'Bounded source plugin inventory required')
        selected = []
        for entry in entries:
            if 'platforms' in entry and 'win32' not in entry['platforms']:
                continue
            directory = entry.get('directory')
            require(isinstance(directory, str) and re.fullmatch(r'plugins/[a-z0-9][a-z0-9-]*', directory),
                    'Invalid source plugin directory')
            manifest = parse(self.read(directory + '/plugin.json'))
            require(manifest.get('host') == entry.get('host') == 'worker', 'Only actual Windows Worker packages accepted')
            equal(manifest.get('permissions'), entry.get('permissions'), 'Source plugin permissions differ')
            selected.append((manifest, entry))
        require(len(selected) == 10 and len({m['id'] for m, _ in selected}) == 10, 'Exact ten source plugins required')
        return sorted(selected, key=lambda pair: pair[0]['id'])


def verify_harness(source, harness, provenance):
    raw = source.read('tests/windows/mermaid-product-e2e.mjs')
    require(b'\r' not in raw, 'Frozen Git harness must contain exact LF bytes')
    require(P.read_input(Path(harness), 2 * MIB) == raw, 'Frozen local harness differs from exact candidate Git blob')
    windows = raw.replace(b'\n', b'\r\n')
    value = parse(P.read_input(Path(provenance), MIB))
    require(value.get('candidateSha') == source.candidate, 'Harness provenance candidate mismatch')
    if 'files' in value:
        entries = value['files']
        require(isinstance(entries, list) and len(entries) <= 32, 'Bounded source-provenance list required')
        matches = [entry for entry in entries if entry.get('gitPath') == 'tests/windows/mermaid-product-e2e.mjs']
        require(len(matches) == 1, 'Exact unique harness provenance record required')
        value = {'candidateSha': value['candidateSha'], **matches[0]}
    require(value.get('candidateSha') == source.candidate and value.get('gitPath') == 'tests/windows/mermaid-product-e2e.mjs',
            'Harness provenance candidate/path mismatch')
    oid = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    for key, actual in [('gitBlob', oid), ('gitBlobBytes', len(raw)), ('gitBlobSha256', sha(raw)),
                        ('derivedWindowsBytes', len(windows)), ('derivedWindowsSha256', sha(windows)),
                        ('lfCount', raw.count(b'\n')), ('crCount', 0)]:
        equal(value.get(key), actual, 'Exact LF-to-CRLF provenance mismatch: ' + key)
    # This frozen, reviewed module has only built-in static imports. Importing it
    # uses an unrelated argv[1], so its executable entry point never runs.
    imports = re.findall(rb'from\s+[\'"]([^\'"]+)[\'"]', raw)
    require(imports and all(name.startswith(b'node:') for name in imports), 'Offline harness must use built-in imports only')
    return {'candidateSha': source.candidate, 'gitBlob': oid, 'lf': record(raw), 'windowsCRLF': record(windows)}


def inspection_manifest(files, candidate):
    require('manifest.json' in files, 'Inspection manifest missing')
    manifest = parse(files['manifest.json'])
    require(set(manifest) == {'candidateSha', 'files', 'includesBinariesOrProfiles'} and
            manifest['candidateSha'] == candidate and manifest['includesBinariesOrProfiles'] is False,
            'Closed inspection manifest identity mismatch')
    entries = manifest['files']
    require(isinstance(entries, list) and len(entries) <= len(INSPECTION_NAMES), 'Bounded inspection list required')
    listed = set()
    for item in entries:
        require(set(item) == {'name', 'bytes', 'sha256'} and item['name'] in INSPECTION_NAMES and item['name'] not in listed,
                'Unknown/duplicate inspection manifest entry')
        listed.add(item['name'])
        match_bytes(item, files[item['name']], 'Inspection hash/length mismatch: ' + item['name'])
    require(set(files) == listed | {'manifest.json'}, 'Inspection manifest exact file set mismatch')
    return {'manifestFiles': len(listed), 'missingForAcceptance': sorted(INSPECTION_NAMES - listed)}


def dependencies(report, raw, image_sha):
    require(report.get('schema') == 1 and report.get('status') == 'passed' and report.get('readOnly') is True and
            report.get('architecture') == 'x86_64' and report.get('applicationSha256') == image_sha,
            'Actual dependency report identity mismatch')
    require(0 < len(raw) <= 2 * MIB and report.get('source', {}).get('importsSha256') == sha(raw) and
            re.fullmatch(r'[a-f0-9]{64}', str(report.get('source', {}).get('dumpbinSha256', ''))), 'Raw imports/tool binding missing')
    dlls = sorted(set(x.upper() for x in re.findall(r'^\s+([^\s]+\.dll)\s*$', raw.decode('utf-8-sig'), re.M | re.I)))
    require(0 < len(dlls) <= 128 and all(re.fullmatch(r'[A-Z0-9_.+-]+\.DLL', x) for x in dlls), 'Bounded DLL import list required')
    equal(report.get('dlls'), dlls, 'Dependency DLL list differs from actual imports')
    equal(report.get('apiSets'), [x for x in dlls if re.match(r'^(API|EXT)-MS-', x)], 'API-set list differs')
    require(not any(re.match(r'^(VCRUNTIME\d|MSVCP\d|CONCRT\d|VCOMP\d|UCRTBASED\.)', x) for x in dlls), 'External VC runtime dependency found')
    require(report.get('extraVcRuntimeDlls') == [] and 'WEBVIEW2LOADER.DLL' not in dlls and
            report.get('webview2Loader') == 'static-no-loader-dll-import' and
            report.get('webview2Runtime') == 'external-existing-Evergreen' and
            report.get('nodeOrPnpmRequiredAtRuntime') is False, 'Runtime dependency policy mismatch')
    return {'rawImportsSha256': sha(raw), 'dlls': dlls}


def package_policy(inspection, delivery, source, version, run, attempt):
    require(INSPECTION_NAMES <= inspection.keys(), 'Complete packaging inspection evidence required')
    packaging = parse(inspection['packaging-record.json'])
    manifest = parse(delivery['manifest.json'])
    for value in (packaging, manifest):
        require(value.get('schema') == 1 and value.get('candidateSha') == source.candidate and value.get('version') == version and
                str(value.get('runId')) == run and value.get('platform') == 'windows-x86_64', 'Package source/version/run mismatch')
        require(value.get('runUrl') == f'https://github.com/Auto-Plugin/milkup/actions/runs/{run}', 'Package run URL mismatch')
        require(value.get('signing') == 'unsigned' and value.get('artifactRetentionDays') == 7, 'Unsigned trial/retention mismatch')
    require(str(packaging.get('runAttempt')) == attempt and packaging.get('nsisInstallMode') == 'currentUser' and
            packaging.get('webviewInstallMode') == 'skip' and packaging.get('existingEvergreenRequired') is True and
            packaging.get('officialRelease') is False, 'Packaging current-user/no-runtime policy mismatch')
    require(manifest.get('status') == 'verified-for-user-trial' and manifest.get('deliveryReady') is True and
            manifest.get('installerExecuted') is True and manifest.get('releaseCreated') is False and
            manifest.get('installMode') == 'currentUser' and manifest.get('webviewInstallMode') == 'skip; existing Evergreen required',
            'Final trial declaration mismatch; raw acceptance is separately revalidated')
    for key in ('realImeAccepted', 'systemDpiMatrixAccepted', 'visualReviewAccepted'):
        require(manifest.get(key) is False, 'Unsupported acceptance claim: ' + key)
    require(parse(source.read('package.json')).get('version') == version, 'Candidate source version mismatch')
    P._outer_sources(inspection, source.candidate)
    for phase in ('checkout', 'desktop-check', 'final'):
        for item in parse(inspection[f'mermaid-source-{phase}.json'])['files']:
            data = source.read(item['path'])
            match_bytes(item['head'], data, 'Source snapshot HEAD differs from exact Git candidate')
    installer_name = f'milkup-{version}-windows-x64-{source.candidate[:12]}-setup.exe'
    require(manifest['installer'].get('deliveredName') == installer_name, 'Exact installer delivery name required')
    for role in ('installer', 'compiledApplication', 'extractedApplication'):
        item = packaging[role]
        require(item.get('signature') == 'NotSigned' and item.get('productVersion') == version and
                type(item.get('bytes')) is int and 0 < item['bytes'] <= 80 * MIB and
                re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')), 'Invalid binary identity: ' + role)
        delivered = dict(manifest[role]); delivered.pop('deliveredName', None)
        equal(delivered, item, 'Delivery binary identity differs from packaging: ' + role)
    match_bytes(packaging['installer'], delivery[installer_name], 'Actual delivered installer bytes differ')
    require(delivery[installer_name][:2] == b'MZ', 'Windows installer header required')
    inp = parse(inspection['installer-input.json'])
    require(inp.get('schema') == 1 and inp.get('candidateSha') == source.candidate and inp.get('version') == version and
            inp.get('builtBinarySha256') == packaging['compiledApplication']['sha256'] and
            inp.get('expectedInstalledBinarySha256') == packaging['extractedApplication']['sha256'] and
            inp.get('installMode') == 'currentUser' and inp.get('webviewInstallMode') == 'skip', 'Installer input identity mismatch')
    icon = source.read('apps/desktop/src-tauri/icons/file.ico')
    equal(inp.get('resources'), [{'relativePath': 'file.ico', **record(icon)}], 'Exact candidate icon resource required')
    verification = parse(inspection['public-plugins-verification.json'])
    equal(manifest.get('verification'), verification, 'Delivery verification differs from original inspection')
    require(verification.get('schema') == 1 and verification.get('status') == 'passed' and
            verification.get('candidateSha') == source.candidate and verification.get('version') == version,
            'Plugin/engine verification source mismatch')
    dep = parse(inspection['windows-runtime-dependencies.json'])
    for supplied in (packaging.get('dependencies'), manifest.get('dependencies'), verification.get('dependencies')):
        equal(supplied, dep, 'Runtime reports differ')
    dependency_proof = dependencies(dep, inspection['windows-runtime-imports.log'], packaging['extractedApplication']['sha256'])
    nsis = parse(inspection['nsis-image-proof.json'])
    equal(verification.get('nsis'), nsis, 'NSIS proof differs from inspected record')
    require(nsis.get('status') == 'passed' and nsis.get('transform') == 'tauri-cli-2.11.4-unique-UNK-to-NSS' and
            nsis.get('changedBytes') == 3 and nsis.get('compiledSha256') == packaging['compiledApplication']['sha256'] and
            nsis.get('expectedNsisSha256') == packaging['extractedApplication']['sha256'] and
            P._outer_path(nsis.get('path')) == P._outer_path(packaging['extractedApplication']['path']) and
            type(nsis.get('markerOffset')) is int and 0 <= nsis['markerOffset'] < packaging['extractedApplication']['bytes'] - 25,
            'Original exact NSS image proof mismatch')
    require(isinstance(nsis.get('files'), list) and len(nsis['files']) <= 256, 'Bounded NSIS file inventory required')
    exact = [x for x in nsis['files'] if x.get('exactMatch') is True]
    require(len(exact) == 1 and exact[0].get('sha256') == packaging['extractedApplication']['sha256'] and
            exact[0].get('bytes') == packaging['extractedApplication']['bytes'], 'Unique actual NSS image record required')
    return {'packaging': packaging, 'manifest': manifest, 'installerInput': inp, 'verification': verification,
            'nsis': nsis, 'nsisMember': exact[0]['relativePath'].replace('\\', '/'), 'dependencies': dependency_proof,
            'installerName': installer_name}


def plugin_packages(package, delivery, source):
    plugins = parse(delivery['plugins.json'])
    equal(plugins, package['manifest'].get('plugins'), 'Delivered plugin inventories differ')
    equal(plugins, package['verification'].get('plugins'), 'Inspection plugin inventory differs')
    require(isinstance(plugins, list) and len(plugins) == 10 and len({p['id'] for p in plugins}) == 10, 'Ten distinct plugins required')
    wanted = {m['id']: (m, e) for m, e in source.inventory()}
    require(set(wanted) == {p['id'] for p in plugins}, 'Plugins differ from exact candidate Windows inventory')
    for plugin in plugins:
        manifest, entry = wanted[plugin['id']]
        name = f"{manifest['id']}-{manifest['version']}.milkup-plugin"
        require(plugin.get('archiveFile') == name and plugin.get('version') == manifest['version'] and
                plugin.get('host') == 'worker' and plugin.get('bundled') is True and
                plugin.get('enabledByDefault') is False and plugin.get('standaloneArchiveRequired') is False, 'Plugin delivery contract mismatch')
        equal(plugin.get('permissions'), manifest.get('permissions'), 'Plugin permissions differ from source')
        raw = delivery['plugins/' + name]; match_bytes(plugin, raw, 'Archive hash/length differs')
        archive = parse(raw)
        require(archive.get('format') == 'milkup-plugin' and archive.get('version') == 1, 'Invalid archive format')
        equal(archive.get('manifest'), manifest, 'Archive manifest differs from exact source')
        if plugin['id'] == 'milkup.diagrams':
            seals = package_seals(archive)
            reviewed = source.read('apps/desktop/src/reviewed-mermaid-package.ts').decode()
            for key in ('manifestSha256', 'contentSha256'):
                found = re.findall(r'\b' + key + r": '([a-f0-9]{64})'", reviewed)
                require(found == [seals[key]], 'Exact reviewed native package seal mismatch')
            equal(plugin.get('reviewedNativeSeals'), seals, 'Delivery Mermaid seals differ from actual package bytes')
    compact = [{key: p[key] for key in ('id', 'version', 'archiveFile', 'bytes', 'sha256')} for p in plugins]
    equal(package['installerInput'].get('bundledPlugins'), compact, 'Installed input plugins differ from actual delivery archives')
    return {'plugins': len(plugins), 'sourceManifestsVerified': True, 'mermaidActualSealsVerified': True}


def package_seals(archive):
    canonical = lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    manifest = canonical(archive['manifest']); files = {'plugin.json': manifest}
    require(isinstance(archive.get('files'), list) and len(archive['files']) <= 1024, 'Bounded package entries required')
    for item in archive['files']:
        name = item.get('path')
        require(isinstance(name, str) and re.fullmatch(r'(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+', name) and
                all(x not in ('.', '..') for x in name.split('/')) and name not in files, 'Unsafe/duplicate plugin file')
        require(isinstance(item.get('content'), str) and item.get('encoding') in ('utf8', 'base64'), 'Invalid archive resource encoding')
        data = item['content'].encode() if item['encoding'] == 'utf8' else base64.b64decode(item['content'], validate=True)
        if item['encoding'] == 'base64': require(base64.b64encode(data).decode() == item['content'], 'Noncanonical base64')
        files[name] = data
    seals = {name: {'sha256': sha(files[name]), 'bytes': len(files[name])} for name in sorted(files)}
    serialized = json.dumps(seals, ensure_ascii=False, separators=(',', ':')).encode()
    return {'manifestSha256': sha(manifest), 'contentSha256': sha(serialized)}


def installation_account(files, kind, package, source):
    installation = parse(files['installation-result.json']); comparison = parse(files['installed-binary-comparison.json'])
    outer = parse(files['windows-standard-product-audit.json']); product = parse(files['mermaid-product-e2e.json'])
    sid, session = outer['accountSid'], outer['standardContext']['sessionId']
    packaging, inp = package['packaging'], package['installerInput']
    require(installation.get('schema') == 1 and installation.get('status') == 'passed' and
            installation.get('mode') == 'nsis-current-user' and installation.get('candidateSha') == source.candidate and
            installation.get('expectedAccountKind') == kind and installation.get('actualSid') == installation.get('expectedSid') == sid and
            installation.get('sessionId') == installation.get('expectedSessionId') == session and installation.get('productAcceptance') == 'passed' and
            installation.get('cleanupErrors') == [], 'Installed account identity/acceptance mismatch')
    context = outer['standardContext']; scratch = P._outer_path(context['scratchRoot'])
    require(P._outer_path(installation['installDirectory']) == scratch + '/install' and
            P._outer_path(installation['installedBinary']['path']) == scratch + '/install/milkup-desktop.exe',
            'Installation escaped exact fresh-account destination')
    expected_image = packaging['extractedApplication']; actual_image = installation['installedBinary']
    for key in ('bytes', 'sha256'): equal(actual_image.get(key), expected_image[key], 'Installed full-image identity differs')
    require(actual_image.get('productVersion') == actual_image.get('fileVersion') == package['manifest']['version'] and
            actual_image.get('peMachine') == '0x8664', 'Installed PE version/architecture mismatch')
    require(product['applicationSha256'] == actual_image['sha256'] and P._outer_path(product['application']) == P._outer_path(actual_image['path']),
            'Product was not launched from the actually installed image')
    for key in ('bytes', 'sha256'): equal(installation['installer'].get(key), packaging['installer'][key], 'Different installer under account')
    require(P._outer_path(installation['installer']['path']) == P._outer_path(outer['stage']) + '/code/candidate-installer.exe', 'Actual staged installer path mismatch')
    run = installation['installerRun']; captured_run(run, 'Installer', files, 'installer-stdout.log', 'installer-stderr.log')
    require(run.get('identityRequired') is True and run.get('identityVerified') is True and run.get('expectedAccountKind') == kind,
            'Actual same-account installer gate missing')
    for identity in (run['callerIdentity'], run['startedProcess']):
        P._outer_host(identity.get('token'), sid, session, kind)
        require(identity.get('sessionId') == session and identity.get('inJob') is True and
                identity.get('expectedAccountKind') == kind and identity.get('accountKindVerified') is True, 'Installer identity observation mismatch')
    require(run['callerIdentity']['pid'] == outer['supervisor']['pid'] and run['startedProcess']['pid'] == run['pid'] and
            run['startedProcess']['imageTruncated'] is False and
            P._outer_path(run['startedProcess']['image']) == P._outer_path(installation['installer']['path']) and
            re.fullmatch(r'[1-9][0-9]*', run['startedProcess'].get('creationFileTime', '')), 'Exact held installer process identity missing')
    compare_run = installation['comparisonRun']; captured_run(compare_run, 'Node', files, 'installed-binary-comparison.json', 'installed-binary-comparison-stderr.log')
    require(compare_run.get('identityRequired') is False and compare_run.get('identityVerified') is False and
            compare_run.get('expectedAccountKind') is None, 'Comparison process must keep non-installer dispatch')
    equal(installation.get('binaryComparison'), comparison, 'Actual stdout comparison differs from embedded record')
    expected = {'status': 'passed', 'bytes': expected_image['bytes'], 'builtSha256': packaging['compiledApplication']['sha256'],
                'expectedInstalledSha256': expected_image['sha256'], 'installedSha256': expected_image['sha256'],
                'bundleMarkerOffset': package['nsis']['markerOffset'], 'transformation': '__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS', 'bundlerVersion': '2.9.4'}
    equal(comparison, expected, 'Actual full byte-comparison result differs')
    equal(installation.get('bundledPlugins'), inp['bundledPlugins'], 'Installed plugin input inventory differs')
    equal(installation.get('resources'), [{**x, 'verified': True} for x in inp['resources']], 'Installed icon bytes were not verified')
    require(installation.get('embeddedPluginBinding') == 'exact-installed-image-byte-comparison', 'Embedded plugin byte binding missing')
    observed = product['steps'][0].get('bundledPluginsObserved')
    require(isinstance(observed, list) and len(observed) == 10 and len({x['id'] for x in observed}) == 10, 'Ten distinct actual initial plugin observations required')
    versions = {x['id']: x['version'] for x in inp['bundledPlugins']}
    require({x['id'] for x in observed} == set(versions), 'Actual UI plugin ID inventory differs')
    for item in observed:
        require(item.get('version') == versions[item['id']] and item.get('checked') == 'false' and item.get('busy') != 'true',
                'Actual initial plugin version/enabled/busy state rejected')
    return {'expectedAccountKind': kind, 'sid': sid, 'applicationSha256': actual_image['sha256'],
            'installerSha256': installation['installer']['sha256'], 'observedInitiallyDisabledPlugins': 10,
            'heldInstallerPid': run['pid'], 'installerInJobObserved': True,
            'installerExactJobHandleIndependentlyQueried': False, 'fullByteComparisonReportedByActualRun': True}


def captured_run(run, label, files, stdout, stderr):
    P._outer_flags(run, ('started', 'exited', 'streamsDrained'), ('timedOut', 'captureExceeded', 'forcedNodeTermination',
                   'forcedProcessTermination', 'useShellExecute', 'credentialsSpecified', 'breakawayRequested'))
    require(run.get('status') == 'passed' and run.get('tool') == label and type(run.get('exitCode')) is int and
            run['exitCode'] == 0 and run.get('error') is None and run.get('cleanupErrors') == [] and
            P._outer_int(run.get('pid'), 1) and run.get('captureLimitPerStream') == 2 * MIB,
            'Actual captured process did not pass/clean: ' + label)
    require(run.get('stdoutBytes') == len(files[stdout]) and run.get('stderrBytes') == len(files[stderr]), 'Captured process log byte counts differ')


def bind_delivery_reports(delivery, account_files, package, inspection):
    acceptance = package['manifest']['installationAcceptance']; final = parse(inspection['mermaid-trial-finalization.json'])
    require(acceptance.get('status') == 'passed' and acceptance.get('requiredAccountKinds') == list(KINDS) and
            set(acceptance.get('accounts', {})) == set(KINDS) and acceptance.get('naturalUiCloses') == 8, 'Dual-account acceptance declaration mismatch')
    require(final.get('schema') == 1 and final.get('candidateSha') == package['manifest']['candidateSha'] and
            final.get('status') == 'passed' and final.get('deliveryReady') is True, 'Finalization identity mismatch')
    equal(final.get('installed'), acceptance, 'Finalization installed matrix differs')
    for kind in KINDS:
        account = acceptance['accounts'][kind]
        require(account.get('status') == 'passed' and account.get('expectedAccountKind') == kind and
                account.get('applicationSha256') == package['packaging']['extractedApplication']['sha256'], 'Declared account identity mismatch')
        reports = account['records']; require(len(reports) == 4 and {x['name'] for x in reports} == set(REPORTS), 'Four raw account report bindings required')
        for item in reports:
            name = item['name']; data = delivery[f'reports/{kind}/{name}']
            require(data == account_files[kind][name], 'Delivery raw report differs byte-for-byte: ' + kind + '/' + name)
            match_bytes(item, data, 'Manifest raw report proof differs')
        product = parse(account_files[kind]['mermaid-product-e2e.json'])
        equal(account['runtime'], product['runtime'], 'Declared actual runtime differs')
        equal(account['account'], {'sid': product['context']['actualSid'], 'sessionId': product['context']['sessionId']}, 'Declared account SID/session differs')
        expected_pixels = [{'name': img['file'], 'bytes': len(account_files[kind][img['file']]), 'sha256': sha(account_files[kind][img['file']])}
                           for step in product['steps'] for img in (step.get('screenshot'), step.get('image')) if img]
        equal(account.get('pixels'), expected_pixels, 'Manifest pixel list differs from raw retained PNGs')
    return {'rawReportsByteIdentical': 8, 'accountKinds': list(KINDS)}

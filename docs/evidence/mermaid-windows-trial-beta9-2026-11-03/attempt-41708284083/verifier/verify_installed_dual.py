#!/usr/bin/env python3
"""Explicit, offline three-artifact installed-product verifier.

No network or payload execution. Inputs remain untouched. Native acceptance is
replayed only through the exact frozen candidate's pure Node exports. Static
7-Zip reads one API-hash-bound NSIS member; it never launches Windows software.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import traceback

from archive_integrity import verify_archive
import product_evidence as P
import package_evidence as K
import cleanup_observations as O
from static_installer import inspect_static

MIB = 1024 * 1024


def checksum_manifest(files):
    P.require('SHA256SUMS.txt' in files, 'Delivery checksums missing')
    checksums = {}
    for line in files['SHA256SUMS.txt'].decode('ascii').splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([A-Za-z0-9_./-]+)', line)
        P.require(match is not None and match[2] not in checksums, 'Malformed/duplicate delivery checksum')
        checksums[match[2]] = match[1]
    P.require(set(checksums) == set(files) - {'SHA256SUMS.txt'}, 'Delivery checksum exact file set differs')
    for name, expected in checksums.items():
        P.require(P.sha256(files[name]) == expected, 'Delivery checksum differs: ' + name)
    return {'filesHashed': len(checksums), 'checksumFileSha256': P.sha256(files['SHA256SUMS.txt'])}


def preparation_finalization(inspection, delivery):
    preparation = P.parse_json(inspection['mermaid-trial-preparation.json'])
    final = P.parse_json(inspection['mermaid-trial-finalization.json'])
    manifest = P.parse_json(delivery['manifest.json'])
    for value in (preparation, final):
        P.require(value.get('schema') == 1 and value.get('candidateSha') == manifest['candidateSha'], 'Preparation/finalization source differs')
    P.require(preparation.get('status') == 'prepared', 'Preparation record missing')
    for field, name in [('packagingSha256', 'packaging-record.json'), ('installerInputSha256', 'installer-input.json'),
                        ('verificationSha256', 'public-plugins-verification.json')]:
        P.require(preparation.get(field) == P.sha256(inspection[name]), 'Preparation input bytes changed: ' + field)
    records = final.get('files')
    P.require(isinstance(records, list) and len(records) <= 31, 'Bounded finalized payload records required')
    named = set()
    for item in records:
        name = item.get('name')
        P.require(name in delivery and name != 'SHA256SUMS.txt' and name not in named, 'Unknown/duplicate final payload file')
        named.add(name); K.match_bytes(item, delivery[name], 'Final payload file bytes differ: ' + name)
    P.require(named == set(delivery) - {'SHA256SUMS.txt'}, 'Final payload set differs')
    P.require(final.get('checksumsSha256') == P.sha256(delivery['SHA256SUMS.txt']), 'Final checksum record changed')
    # Preparation records precede the final README/manifest and contain no
    # reports; only immutable payload members can be compared to final bytes.
    before = preparation.get('files')
    P.require(isinstance(before, list) and len(before) <= 31, 'Bounded initial payload list required')
    initial_names = set()
    for item in before:
        name = item['name']; P.require(name not in initial_names and name in delivery and not name.startswith('reports/'), 'Initial payload file set rejected')
        initial_names.add(name)
        if name not in ('README.md', 'manifest.json'): K.match_bytes(item, delivery[name], 'Immutable prepared payload changed')
    P.require(initial_names == set(delivery) - {'SHA256SUMS.txt'} - {n for n in delivery if n.startswith('reports/')},
              'Unexpected preparation file inventory')
    return {'finalFilesBound': len(named), 'immutablePreparedFilesBound': len(before) - 2}


def manifest_resource(inspection, package):
    import xml.etree.ElementTree as ET
    proof = P.parse_json(inspection['packaged-production-binary-manifest.json'])
    raw = inspection['packaged-production-binary.manifest']
    P.require(len(raw) <= 32768 and b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper(), 'Bounded non-DTD application manifest required')
    text = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('utf-8-sig')
    P.require(proof.get('status') == 'passed' and proof.get('extractExitCode') == 0 and
              str(proof.get('sha256', '')).lower() == str(proof.get('sha256After', '')).lower() == package['packaging']['extractedApplication']['sha256'] and
              proof.get('manifest') == text and proof.get('commonControlsVersion') == '6.0.0.0', 'Actual application-manifest binding differs')
    root = ET.fromstring(raw)
    controls = [node for node in root.iter('{urn:schemas-microsoft-com:asm.v1}assemblyIdentity') if node.get('name') == 'Microsoft.Windows.Common-Controls']
    P.require(len(controls) == 1, 'Unique Common Controls dependency required')
    node = controls[0]
    P.require(node.get('type') == 'win32' and node.get('version') == '6.0.0.0' and node.get('publicKeyToken') == '6595b64144ccf1df' and
              node.get('processorArchitecture') in ('*', 'amd64') and node.get('language') == '*', 'Application manifest identity differs')
    return {'actualManifestSha256': P.sha256(raw), 'commonControlsVersion': '6.0.0.0'}


def staged_plugins(inspection, package):
    staged = P.parse_json(inspection['public-plugins-staged-bundles.json'])
    plugins = package['manifest']['plugins']; verification = package['verification']
    P.require(isinstance(staged, list) and len(staged) == 10 and len({x['name'] for x in staged}) == 10, 'Exact staged plugin records required')
    P.require(verification.get('stagingSha256') == P.sha256(inspection['public-plugins-staged-bundles.json']), 'Staging bytes changed')
    by_name = {x['name']: x for x in staged}
    archives = verification.get('dist', {}).get('archives'); modules = verification.get('dist', {}).get('modules')
    P.require(isinstance(archives, list) and len(archives) == 10 and len({x['id'] for x in archives}) == 10 and
              isinstance(modules, list) and 0 < len(modules) <= 128 and len({x['name'] for x in modules}) == len(modules), 'Reachable dist archive/module evidence incomplete')
    module_names = {x['name'] for x in modules}
    for plugin in plugins:
        stage = by_name[plugin['archiveFile']]
        for key in ('bytes', 'sha256', 'host', 'buildMode'): K.equal(stage.get(key), plugin.get(key), 'Staged plugin identity differs: ' + key)
        P.require(stage.get('outputImports') == [] and stage.get('mode') == plugin['buildMode'], 'Staged external import/build mode mismatch')
        K.equal(plugin.get('buildInputVerification'), {key: stage[key] for key in ('metafileSha256', 'dependencyInputs', 'outputImports')}, 'Plugin build-input records differ')
        matches = [x for x in archives if x['id'] == plugin['id']]
        P.require(len(matches) == 1, 'Unique actual embedded archive observation missing')
        archive = matches[0]
        for key in ('version', 'bytes', 'sha256'): K.equal(archive.get(key), plugin[key], 'Embedded dist literal archive differs')
        P.require(archive.get('module') in module_names and type(archive.get('literalStart')) is int and
                  type(archive.get('literalEnd')) is int and 0 <= archive['literalStart'] < archive['literalEnd'], 'Embedded archive literal range invalid')
    return {'stagedArchivesBound': 10, 'originalAstLiteralObservationsBound': 10,
            'distModulesLocallyReparsed': False, 'scope': 'Dist modules are not included; original AST observations bind to the exact installed image reports'}


def verify(args):
    P.require(re.fullmatch(r'[a-f0-9]{40}', args.candidate) and re.fullmatch(r'[1-9][0-9]*', args.run) and
              re.fullmatch(r'[1-9][0-9]*', args.attempt) and re.fullmatch(r'2\.0\.0-beta\.[1-9][0-9]*', args.version), 'Explicit candidate/run/attempt/beta version required')
    result = {'schema': 1, 'candidateSha': args.candidate, 'version': args.version, 'runId': args.run, 'runAttempt': args.attempt,
              'scope': 'Offline exact dual-account installed-product evidence and delivery verification',
              'artifactIntegrityVerified': False, 'installationEvidenceVerified': False,
              'productAcceptanceVerified': False, 'overallAccepted': False,
              'artifacts': {}, 'checks': {}, 'accounts': {}, 'errors': [], 'networkAccessed': False,
              'installerExecuted': False, 'pluginsExecuted': False, 'windowsProcessesStarted': False}

    def check(name, function):
        try:
            value = function(); result['checks'][name] = {'passed': True, 'result': value}; return value
        except Exception as error:
            entry = {'passed': False, 'error': P.error_message(error)}
            if hasattr(error, 'details'): entry['details'] = error.details
            result['checks'][name] = entry; result['errors'].append({'check': name, **entry}); return None

    source = K.FrozenSource(args.repo, args.candidate)
    # Numeric deletion retries are pinned to this reviewed source contract.
    def cleanup_source_contract():
        data = source.read('apps/desktop/src-tauri/mermaid-engine/src/cleanup.rs')
        for fragment in (b'Some(5 | 32 | 33)', b'const ATTEMPTS: usize = 31;',
                         b'const INTERVAL: Duration = Duration::from_millis(100);',
                         b'const RETRY_DEADLINE: Duration = Duration::from_secs(3);'):
            P.require(fragment in data, 'Frozen cleanup retry contract differs')
        O.CONTRACT_COMMIT = args.candidate
        return K.record(data)
    check('cleanupSourceContract', cleanup_source_contract)
    provenance = check('frozenHarness', lambda: K.verify_harness(source, args.harness, args.harness_provenance))
    if provenance:
        P.configure(candidate=args.candidate, run_id=args.run, attempt=args.attempt, harness=args.harness,
                    harness_sha=provenance['lf']['sha256'], windows_harness_sha=provenance['windowsCRLF']['sha256'])
    installer_name = f'milkup-{args.version}-windows-x64-{args.candidate[:12]}-setup.exe'
    inventory = check('candidatePluginInventory', lambda: [{'id': m['id'], 'version': m['version']} for m, _ in source.inventory()])
    deliver_names = {'README.md', 'FEEDBACK.md', 'MERMAID-LICENSE.txt', 'manifest.json', 'plugins.json', 'SHA256SUMS.txt', installer_name}
    deliver_names |= {f'samples/{x}.md' for x in P.FIXTURES}
    deliver_names |= {f'reports/{kind}/{name}' for kind in K.KINDS for name in K.REPORTS}
    if inventory: deliver_names |= {f"plugins/{x['id']}-{x['version']}.milkup-plugin" for x in inventory}
    specifications = {
        'installed': (f'mermaid-installed-evidence-{args.run}-{args.attempt}', {f'{kind}/{name}' for kind in K.KINDS for name in P.ALLOWED | {'artifact-manifest.json'}}, 192, 256 * MIB,
                      lambda name: 32 * MIB if name.endswith('.png') else 2 * MIB),
        'inspection': (f'mermaid-installer-inspection-{args.run}-{args.attempt}', K.INSPECTION_NAMES | {'manifest.json'}, 16, 32 * MIB, 2 * MIB),
        'delivery': (f'milkup-{args.version}-mermaid-windows-x64-{args.candidate}', deliver_names, 32, 128 * MIB,
                     lambda name: 80 * MIB if name == installer_name else 64 * MIB if name.startswith('plugins/') else 4 * MIB),
    }
    contents = {}
    for role, (name, allowed, count, total, limit) in specifications.items():
        try:
            summary, files = verify_archive(getattr(args, role + '_api'), getattr(args, role + '_zip'), expected_name=name,
                run_id=args.run, candidate=args.candidate, allowed_names=allowed, max_files=count,
                max_total_bytes=total, max_file_bytes=limit)
            result['artifacts'][role] = summary; contents[role] = files
        except Exception as error:
            result['artifacts'][role] = {'integrityVerified': False, 'error': P.error_message(error)}
            result['errors'].append({'artifact': role, 'error': P.error_message(error)})
    groups, manifest_checks = {}, []
    installed = contents.get('installed', {})
    if installed:
        # Manifest provenance constants are required even if frozen harness is
        # unavailable: byte integrity must remain assessable independently.
        P.CANDIDATE, P.RUN_ID, P.ATTEMPT = args.candidate, args.run, args.attempt
        for kind in K.KINDS:
            files = {name.split('/', 1)[1]: data for name, data in installed.items() if name.startswith(kind + '/')}
            groups[kind] = files
            value = check(kind + '/artifactManifest', lambda files=files: P.validate_manifest(files))
            manifest_checks.append(value is not None)
    inspection, delivery = contents.get('inspection', {}), contents.get('delivery', {})
    if inspection: manifest_checks.append(check('inspectionManifest', lambda: K.inspection_manifest(inspection, args.candidate)) is not None)
    if delivery: manifest_checks.append(check('deliveryChecksums', lambda: checksum_manifest(delivery)) is not None)
    result['artifactIntegrityVerified'] = len(contents) == 3 and len(manifest_checks) == 4 and all(manifest_checks)
    package = check('packagePolicy', lambda: K.package_policy(inspection, delivery, source, args.version, args.run, args.attempt)) if inspection and delivery else None
    if package:
        check('actualPluginPackages', lambda: K.plugin_packages(package, delivery, source))
        check('stagedAndEmbeddedPluginBindings', lambda: staged_plugins(inspection, package))
        check('preparationFinalizationBindings', lambda: preparation_finalization(inspection, delivery))
        check('actualApplicationManifest', lambda: manifest_resource(inspection, package))
        check('staticNsisImageAndAssets', lambda: inspect_static(delivery[installer_name], package, source, args.sevenzip))
        check('eightOriginalDeliveryReports', lambda: K.bind_delivery_reports(delivery, groups, package, inspection))
        check('originalSourceSnapshotsMatch', lambda: all_snapshots_equal(inspection, groups))
    for kind in K.KINDS:
        files = groups.get(kind, {}); account = {'present': bool(files), 'accepted': False, 'decodedPngs': []}; result['accounts'][kind] = account
        if not files: continue
        decoded = []
        for name, data in files.items():
            if not name.endswith('.png'): continue
            proof = check(kind + '/PNG/' + name, lambda data=data: P.decode_png(data))
            if proof: decoded.append({'name': name, **K.record(data), **proof})
        account['decodedPngs'] = decoded
        if provenance:
            account['product'] = check(kind + '/strictProduct', lambda: P.validate_product(files, kind, decoded))
            account['availableNativeLedger'] = check(kind + '/availableNativeLedger', lambda: partial_ledger(files, kind))
            account['cleanupObservations'] = check(kind + '/cleanupObservations', lambda: cleanup_observations(files))
        if package:
            account['installation'] = check(kind + '/actualInstallation', lambda: K.installation_account(files, kind, package, source))
        account['accepted'] = bool(account.get('product') and account.get('installation') and account.get('cleanupObservations') and account.get('availableNativeLedger'))
    result['productAcceptanceVerified'] = all(result['accounts'][kind].get('product') for kind in K.KINDS)
    result['installationEvidenceVerified'] = all(result['accounts'][kind].get('installation') for kind in K.KINDS)
    if result['installationEvidenceVerified']:
        check('distinctFreshAccountSids', lambda: distinct_sids(result['accounts']))
    result['overallAccepted'] = result['artifactIntegrityVerified'] and all(x['accepted'] for x in result['accounts'].values()) and not result['errors']
    result['status'] = 'passed' if result['overallAccepted'] else 'failed'
    result['acceptedNativeJobs'] = sum(x.get('product', {}).get('nativeJobs', 0) for x in result['accounts'].values() if x.get('product'))
    result['acceptedNativePngs'] = sum(x.get('product', {}).get('matchedPngs', 0) for x in result['accounts'].values() if x.get('product'))
    result['naturalUiCloses'] = sum(x.get('product', {}).get('naturalUiCloses', 0) for x in result['accounts'].values() if x.get('product'))
    result['limitations'] = ['Compiled EXE and built dist modules are not in these artifacts; original actual full-byte/AST reports are bound, not independently rebuilt.',
        'Static NSIS inspection independently checks the delivered application bytes and complete fixed engine/bootstrap sources.',
        'Original close monotonic deadline is not serialized; the exact frozen harness acceptance and held exit are replayed without reconstructing it.',
        'No new Windows execution, real IME, DPI matrix, upgrade/rollback, or human visual acceptance is inferred.']
    result['verifierFiles'] = {path.name: K.record(path.read_bytes()) for path in sorted(Path(__file__).parent.glob('*.py'))}
    result['frozenCandidateSourceBlobs'] = {name: K.record(data) for name, data in sorted(source.cache.items())}
    return result


def all_snapshots_equal(inspection, groups):
    for kind in K.KINDS:
        for phase in ('checkout', 'desktop-check', 'final'):
            name = f'mermaid-source-{phase}.json'
            P.require(groups[kind][name] == inspection[name], 'Account and original build source snapshots differ: ' + kind + '/' + phase)
    return {'rawSourceSnapshotsByteIdentical': 6}


def distinct_sids(accounts):
    sids = [accounts[k]['installation']['sid'] for k in K.KINDS]
    P.require(len(set(sids)) == 2, 'Two fresh account SIDs must be distinct')
    return {'distinctFreshAccounts': 2}


def partial_ledger(files, kind):
    report = P.parse_json(files['mermaid-product-e2e.json']); context = P.parse_json(files['standard-context.json'])
    records = P.read_native_records(files)
    K.equal(report.get('nativeAudit'), records, 'Reported native events differ from actual product stdout/stderr logs')
    return P.run_node({'mode': 'ledger', 'records': records, 'sid': context['actualSid'], 'sessionId': context['sessionId'],
                       'account': kind, 'productPids': [x['productPid'] for x in report['launches']]})


def cleanup_observations(files):
    value = O.validate_cleanup_observation_events(P.read_native_records(files))
    P.require(value.get('observationEvidenceVerified') is True and value.get('hasFinishedEvidence') is True,
              'Closed native cleanup observations rejected/missing: ' + str(value)[:1000])
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate', 'version', 'run', 'harness', 'harness-provenance', 'sevenzip', 'output'):
        parser.add_argument('--' + name, required=True)
    for role in ('installed', 'inspection', 'delivery'):
        parser.add_argument('--' + role + '-api', required=True); parser.add_argument('--' + role + '-zip', required=True)
    parser.add_argument('--attempt', default='1'); parser.add_argument('--repo', default='/workspace/milkup-mermaid-rebuild')
    args = parser.parse_args(); output = Path(args.output)
    P.require(not output.exists(), 'Result path must be new; never overwrite prior evidence')
    result = verify(args)
    with output.open('x') as stream: json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'status': result['status'], 'artifactIntegrityVerified': result['artifactIntegrityVerified'],
                      'overallAccepted': result['overallAccepted'], 'errors': result['errors'], 'output': str(output)}, ensure_ascii=False))
    return 0 if result['overallAccepted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

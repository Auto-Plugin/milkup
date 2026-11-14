"""Read preserved actual evidence; never infer delivery acceptance from two artifacts."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'verifier'))
import product_evidence as P
import package_evidence as K
import verify_installed_dual as V
import cleanup_observations as O
from archive_integrity import verify_archive

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
ROOT = Path(__file__).resolve().parent
CANDIDATE = '0811b899ea4c4f98294046f66524d4503307d279'
SOURCE = K.FrozenSource(args.repo, CANDIDATE)
proof = K.verify_harness(SOURCE, ROOT / 'candidate-mermaid-product-e2e.mjs', ROOT / 'harness-exact-windows-checkout-provenance.json')
P.configure(candidate=CANDIDATE, run_id='41708284083', attempt='1', harness=ROOT / 'candidate-mermaid-product-e2e.mjs', harness_sha=proof['lf']['sha256'], windows_harness_sha=proof['windowsCRLF']['sha256'])
O.CONTRACT_COMMIT = CANDIDATE
def verify_preserved_artifacts():
    summaries = {}
    for role, name, allowed, count, total, limit in [
        ('installed', 'mermaid-installed-evidence-41708284083-1',
         {f'{k}/{n}' for k in K.KINDS for n in P.ALLOWED | {'artifact-manifest.json'}},
         192, 256 * 1024**2, lambda n: 32 * 1024**2 if n.endswith('.png') else 2 * 1024**2),
        ('inspection', 'mermaid-installer-inspection-41708284083-1',
         K.INSPECTION_NAMES | {'manifest.json'}, 16, 32 * 1024**2, 2 * 1024**2)]:
        summary, files = verify_archive(ROOT / (role + '-artifact-api.json'), ROOT / (name + '.zip'),
            expected_name=name, run_id='41708284083', candidate=CANDIDATE, allowed_names=allowed,
            max_files=count, max_total_bytes=total, max_file_bytes=limit)
        extracted = ROOT / 'extracted' / role
        entries = list(extracted.rglob('*'))
        P.require(not any(f.is_symlink() for f in entries), 'Symlink in archived extraction')
        actual = {f.relative_to(extracted).as_posix(): f.read_bytes() for f in entries if f.is_file()}
        K.equal(actual, files, 'Archived extracted file bytes/set differ from API-bound ZIP')
        summaries[role] = summary
        if role == 'installed':
            summaries['accountManifests'] = {k:P.validate_manifest({n.split('/',1)[1]:v for n,v in files.items() if n.startswith(k+'/')}) for k in K.KINDS}
        else:
            summaries['inspectionManifest'] = K.inspection_manifest(files, CANDIDATE)
    run = P.parse_json((ROOT / 'run-final-api.json').read_bytes())
    P.require(run['id'] == 41708284083 and run['head_sha'] == CANDIDATE and run['run_attempt'] == 1 and
              run['status'] == 'completed' and run['conclusion'] == 'failure' and
              run['path'] == '.github/workflows/mermaid-windows-trial-delivery.yml', 'Final raw run identity differs')
    artifact_rows = P.parse_json((ROOT / 'artifacts-final-api.json').read_bytes())['artifacts']
    P.require(len(artifact_rows) == 2 and {x['id'] for x in artifact_rows} == {13266058451,13266078497}, 'Original artifact set differs')
    cleanup = SOURCE.read('apps/desktop/src-tauri/mermaid-engine/src/cleanup.rs')
    for fragment in (b'Some(5 | 32 | 33)', b'const ATTEMPTS: usize = 31;',
                     b'const INTERVAL: Duration = Duration::from_millis(100);',
                     b'const RETRY_DEADLINE: Duration = Duration::from_secs(3);'):
        P.require(fragment in cleanup, 'Frozen retry source contract differs')
    summaries['frozenCleanupSource'] = K.record(cleanup)
    return summaries

result = {'candidateSha': CANDIDATE, 'runId': '41708284083', 'status': 'failed', 'deliveryAccepted': False,
          'deliveryArtifactPresent': False, 'staticInstallerLocallyInspected': False,
          'scope': 'Verified two-artifact failure analysis; installer bytes were not uploaded or locally executed',
          'accounts': {}, 'frozenHarness': proof, 'artifactIntegrity': verify_preserved_artifacts()}
inspection = {f.name: f.read_bytes() for f in (ROOT / 'extracted/inspection').iterdir()}
packaging = P.parse_json(inspection['packaging-record.json'])
installer_input = P.parse_json(inspection['installer-input.json'])
nsis = P.parse_json(inspection['nsis-image-proof.json'])

def check(fn):
    try:
        return {'passed': True, 'result': fn()}
    except Exception as e:
        return {'passed': False, 'error': P.error_message(e)}

for kind in K.KINDS:
    files = {f.name: f.read_bytes() for f in (ROOT / 'extracted/installed' / kind).iterdir()}
    report = P.parse_json(files['mermaid-product-e2e.json'])
    outer = P.parse_json(files['windows-standard-product-audit.json'])
    installation = P.parse_json(files['installation-result.json'])
    # A failed first fixture never launches later fixtures. Parse only actual
    # retained log bytes; missing fixture logs stay explicitly recorded below.
    records = []
    missing_logs = []
    for fixture in P.FIXTURES:
        name = fixture + '-product.log'
        if name not in files:
            missing_logs.append(name)
            continue
        for line in files[name].decode('utf-8-sig').splitlines():
            if line.startswith(P.AUDIT_PREFIX):
                payload = line[len(P.AUDIT_PREFIX):].encode()
                P.require(len(payload) <= 8192, 'Native audit JSON line budget exceeded')
                records.append(P.parse_json(payload))
                P.require(len(records) <= 512, 'Native audit event budget exceeded')
    K.equal(records, report['nativeAudit'], 'Actual native logs/report differ')
    decoded = [{'name': name, **K.record(data), **P.decode_png(data)} for name, data in files.items() if name.endswith('.png')]
    sid, session = outer['accountSid'], outer['standardContext']['sessionId']
    def installed_facts():
        K.equal(installation, outer['installation'], 'Installation raw/outer reports differ')
        for key in ('bytes', 'sha256'):
            K.equal(installation['installer'][key], packaging['installer'][key], 'Installer identity differs')
            K.equal(installation['installedBinary'][key], packaging['extractedApplication'][key], 'Installed EXE identity differs')
        P.require(installation['candidateSha'] == CANDIDATE and installation['actualSid'] == installation['expectedSid'] == sid and installation['expectedAccountKind'] == kind, 'Installed identity differs')
        P.require(installation['installedBinary']['fileVersion'] == installation['installedBinary']['productVersion'] == '2.0.0-beta.9', 'Installed version differs')
        P.require(report['applicationSha256'] == installation['installedBinary']['sha256'] and P._outer_path(report['application']) == P._outer_path(installation['installedBinary']['path']), 'Launched EXE differs')
        K.captured_run(installation['installerRun'], 'Installer', files, 'installer-stdout.log', 'installer-stderr.log')
        run = installation['installerRun']
        P.require(run['identityRequired'] is True and run['identityVerified'] is True and run['expectedAccountKind'] == kind, 'Actual installer identity gate missing')
        for observed in ('callerIdentity', 'startedProcess'):
            identity = installation['installerRun'][observed]
            P._outer_host(identity['token'], sid, session, kind)
            P.require(identity['inJob'] and identity['accountKindVerified'] and identity['expectedAccountKind'] == kind and identity['sessionId'] == session, 'Installer token/job context differs')
        K.equal(installation['binaryComparison'], P.parse_json(files['installed-binary-comparison.json']), 'Original comparison output differs')
        P.require(run['callerIdentity']['pid'] == outer['supervisor']['pid'] and run['startedProcess']['pid'] == run['pid'] and
                  run['startedProcess']['imageTruncated'] is False and
                  P._outer_path(run['startedProcess']['image']) == P._outer_path(installation['installer']['path']) and
                  isinstance(run['startedProcess']['creationFileTime'], str) and run['startedProcess']['creationFileTime'].isdigit(), 'Exact held installer identity differs')
        K.captured_run(installation['comparisonRun'], 'Node', files, 'installed-binary-comparison.json', 'installed-binary-comparison-stderr.log')
        comparison = P.parse_json(files['installed-binary-comparison.json'])
        K.equal(comparison, {'status':'passed','bytes':packaging['extractedApplication']['bytes'],
            'builtSha256':packaging['compiledApplication']['sha256'], 'expectedInstalledSha256':packaging['extractedApplication']['sha256'],
            'installedSha256':packaging['extractedApplication']['sha256'], 'bundleMarkerOffset':nsis['markerOffset'],
            'transformation':'__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS', 'bundlerVersion':'2.9.4'}, 'Original full-image comparison report differs')

        K.equal(installation['bundledPlugins'], installer_input['bundledPlugins'], 'Plugin inventory differs')
        observed = report['steps'][0]['bundledPluginsObserved']
        P.require(len(observed) == 10 and all(x['checked'] == 'false' and x.get('busy') != 'true' for x in observed), 'Initial plugin state differs')
        K.equal({x['id']:x['version'] for x in observed}, {x['id']:x['version'] for x in installer_input['bundledPlugins']}, 'Initial plugin versions differ')
        return {'sid': sid, 'installer': {k:installation['installer'][k] for k in ('bytes','sha256')}, 'installedBinary': installation['installedBinary'], 'initiallyDisabledPlugins': 10,
                'scope': 'Actual-run records bound to packaging reports; local installer bytes are absent'}
    def cleanup_observations():
        value = O.validate_cleanup_observation_events(records)
        P.require(value.get('observationEvidenceVerified') is True and value.get('hasFinishedEvidence') is True, 'Native cleanup observation fields rejected')
        return value
    account = {'reportedStatus': report['status'], 'steps': [{'name':x['name'], 'passed':x.get('passed'), 'error':x.get('error')} for x in report['steps']],
               'decodedPngs': decoded, 'installationFacts': check(installed_facts),
               'strictProduct': check(lambda: P.validate_product(files, kind, decoded)),
               'missingUnlaunchedFixtureLogs': missing_logs,
               'nativeLedger': check(lambda: P.run_node({'mode':'ledger','records':records,'sid':sid,'sessionId':session,'account':kind,'productPids':[x['productPid'] for x in report['launches']]})),
               'cleanupObservations': check(cleanup_observations),
               'outerProfileCleanup': check(lambda: P._outer_profile(outer, sid)),
               'sourceSnapshots': check(lambda: P._outer_sources(files, CANDIDATE)),
               'finishedNativeEvents': [x for x in records if x.get('phase') == 'finished'],
               'closes': [{'fixture':x['fixture'], 'closedByUi':x.get('closedByUi'), 'exitCode':x.get('exitCode'), 'signal':x.get('signal'), 'outerTerminationRequired':x.get('outerTerminationRequired', False),
                           'uiExitDeadlineUnmet': x.get('teardown',{}).get('uiExitDeadlineUnmet', False), 'strictClose':check(lambda x=x:P.validate_clean_close(x))} for x in report['launches']]}
    result['accounts'][kind] = account

result['distinctActualSids'] = len({x['installationFacts']['result']['sid'] for x in result['accounts'].values()}) == 2
result['limitations'] = ['No delivery artifact or local installer bytes; full three-artifact and static installer verification cannot pass.',
                        'The original pure-standard IPC 995 failure recurred; bounded OS 5 deletion retry succeeded but does not cure pipe cleanup uncertainty.',
                        'Pure-standard natural close failed; outer account/profile cleanup success does not establish native cleanup acceptance.']
destination = Path(args.output).resolve()
with destination.open('x') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
print(json.dumps({'output':str(destination), 'analysisCompleted':True, 'deliveryAccepted':False, 'productResults':{k:v['strictProduct']['passed'] for k,v in result['accounts'].items()}}))

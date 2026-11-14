"""Read preserved actual evidence; never infer delivery acceptance from two artifacts."""
import json
import sys
from pathlib import Path

sys.path.insert(0, '/workspace/mermaid-rebuild-evidence/installer-dual-account-verifier')
import product_evidence as P
import package_evidence as K
import verify_installed_dual as V
import cleanup_observations as O

ROOT = Path(__file__).parent
CANDIDATE = '0811b899ea4c4f98294046f66524d4503307d279'
SOURCE = K.FrozenSource('/workspace/milkup-mermaid-rebuild', CANDIDATE)
proof = K.verify_harness(SOURCE, ROOT / 'candidate-mermaid-product-e2e.mjs', ROOT / 'harness-exact-windows-checkout-provenance.json')
P.configure(candidate=CANDIDATE, run_id='41708284083', attempt='1', harness=ROOT / 'candidate-mermaid-product-e2e.mjs', harness_sha=proof['lf']['sha256'], windows_harness_sha=proof['windowsCRLF']['sha256'])
O.CONTRACT_COMMIT = CANDIDATE
result = {'candidateSha': CANDIDATE, 'runId': '41708284083', 'status': 'failed', 'deliveryAccepted': False,
          'deliveryArtifactPresent': False, 'staticInstallerLocallyInspected': False,
          'scope': 'Verified two-artifact failure analysis; installer bytes were not uploaded or locally executed',
          'accounts': {}, 'frozenHarness': proof, 'artifactIntegrity': json.loads((ROOT / 'two-artifact-integrity.json').read_text())}
inspection = {f.name: f.read_bytes() for f in (ROOT / 'extracted/inspection').iterdir()}
packaging = P.parse_json(inspection['packaging-record.json'])
installer_input = P.parse_json(inspection['installer-input.json'])

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
        for observed in ('callerIdentity', 'startedProcess'):
            identity = installation['installerRun'][observed]
            P._outer_host(identity['token'], sid, session, kind)
            P.require(identity['inJob'] and identity['accountKindVerified'] and identity['expectedAccountKind'] == kind and identity['sessionId'] == session, 'Installer token/job context differs')
        K.equal(installation['binaryComparison'], P.parse_json(files['installed-binary-comparison.json']), 'Original comparison output differs')
        K.equal(installation['bundledPlugins'], installer_input['bundledPlugins'], 'Plugin inventory differs')
        observed = report['steps'][0]['bundledPluginsObserved']
        P.require(len(observed) == 10 and all(x['checked'] == 'false' and x.get('busy') != 'true' for x in observed), 'Initial plugin state differs')
        K.equal({x['id']:x['version'] for x in observed}, {x['id']:x['version'] for x in installer_input['bundledPlugins']}, 'Initial plugin versions differ')
        return {'sid': sid, 'installer': {k:installation['installer'][k] for k in ('bytes','sha256')}, 'installedBinary': installation['installedBinary'], 'initiallyDisabledPlugins': 10,
                'scope': 'Actual-run records bound to packaging reports; local installer bytes are absent'}
    account = {'reportedStatus': report['status'], 'steps': [{'name':x['name'], 'passed':x.get('passed'), 'error':x.get('error')} for x in report['steps']],
               'decodedPngs': decoded, 'installationFacts': check(installed_facts),
               'strictProduct': check(lambda: P.validate_product(files, kind, decoded)),
               'missingUnlaunchedFixtureLogs': missing_logs,
               'nativeLedger': check(lambda: P.run_node({'mode':'ledger','records':records,'sid':sid,'sessionId':session,'account':kind,'productPids':[x['productPid'] for x in report['launches']]})),
               'cleanupObservations': check(lambda: O.validate_cleanup_observation_events(records)),
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
destination = ROOT / 'failed-installed-run-analysis.json'
with destination.open('x') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
print(json.dumps({'output':str(destination), 'deliveryAccepted':False, 'accounts':{kind:{field:account[field] for field in ('reportedStatus','strictProduct','nativeLedger','cleanupObservations','outerProfileCleanup','closes')} for kind,account in result['accounts'].items()}}, ensure_ascii=False))

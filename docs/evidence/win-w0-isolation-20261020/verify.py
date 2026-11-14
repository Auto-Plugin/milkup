#!/usr/bin/env python3
"""Verify immutable CI evidence without extracting or running any binary."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parent
index = json.loads((root / 'index.json').read_text())
archive = root / index['archive']
assert archive.stat().st_size == index['archiveBytes']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == index['archiveSha256']
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(set(bundle.namelist()))
    assert set(bundle.namelist()) == {r['path'] for r in index['members']}
    for row in index['members']:
        path = Path(row['path'])
        assert not path.is_absolute() and '..' not in path.parts
        assert path.suffix.lower() not in {'.exe', '.msi', '.msix', '.deb', '.dll'}
        data = bundle.read(row['path'])
        assert len(data) == row['bytes']
        assert hashlib.sha256(data).hexdigest() == row['sha256']
    load = lambda path: json.loads(bundle.read(path))
    shas = {'M01': '458e8f0865a6fbc650a990512abe526232d6e562',
            'M02': '3d14a5672698fdd658d821c887a30bfb8567133b'}
    for name, sha in shas.items():
        run = load(name + '/run.json')
        assert run['head_sha'] == sha and run['status'] == 'completed'
        assert run['conclusion'] == ('success' if name == 'M01' else 'failure')
        assert load(name + '/artifacts.json')['total_count'] == 0
        commit = load(name + '/commit.json')
        assert commit['sha'] == sha and commit['author']['id'] == 40397402
        assert commit['commit']['author']['name'] == 'LarryZhu-dev'
        assert commit['commit']['author']['email'] == 'larryzhu@foxmail.com'
        report = load(name + '/windows-w0-matrix.json')
        assert report['source'] == sha
        raw = bundle.read(name + '/run-logs/windows-w0/6_Run authorized temporary AppContainer experiment.txt').decode('utf-8-sig')
        stripped = '\n'.join(re.sub(r'^\ufeff?\d{4}-\d\d-\d\dT[^ ]+ ', '', line) for line in raw.splitlines())
        body = re.search(r'^##\[group\]windows-w0-matrix.json\n(.*?)^##\[endgroup\]', stripped, re.M | re.S).group(1)
        if name == 'M02':
            lines = body.splitlines()
            assert lines[2402] == 'W0 probe failed: Restricted network canary delivered: full isolation remains blocked'
            del lines[2402]
            body = '\n'.join(lines)
        assert json.loads(body) == report
        assert report['productIntegrated'] is False
        assert report['fullIsolationGatePassed'] is False
        assert report['cleanupErrors'] == [] and report['outsideFileUnchanged']
        assert report['privateTreeAndAclRemoved'] and report['profileDeletedAndFolderAbsent']
        assert report['loopbackExemptions']['ownSidPresent'] is False
        for case in report['cases']:
            assert case['completed'] and not case.get('error')
            assert case['accountingAfterStop']['activeProcesses'] == 0
            assert all(p['signaledAfterStop'] for p in case['retainedProcessHandles'])
    report = load('M02/windows-w0-matrix.json')
    assert report['networkCanaryGatePassed'] is False
    assert len(report['receivedRestrictedCanaries']) == 16
    cases = {c['name']: c for c in report['cases']}
    for name in ['ordinary', 'restricted', 'restricted-owner-exit']:
        case = cases[name]
        receipts = [e for e in case['endpointObservationsAtStop'] if e.get('turnUsername') == name]
        assert Counter(e['family'] for e in receipts) == {'ipv4': 4, 'ipv6': 4}
        retained = {p['pid']: p for p in case['retainedProcessHandles']}
        roles = {p['pid']: p['kind'] for p in case['child']['webviewProcessInfosAfterNetwork']['processes']}
        for event in receipts:
            owners = event['socketOwners']['owners']
            assert len(owners) == 1
            owner = owners[0]
            assert retained[owner['pid']]['inOwnerJob'] and roles[owner['pid']] == 2
            assert retained[owner['pid']]['observation']['image'].endswith('msedgewebview2.exe')
            if name != 'ordinary':
                assert owner['token']['isAppContainer'] and owner['token']['capabilities'] == []
                assert owner['token']['capabilityCount'] == 0
                assert owner['token']['appContainerSid'] == report['appContainerSid']
        assert case['child']['directBreakaway']['created'] is False
        assert case['child']['directBreakaway']['rawOsError'] == 5
    ordinary = cases['ordinary']
    assert ordinary['child']['explicitServerDns']['returnStatus'] == 0
    assert ordinary['child']['explicitServerDns']['recordsReturned']
    assert any(e['transport'] == 'dns' and e['query'].startswith('w0-ordinary-')
               for e in report['endpointObservationsFinal'])
    assert ordinary['ownedPickerDialogs']
    for name in ['restricted', 'restricted-owner-exit']:
        c = cases[name]
        assert c['child']['outsideRead']['rawOsError'] == 5
        assert c['child']['outsideWriteOpen']['rawOsError'] == 5
        files = {f['name']: f for f in c['child']['fileNavigations']}
        assert files['private']['dom']['result']['value']['marker'] == 'private 中文 😀'
        assert files['outside']['navigation']['success'] is False
        assert files['outside']['dom']['result']['value']['marker'] is None
        assert c['child']['explicitServerDns']['returnStatus'] == 87  # never relabel as access denied
        assert c['ownedPickerDialogs'] == []  # bounded observation, not all-picker denial
    owner = cases['restricted-owner-exit']
    assert owner['ownerExitCode'] == 73 and owner['activeAfterOwnerExitBeforeHostStop'] == 0
    assert owner['owner']['phase'] == 'exit-process-without-rust-drop'
    assert owner['owner']['innerAccounting']['activeProcesses'] > 0
    assert cases['restricted-deadline']['intentionalDeadlineExpired']
    assert [cases[n]['accountingBeforeStop']['totalProcesses'] for n in cases] == [11, 12, 14, 8]
    assert [cases[n]['sampledDistinctProcesses'] for n in cases] == [10, 11, 13, 8]
    provenance = load('M02/parse-provenance.json')
    assert provenance['removedStderrLines'] == [{'groupLine': 2403, 'text':
        'W0 probe failed: Restricted network canary delivered: full isolation remains blocked'}]
    assert 'tests 57' in bundle.read('local-ci-tests.log').decode()
    assert 'pass 57' in bundle.read('local-ci-tests.log').decode()
print(f"Verified {len(index['members'])} members: W0 network gate failed; product remains closed; artifacts 0")

#!/usr/bin/env python3
"""Verify immutable evidence bytes without extracting files or running binaries."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent
index = json.loads((root / 'index.json').read_text())
archive = root / index['archive']
assert archive.stat().st_size == index['archiveBytes']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == index['archiveSha256']
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(set(bundle.namelist()))
    assert set(bundle.namelist()) == {row['path'] for row in index['members']}
    for row in index['members']:
        path = Path(row['path'])
        assert not path.is_absolute() and '..' not in path.parts
        data = bundle.read(row['path'])
        assert len(data) == row['bytes']
        assert hashlib.sha256(data).hexdigest() == row['sha256']
    result = json.loads(bundle.read('w03-hardening/verified-result.json'))
    assert result['windowsPassed'] == 174 and result['windowsFailed'] == 0
    assert len(result['requiredCasesPassed']) == 22
    logs = bundle.read('w03-hardening/desktop-full-library-tests.log').decode()
    for name in result['requiredCasesPassed']:
        assert f'test {name} ... ok' in logs
    assert result['wholeRun'] == 'failed'  # retain the unrelated outline failure
    final = json.loads(bundle.read('w05-w1-retry/verified-result.json'))
    assert final['allPhasesPassed'] == 15 and final['runAttempt'] == 2
    phases = json.loads(bundle.read('w05-w1-retry/phases.json'))
    assert len(phases) == 15 and all(p['status'] == 'passed' for p in phases)
    assert final['newCasesPassed'] == result['requiredCasesPassed']
    w0 = json.loads(bundle.read('w08-appcontainer-observed/windows-w0-probe.json'))
    assert w0['probeResult'] == 'prototype-dom-completed'
    assert json.loads(w0['child']['domResult']) == '中文 😀'
    assert w0['productIntegrated'] is False
    assert w0['networkCanaryWindowMs'] == 1000  # bounded observation, not universal denial
    assert w0['networkCanariesUnreceived'] and w0['hostNetworkControlsPassed']
    members = {m['pid']: m for s in w0['processSamples'] for m in s['members']}
    assert len(members) == 8
    assert all(m['token'] == {'isAppContainer': True, 'capabilityCount': 0} for m in members.values())
    for case in ['w04-appcontainer', 'w06-appcontainer-environment', 'w07-appcontainer-network', 'w08-appcontainer-observed']:
        cleanup = json.loads(bundle.read(case + '/windows-w0-probe.json'))
        assert cleanup['jobActiveAfterStop'] == 0
        assert cleanup['profileDeletedAndFolderAbsent'] and cleanup['privateTreeAndAclRemoved']
        assert cleanup['cleanupErrors'] == [] and cleanup['outsideFileUnchanged']
    for row in index['members']:
        if row['path'].endswith('/artifacts.json'):
            assert json.loads(bundle.read(row['path']))['total_count'] == 0
print(f"Verified {len(index['members'])} evidence members; no build artifacts uploaded")

#!/usr/bin/env python3
"""Read-only checks of this exact successful diagnostic, not a render policy."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'extracted'
CANDIDATE = '0783bd63aa92bef8908df8dd0ea3aa157b82ff2b'
PRIVILEGES = [('00000000:00000017', 'SeChangeNotifyPrivilege', 3),
              ('00000000:00000021', 'SeIncreaseWorkingSetPrivilege', 0)]

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def flags(obj, yes=(), no=()):
    for key in yes: assert obj[key] is True, key
    for key in no: assert obj[key] is False, key

def privs(token):
    value = token['privileges']
    assert value['complete'] is True and value['count'] == len(value['items']) <= 64
    assert len({item['luid'] for item in value['items']}) == value['count']
    for item in value['items']:
        assert type(item['attributes']) is int and 0 <= item['attributes'] <= 0xffffffff
        assert item['enabled'] is bool(item['attributes'] & 2)
        assert item['enabledByDefault'] is bool(item['attributes'] & 1)
    return [(item['luid'], item['name'], item['attributes']) for item in value['items']]

def access(obj, actual):
    flags(obj, ['complete'])
    assert obj['ntstatus'] == 0 and obj['ntstatusHex'] == '00000000'
    assert obj['returnedBytes'] == 56 and obj['grantedAccess'] == actual
    assert obj['handleAttributes'] == 0

build = read(ROOT / 'probe-build-record.json')
assert build['candidateSha'] == CANDIDATE
flags(build, ['testOnly'], ['desktopBuilt', 'documentRendering'])
result = {'schema': 1, 'candidateSha': CANDIDATE, 'runId': 41683336878,
          'observationVerified': True, 'renderingVerified': False,
          'elevationUseAttempted': False, 'accounts': {}}
for kind, elevation, admin in [('pure-standard', 1, None), ('filtered-admin', 3, 16)]:
    base = ROOT / kind
    audit = read(base / 'windows-mermaid-token-probe-audit.json')
    context = read(base / 'token-probe-context.json')
    child = read(base / 'token-probe-child-result.json')
    native = read(base / 'token-probe-result.json')
    sid = audit['accountSid']
    assert audit['source'] == child['candidateSha'] == CANDIDATE
    assert audit['expectedProbeExeSha256'] == audit['probe']['sha256'] == child['probe']['sha256'] == build['sha256']
    assert audit['probe']['bytes'] == child['probe']['bytes'] == build['bytes']
    assert context['expectedSid'] == context['actualSid'] == child['expectedSid'] == sid
    assert context['expectedAccountKind'] == audit['expectedAccountKind'] == child['expectedAccountKind'] == kind
    assert context['observation']['pid'] == audit['supervisor']['pid']
    assert context['observation']['token'] == audit['supervisor']['suspendedToken']
    assert context['expectedSessionId'] == context['observation']['token']['sessionId'] == 2
    assert context['observation']['token']['pureStandardUser'] is (kind == 'pure-standard')
    assert context['observation']['token']['filteredAdmin'] is (kind == 'filtered-admin')
    flags(context, ['accountKindVerified'], ['desktopRequired', 'securityPolicyChanged', 'existingAclChanged'])
    assert native['accountKind'] == kind and native['status'] == 'observed'
    assert native['parentPid'] == child['process']['pid'] and native['childExitCode'] == 0
    assert native['failedStage'] is None and native['mermaidSourceBytes'] == 0
    flags(native, ['diagnosticOnly', 'hostPolicyAccepted', 'creationTimeJobVerified', 'parentAndSelfIdentityMatch', 'parentAndSelfPrivilegesMatch'],
          ['renderPolicyChanged', 'comStarted', 'webviewStarted', 'javascriptStarted'])
    host = native['host']
    assert host['userSid'] == host['ownerSid'] == sid and host['sessionId'] == 2
    assert host['tokenType'] == 1 and host['integrityRid'] == 8192 and host['elevationType'] == elevation
    assert host['administratorsGroupAttributes'] == admin and privs(host) == PRIVILEGES
    flags(host, [], ['elevated', 'uiAccess', 'isAppContainer'])
    views = {}
    for field, caller, observer in [('suspendedParentView', 'parent-suspended-child', native['parentPid']),
                                    ('childSelfView', 'appcontainer-self', native['childPid'])]:
        view = native[field]
        assert view['caller'] == caller and view['observerPid'] == observer and view['subjectPid'] == native['childPid']
        assert view['requestedSourceTokenAccess'] == 8 and view['complete'] is True
        thread = view['callerThreadToken']
        flags(thread, ['complete', 'handleClosed'], ['present'])
        assert thread['win32Error'] == 1008 and thread['token'] is None
        token = view['token']
        assert token['userSid'] == token['ownerSid'] == sid and token['sessionId'] == 2
        assert token['tokenType'] == 1 and token['impersonationLevel'] is None and token['integrityRid'] == 4096
        assert token['elevationType'] == elevation and token['administratorsGroupAttributes'] == admin
        assert token['appContainerSid'] == native['freshAppContainerSid'] and token['capabilityCount'] == 0
        flags(token, ['isAppContainer'], ['elevated', 'uiAccess'])
        assert privs(token) == PRIVILEGES
        linked = view['linkedToken']
        flags(linked, ['complete', 'allReturnedHandlesClosed'])
        assert linked['returnedBytes'] == 8
        if kind == 'pure-standard':
            assert linked['querySucceeded'] is False and linked['win32Error'] == 1312
            assert linked['handleAccess'] is None and linked['target'] is None and linked['duplicateRequests'] == []
            views[field] = {'querySucceeded': False, 'win32Error': 1312, 'duplicateRequests': []}
        else:
            assert linked['querySucceeded'] is True and linked['win32Error'] is None
            access(linked['handleAccess'], 983551)
            target = linked['target']
            assert target['tokenType'] == 2 and target['impersonationLevel'] == 1
            assert target['elevated'] is True and target['elevationType'] == 2 and target['integrityRid'] == 12288
            assert target['sessionId'] == 0 and target['userSid'] == sid and target['ownerSid'] == 'S-1-5-32-544'
            assert target['administratorsGroupAttributes'] == 15 and target['isAppContainer'] is False
            assert target['appContainerSid'] is None and target['uiAccess'] is False and target['capabilityCount'] == 0
            assert len(privs(target)) == 24
            requests = linked['duplicateRequests']
            expected = [] if field == 'suspendedParentView' else [('duplicate', 10), ('assign-primary', 9), ('impersonate', 12)]
            assert [(x['kind'], x['requestedAccess']) for x in requests] == expected
            for item in requests:
                flags(item, ['complete', 'succeeded', 'handleClosed'])
                assert item['win32Error'] is None and item['target'] == target
                access(item['handleAccess'], item['requestedAccess'])
            views[field] = {'querySucceeded': True, 'grantedAccess': 983551, 'grantedAccessHex': '0xF01FF',
                            'targetTokenType': 2, 'targetImpersonationLevel': 1, 'targetElevated': True,
                            'targetIntegrityRid': 12288, 'targetSessionId': 0,
                            'duplicateRequests': [{'kind': x['kind'], 'requestedAccess': x['requestedAccess'],
                                                   'actualGrantedAccess': x['handleAccess']['grantedAccess'],
                                                   'succeeded': x['succeeded']} for x in requests]}
    flags(native['cleanup'], ['jobCreated', 'jobEmpty', 'profileCreated', 'profileDeleted', 'privateTreeCreated', 'privateTreeRemoved', 'ipcCompleted'])
    assert native['cleanup']['errors'] == []
    assert {x['stream'] for x in native['cleanup']['joins']} == {'stdout', 'stderr'}
    for join in native['cleanup']['joins']: flags(join, ['finished'], ['cancelRequested', 'panicked'])
    process = child['process']
    flags(process, ['started', 'exited', 'streamsDrained'], ['timedOut', 'captureExceeded', 'forcedProcessTermination', 'forcedNodeTermination'])
    assert process['exitCode'] == 0 and process['cleanupErrors'] == [] and process['stderrBytes'] == 0
    assert audit['status'] == child['status'] == 'passed' and child['complete'] is True
    flags(audit, ['accountCreated', 'accountDeleted', 'profileDeleted', 'stageRemoved', 'accountGroupCleanupConfirmed'],
          ['changedAcl', 'changedUacOrSecurityPolicy', 'runtimeInstalled', 'browserStartedByWrapper', 'renderingPolicyChanged'])
    assert audit['cleanupErrors'] == [] and audit['supervisor']['exitCode'] == 0
    assert audit['supervisor']['activeBeforeOuterCleanup'] == 0 and audit['supervisor']['jobEmpty'] is True
    assert audit['supervisor']['cleanupErrors'] == []
    after = audit['profileCleanup']['after']
    assert after['sid'] == sid and after['profileKeyPresent'] is False and after['profilePathPresent'] is False
    assert after['hkuHivePresent'] is False and after['cimLoaded'] is None and after['cimMatches'] == 0 and after['diagnosticErrors'] == []
    processes = audit['profileCleanup']['lastProcessObservation']
    assert processes['sid'] == sid and processes['complete'] is True and processes['matchCount'] == 0 and processes['records'] == [] and processes['errors'] == []
    assert audit['accountGroupCleanup']['sid'] == sid and audit['accountGroupCleanup']['complete'] is True
    assert {x['groupSid'] for x in audit['accountGroupCleanup']['groups']} == {'S-1-5-32-544', 'S-1-5-32-545'}
    for group in audit['accountGroupCleanup']['groups']: flags(group, ['queried'], ['exactSidPresent'])
    result['accounts'][kind] = {'accountSid': sid, 'parentPid': native['parentPid'], 'childPid': native['childPid'],
                                'hostElevationType': elevation, 'childPrivileges': PRIVILEGES, 'views': views,
                                'parentAndSelfIdentityVerified': True, 'noCallerThreadImpersonation': True,
                                'nativeCleanupVerified': True, 'outerProfileAccountStageCleanupVerified': True,
                                'naturalExitCode': 0, 'forcedTermination': False,
                                'nativeReportSha256': hashlib.sha256((base / 'token-probe-result.json').read_bytes()).hexdigest()}
for phase in ['checkout', 'pre-probe', 'final']:
    source = read(ROOT / ('source-' + phase + '.json'))
    assert source['phase'] == phase and source['candidateSha'] == source['instrumentationSha'] == CANDIDATE
    assert source['readOnly'] is True and source['refreshedIndex'] is False and source['rawStatus'] == ''
result['strictSourceSnapshotsVerified'] = True
print(json.dumps(result, indent=2))

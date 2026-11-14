#!/usr/bin/env python3
"""Diagnostic statistics only. Inputs must already be API/ZIP verified.

Reads fixed retained logs and compares every native record with nativeAudit.
Never executes a payload, queries a process, or grants product acceptance.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat

PREFIX = 'MILKUP_MERMAID_NATIVE_AUDIT '
FIXTURES = ('ordinary', 'wide', 'c4', 'invalid')
KINDS = ('pure-standard', 'filtered-admin')
U32 = (1 << 32) - 1
OBSERVATION = 'helperProcessExitObservation'
SNAPSHOT_FIELDS = {'waitStatus', 'waitResult', 'win32Error', 'exitCode', 'exitCodeWin32Error'}
FINISHED_FIELDS = ('timestampUnixMs', 'ownedJobCreated', 'jobActiveAfterStop',
    'ipcThreadsCompleted', 'ipcThreadCleanup', 'stdoutFailure', 'stderrFailure',
    'profileCreated', 'profileDeleted', 'privateTreeRemoved', 'privateTreeCleanup',
    'cleanupTimeline', 'cleanupFailureKinds', 'cleanupUncertain', 'successful',
    'cancelled', 'deadlineExpired', 'rendererStatus', 'rendererErrorKind',
    'capturedPngBytes', 'pngBytes', 'pngSha256', 'helperNativeProofVerified',
    'helperProtocolHandlesNonInheritable')


def require(value, message):
    if not value:
        raise ValueError(message)


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    def finite(text):
        value = float(text)
        require(math.isfinite(value), 'Non-finite JSON number')
        return value
    def invalid(text):
        raise ValueError('Non-finite JSON constant: ' + text)
    return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=pairs,
                      parse_constant=invalid, parse_float=finite)


def read(path, limit=2 * 1024 * 1024):
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'Symlink input rejected')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'Input must be a bounded regular file')
        raw = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    require(len(raw) == before.st_size <= limit and
            (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Input changed during read')
    return raw


def identity(raw):
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def snapshot(value):
    require(type(value) is dict and set(value) == SNAPSHOT_FIELDS, 'Closed helper snapshot required')
    status, result = value['waitStatus'], value['waitResult']
    require(type(result) is int and 0 <= result <= U32, 'waitResult must be u32')
    expected = {'signaled': 0, 'timeout': 258, 'failed': U32}
    require((status in expected and result == expected[status]) or
            (status == 'unexpected' and result not in expected.values()), 'waitStatus/result mismatch')
    for key in ('win32Error', 'exitCode', 'exitCodeWin32Error'):
        require(value[key] is None or type(value[key]) is int and 0 <= value[key] <= U32,
                key + ' must be explicit null or u32')
    require(status == 'failed' or value['win32Error'] is None, 'Only failed wait may record a wait error')
    require(status == 'signaled' or value['exitCode'] is value['exitCodeWin32Error'] is None,
            'Non-signaled wait cannot supply exit-code observations')
    require(value['exitCode'] is None or value['exitCodeWin32Error'] is None,
            'Exit code and exit-code query error are mutually exclusive')


def observation(value):
    require(type(value) is dict and set(value) ==
            {'beforeTerminate', 'afterTerminateRequest', 'handleReleasedBeforeAccounting'},
            'Closed helper observation required')
    require(value['handleReleasedBeforeAccounting'] is True, 'Original held handle release must be observed')
    snapshot(value['beforeTerminate'])
    snapshot(value['afterTerminateRequest'])


def summarize(records):
    require(type(records) is list and len(records) <= 512, 'Bounded native records required')
    requests = {}
    for event in records:
        require(type(event) is dict and type(event.get('productPid')) is int and
                0 < event['productPid'] <= U32 and isinstance(event.get('requestId'), str) and
                re.fullmatch(r'[A-Za-z0-9_-]{1,80}', event['requestId']), 'Exact native request identity required')
        phase = event.get('phase')
        require(phase in ('admitted', 'started', 'finished'), 'Unknown native phase')
        phases = requests.setdefault((event['productPid'], event['requestId']), {})
        require(phase not in phases, 'Duplicate request phase')
        phases[phase] = event
    counts = Counter({key: 0 for key in ('finishedRequests', 'unfinishedRequests',
        'helperObservation/present', 'helperObservation/explicit-null', 'helperObservation/missing-field',
        'observationMissingDespiteCreatedJob', 'requestsWithObserved995', 'requestsWithBothStreams995',
        'requestsWithRecordedTreeOs5', 'requestsWithRecordedAttemptAfterTreeOs5')})
    counts.update(nativeRecords=len(records), nativeRequests=len(requests))
    states = {key: Counter({status: 0 for status in ('signaled', 'timeout', 'failed', 'unexpected')})
              for key in ('beforeTerminate', 'afterTerminateRequest')}
    rows = []
    for (pid, request), phases in requests.items():
        row = {'productPid': pid, 'requestId': request, 'phasesSeen': list(phases)}
        finished = phases.get('finished')
        if finished is None:
            counts['unfinishedRequests'] += 1
            row['helperObservationAvailability'] = 'no-finished-record'
            rows.append(row)
            continue
        counts['finishedRequests'] += 1
        present = OBSERVATION in finished
        value = finished.get(OBSERVATION)
        available = 'present' if value is not None else 'explicit-null' if present else 'missing-field'
        row.update(helperObservationAvailability=available,
                   observationMissingDespiteCreatedJob=finished.get('ownedJobCreated') is True and value is None,
                   originalFinishedFields={k: finished[k] for k in FINISHED_FIELDS if k in finished})
        if present:
            row[OBSERVATION] = value  # Keep explicit null distinct from an absent field.
        counts['helperObservation/' + available] += 1
        if row['observationMissingDespiteCreatedJob']:
            counts['observationMissingDespiteCreatedJob'] += 1
        if value is not None:
            observation(value)
            for name in states:
                states[name][value[name]['waitStatus']] += 1
        for key in ('ownedJobCreated', 'successful', 'cleanupUncertain', 'ipcThreadsCompleted', 'privateTreeRemoved'):
            if key in finished:
                require(type(finished[key]) is bool, 'Original outcome field must be boolean: ' + key)
                counts[key + '/' + str(finished[key]).lower()] += 1
            else:
                counts[key + '/missing-field'] += 1
        errors995 = [s for s in ('stdout', 'stderr') if
                     isinstance(finished.get(s + 'Failure'), dict) and
                     type(finished[s + 'Failure'].get('win32Error')) is int and
                     finished[s + 'Failure']['win32Error'] == 995]
        row['streamsWithObservedWin32Error995'] = errors995
        counts['requestsWithObserved995'] += bool(errors995)
        counts['requestsWithBothStreams995'] += len(errors995) == 2
        tree = finished.get('privateTreeCleanup')
        os5 = [] if not isinstance(tree, dict) else [x for x in tree.get('failedAttempts', [])
            if type(x) is list and len(x) == 2 and type(x[0]) is int and type(x[1]) is int and x[1] == 5]
        row['recordedTreeOs5FailedAttempts'] = os5
        counts['requestsWithRecordedTreeOs5'] += bool(os5)
        retried = bool(os5) and type(tree.get('attempts')) is int and any(x[0] < tree['attempts'] for x in os5)
        counts['requestsWithRecordedAttemptAfterTreeOs5'] += retried
        rows.append(row)
    return {'counts': dict(counts), 'observedSnapshotStateCounts': {k: dict(v) for k, v in states.items()}, 'requests': rows}


def account(root, kind, candidate, run):
    directory = root / kind
    report_bytes = read(directory / 'mermaid-product-e2e.json')
    report = parse(report_bytes)
    manifest = parse(read(directory / 'artifact-manifest.json'))
    require(report.get('candidateSha') == manifest.get('candidateSha') == candidate and
            report.get('expectedAccountKind') == kind and manifest.get('workflowRunId') == run,
            'Candidate/run/account identity differs')
    records, logs, missing = [], {}, []
    for fixture in FIXTURES:
        name = fixture + '-product.log'
        if not (directory / name).exists():
            missing.append(name)
            continue
        raw = read(directory / name)
        logs[name] = identity(raw)
        for line in raw.decode('utf-8-sig').splitlines():
            if line.startswith(PREFIX):
                payload = line[len(PREFIX):].encode()
                require(len(payload) <= 8192, 'Native audit JSON line exceeds 8192 bytes')
                records.append(parse(payload))
                require(len(records) <= 512, 'Native event count exceeds bound')
    canonical = lambda v: json.dumps(v, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    require(type(report.get('nativeAudit')) is list and canonical(records) == canonical(report['nativeAudit']),
            'Raw native logs differ from report.nativeAudit')
    return {'reportedProductStatus': report.get('status'), 'productReport': identity(report_bytes),
            'rawNativeLogs': logs, 'missingFixtureLogs': missing, 'rawLogsExactlyMatchReport': True,
            **summarize(records)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('evidence-root', 'candidate', 'run', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    require(re.fullmatch(r'[a-f0-9]{40}', args.candidate) and re.fullmatch(r'[1-9][0-9]*', args.run), 'Exact candidate and run required')
    root = Path(args.evidence_root).absolute()
    result = {'schema': 1, 'candidateSha': args.candidate, 'runId': args.run,
        'nonAcceptance': True, 'diagnosticStatisticsOnly': True, 'artifactIntegrityReverified': False,
        'inputPrecondition': 'Caller separately verified API, ZIP and retained-file integrity.',
        'helperSignaledUsedAsEofProof': False, 'helperObservationReplacesJobOrIpcOrCleanupGates': False,
        'networkAccessed': False, 'payloadExecuted': False,
        'accounts': {kind: account(root, kind, args.candidate, args.run) for kind in KINDS}}
    result['script'] = identity(Path(__file__).read_bytes())
    with Path(args.output).open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({'analysisCompleted': True, 'nonAcceptance': True, 'output': args.output}))


if __name__ == '__main__':
    main()

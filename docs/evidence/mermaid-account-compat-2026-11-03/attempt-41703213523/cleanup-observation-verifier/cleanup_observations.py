#!/usr/bin/env python3
"""Read-only supplemental native cleanup observations for the bounded access-denial retry candidate.

Exports validate_finished_cleanup_observations and validate_cleanup_observation_events.
This module never grants native/product/PNG acceptance. Always run the original
AuditLedger and artifact/PNG gates as well. Null observations are never completion.
"""
import argparse
import json
import re
from pathlib import Path

CONTRACT_COMMIT = '75873669ecd0a0004d92f7553c152d41f0a2aee5'
U64 = (1 << 64) - 1
U32 = (1 << 32) - 1
TREE_KEYS = {'attempts', 'elapsedMs', 'finalOsError', 'terminalPhase', 'absenceChecked', 'absent', 'failedAttempts'}
TIMELINE_KEYS = ('jobStopFinishedMs', 'ipcJoinsFinishedMs', 'pinsReleasedMs', 'profileDeleteFinishedMs', 'treeDeleteFinishedMs')
IPC_KEYS = {'stream', 'elapsedMs', 'cancelRequested', 'cancelCallSucceeded', 'cancelWin32Error', 'finished', 'panicked', 'progressAtJoin', 'progressAtCancel', 'progressAtEnd'}
PHASES = {'created', 'ready-frame', 'ready-event', 'result-frame', 'png-body', 'result-event', 'trailing-byte', 'stderr-read', 'stdin-write', 'stdin-flush', 'written-event'}
COMPLETIONS = {'pending', 'eof', 'broken-pipe', 'written', 'read-error', 'schema-error', 'channel-error', 'trailing-data', 'budget-error', 'write-error'}
STREAM_ORDER = ('stdout', 'stdin', 'stderr')


class ObservationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ObservationError(message)


def exact_object(value, keys, where):
    require(type(value) is dict and set(value) == set(keys), where + ': exact closed keys required')


def integer(value, low, high, where):
    require(type(value) is int and low <= value <= high, where + ': bounded integer required')


def optional_integer(value, low, high, where):
    if value is not None:
        integer(value, low, high, where)


def boolean(value, where):
    require(type(value) is bool, where + ': boolean required')


def progress(value, where):
    if value is None:
        return
    exact_object(value, ('phase', 'completion'), where)
    require(type(value['phase']) is str and value['phase'] in PHASES, where + ': unknown phase')
    require(type(value['completion']) is str and value['completion'] in COMPLETIONS, where + ': unknown completion')


def tree_cleanup(value):
    if value is None:
        return
    exact_object(value, TREE_KEYS, 'privateTreeCleanup')
    integer(value['attempts'], 1, 31, 'tree.attempts')
    integer(value['elapsedMs'], 0, U64, 'tree.elapsedMs')
    optional_integer(value['finalOsError'], -(1 << 31), (1 << 31)-1, 'tree.finalOsError')
    boolean(value['absenceChecked'], 'tree.absenceChecked')
    if value['absent'] is not None:
        boolean(value['absent'], 'tree.absent')
    phase = value['terminalPhase']
    require(phase in ('remove', 'absence-check', 'complete'), 'tree.terminalPhase: unknown phase')
    failures = value['failedAttempts']
    require(type(failures) is list and len(failures) <= 31, 'tree.failedAttempts: bounded array required')
    for index, item in enumerate(failures, 1):
        require(type(item) is list and len(item) == 2, 'tree.failedAttempts: exact numeric pair required')
        integer(item[0], 1, value['attempts'], 'tree.failedAttempts.index')
        require(item[0] == index, 'tree.failedAttempts: original consecutive attempt order required')
        optional_integer(item[1], -(1 << 31), (1 << 31)-1, 'tree.failedAttempts.osError')
    if phase == 'remove':
        require(value['absenceChecked'] is False and value['absent'] is None,
                'tree.remove: absence cannot be fabricated')
        require(len(failures) == value['attempts'] and failures[-1][1] == value['finalOsError'],
                'tree.remove: final exact removal error required')
        retry_failures = failures[:-1]
    else:
        require(value['absenceChecked'] is True and len(failures) == value['attempts']-1,
                'tree.absence: final successful/NotFound remove call must be counted')
        retry_failures = failures
        if phase == 'complete':
            require(value['absent'] is True and value['finalOsError'] is None,
                    'tree.complete: actual absence and null final error required')
        else:
            require(value['absent'] is not True, 'tree.absence-check: not a completed removal')
            if value['absent'] is False:
                require(value['finalOsError'] is None, 'tree.still-present: synthetic io error has no OS code')
    require(all(item[1] in (5, 32, 33) for item in retry_failures),
            'tree.retries: only observed numeric errors 5/32/33 may precede another call')


def validate_finished_cleanup_observations(finished, *, started=None):
    """Validate new observation fields without replacing original acceptance gates.

    Returns availability and original outcome flags, never inferred success.
    started may be the already-bound original Ledger started record; no token
    identities, capabilities, PNGs, or existing cleanup gates are reimplemented.
    """
    require(type(finished) is dict and finished.get('phase') == 'finished', 'Actual finished record required')
    for key in ('privateTreeCleanup', 'cleanupTimeline', 'ipcThreadCleanup'):
        require(key in finished, 'Explicit nullable observation field missing: ' + key)
    original_flags = ('successful', 'cleanupUncertain', 'privateTreeRemoved', 'ipcThreadsCompleted',
                      'ownedJobCreated', 'profileCreated', 'profileDeleted', 'cancelled', 'deadlineExpired')
    for key in original_flags:
        boolean(finished.get(key), key)
    if started is not None:
        require(type(started) is dict and started.get('phase') == 'started'
                and started.get('requestId') == finished.get('requestId')
                and started.get('productPid') == finished.get('productPid'),
                'Supplied started observation must belong to this finished record')
    tree, timeline, ipc = (finished[key] for key in ('privateTreeCleanup', 'cleanupTimeline', 'ipcThreadCleanup'))
    tree_cleanup(tree)
    require(type(ipc) is list and len(ipc) <= 3, 'ipcThreadCleanup: at most three actual threads')
    seen = []
    for row in ipc:
        exact_object(row, IPC_KEYS, 'ipcThreadCleanup.row')
        require(row['stream'] in STREAM_ORDER and row['stream'] not in seen, 'IPC stream unknown or duplicated')
        seen.append(row['stream'])
        integer(row['elapsedMs'], 0, U64, 'ipc.elapsedMs')
        for key in ('cancelRequested', 'finished', 'panicked'):
            boolean(row[key], 'ipc.' + key)
        if row['cancelCallSucceeded'] is not None:
            boolean(row['cancelCallSucceeded'], 'ipc.cancelCallSucceeded')
        optional_integer(row['cancelWin32Error'], 0, U32, 'ipc.cancelWin32Error')
        for key in ('progressAtJoin', 'progressAtCancel', 'progressAtEnd'):
            progress(row[key], 'ipc.' + key)
        # A row is emitted only for an actually created JoinHandle. All candidate
        # launcher call sites supply its Progress, even for an unfinished thread.
        require(row['progressAtJoin'] is not None and row['progressAtEnd'] is not None,
                'Created IPC thread must retain join/end progress observations')
        if row['cancelRequested']:
            require(type(row['cancelCallSucceeded']) is bool and row['progressAtCancel'] is not None,
                    'Requested cancellation must retain its actual call and progress sample')
            if row['cancelCallSucceeded']:
                require(row['cancelWin32Error'] is None, 'Successful cancel call has no captured error')
        else:
            require(row['cancelCallSucceeded'] is None and row['cancelWin32Error'] is None
                    and row['progressAtCancel'] is None, 'Unrequested cancellation must not invent facts')
        require(not row['panicked'] or row['finished'], 'Only an ended joined thread can be observed panicked')
        if row['cancelRequested'] or not row['finished'] or row['panicked']:
            require(finished['cleanupUncertain'] is True and finished['successful'] is False,
                    'Observed join failure/cancellation must retain the original failed cleanup')
        if not row['finished'] or row['panicked']:
            require(finished['ipcThreadsCompleted'] is False, 'Unjoined/panicked IPC cannot claim completed joins')
        # Deliberately no pending<=>finished equivalence and no elapsed upper
        # bound of 50/250ms: scheduling/syscalls can outlast those decision times.
    require(seen == sorted(seen, key=STREAM_ORDER.index), 'IPC observations must preserve actual join order')
    no_created_resources = (started is None and not finished['ownedJobCreated']
                            and not finished['profileCreated'] and not ipc
                            and (finished['cancelled'] or finished['deadlineExpired']))
    if timeline is None:
        require(no_created_resources and tree is None,
                'Only an uncreated cancelled observation may lack the whole timeline')
    else:
        exact_object(timeline, TIMELINE_KEYS, 'cleanupTimeline')
        for key in TIMELINE_KEYS:
            optional_integer(timeline[key], 0, U64, 'timeline.' + key)
        times = [timeline[key] for key in TIMELINE_KEYS if timeline[key] is not None]
        require(times == sorted(times), 'Cumulative cleanup observations must not move backwards')
        require(timeline['ipcJoinsFinishedMs'] is not None, 'Actual cleanup records when joins completed')
        require((timeline['jobStopFinishedMs'] is not None) == finished['ownedJobCreated'],
                'Job-stop observation must match whether a Job was created')
        require((timeline['treeDeleteFinishedMs'] is not None) == (tree is not None),
                'Tree deletion time and actual attempt observations disagree')
        if not finished['profileCreated']:
            require(timeline['profileDeleteFinishedMs'] is None, 'Uncreated profile has no deletion time')
        elif tree is not None:
            require(timeline['profileDeleteFinishedMs'] is not None, 'Profile deletion attempt time missing')
        else:
            require(timeline['profileDeleteFinishedMs'] is None, 'Skipped tree/profile deletion must remain unobserved')
        if started is not None:
            require(timeline['pinsReleasedMs'] is not None, 'Started helper has actual pinned-code release observation')
    if tree is None:
        require(no_created_resources or (finished['ownedJobCreated']
                and finished.get('jobActiveAfterStop') != 0),
                'An attempted owned-tree deletion cannot lose its observations')
    else:
        require(finished['privateTreeRemoved'] is (tree['terminalPhase'] == 'complete'),
                'Tree observation must not overwrite the original removal result')
        if tree['terminalPhase'] != 'complete':
            require(finished['cleanupUncertain'] is True and finished['successful'] is False,
                    'Failed removal observation cannot erase the original cleanup failure')
    if started is not None or finished['successful']:
        require(seen == list(STREAM_ORDER), 'An actual ready renderer retains all three IPC join observations')
    return {'observationEvidenceVerified': True,
            'privateTreeObservationPresent': tree is not None,
            'treeAbsenceCompletionObserved': tree is not None and tree['terminalPhase'] == 'complete',
            'timelinePresent': timeline is not None, 'ipcThreadsObserved': len(ipc),
            'originalOutcomeFlags': {key: finished[key] for key in original_flags},
            'nativeAcceptanceEvaluated': False, 'requiresOriginalAuditLedger': True,
            'ioCompletionUsedAsThreadJoinProof': False, 'nullOsErrorUsedAsSuccessProof': False}


def validate_cleanup_observation_events(events):
    require(type(events) is list and len(events) <= 512, 'Bounded actual native event list required')
    starts = {}
    records, errors = [], []
    for index, event in enumerate(events):
        require(type(event) is dict, 'Native event object required')
        phase = event.get('phase')
        require(phase in ('admitted', 'started', 'finished'), 'Unknown native event phase')
        key = (event.get('productPid'), event.get('requestId'))
        integer(key[0], 1, U32, 'event.productPid')
        require(type(key[1]) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', key[1]), 'Bounded native request identity required')
        if phase == 'started':
            starts[key] = event
        elif phase == 'finished':
            record = {'eventIndex': index, 'productPid': key[0], 'requestId': key[1]}
            try:
                record.update(validate_finished_cleanup_observations(event, started=starts.get(key)))
            except ObservationError as error:
                record.update(observationEvidenceVerified=False, error=str(error))
                errors.append({'eventIndex': index, 'error': str(error)})
            records.append(record)
    return {'contractCommit': CONTRACT_COMMIT, 'observationEvidenceVerified': not errors,
            'finishedRecordsChecked': len(records), 'hasFinishedEvidence': bool(records),
            'records': records, 'errors': errors, 'nativeAcceptanceEvaluated': False,
            'requiresOriginalAuditLedger': True, 'networkAccessed': False, 'inputsModified': False}


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    def invalid(value):
        raise ObservationError('Non-finite JSON number')
    return json.loads(data.decode('utf-8-sig'), object_pairs_hook=pairs, parse_constant=invalid)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--self-test', action='store_true', help='Pure synthetic regression cases only')
    source.add_argument('--report', type=Path, help='Existing product report containing nativeAudit')
    source.add_argument('--events', type=Path, help='Existing JSON array of raw native events')
    args = parser.parse_args()
    if args.self_test:
        import unittest
        suite = unittest.defaultTestLoader.loadTestsFromName('test_cleanup_observations')
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        print(json.dumps({'scope': 'SYNTHETIC LOCAL OBSERVATIONS ONLY', 'tests': result.testsRun,
                          'passed': result.testsRun-len(result.failures)-len(result.errors),
                          'successful': result.wasSuccessful(), 'networkAccessed': False,
                          'windowsOrProductExecuted': False, 'contractCommit': CONTRACT_COMMIT}, indent=2))
        return 0 if result.wasSuccessful() else 1
    file = args.report or args.events
    require(file.is_file() and not file.is_symlink() and file.stat().st_size <= 2 * 1024 * 1024,
            'Plain bounded input required')
    with file.open('rb') as stream:
        raw = stream.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024, 'Input changed beyond its byte budget')
    data = strict_json(raw)
    result = validate_cleanup_observation_events(data['nativeAudit'] if args.report else data)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['observationEvidenceVerified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

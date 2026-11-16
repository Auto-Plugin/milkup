#!/usr/bin/env python3
"""Offline reconciliation, not a prediction of cache hits or a dispatch gate."""
import argparse
import collections
import hashlib
import json
import pathlib
import re


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def objects(path):
    rows = {}
    for line in path.read_text().splitlines()[1:]:
        fields = line.split('\t')
        if len(fields) == 5 and fields[3].endswith('.o'):
            duration = (int(fields[1]) - int(fields[0])) / 1000
            assert duration >= 0
            rows[fields[3]] = max(rows.get(fields[3], 0), duration)
    return rows


def reconcile(current, previous, histories):
    continuation = json.loads((current / 'pagination-continuation.json').read_text())
    preflight = json.loads((current / 'pagination-build-result.json').read_text())
    gate = json.loads((current / 'pagination-object-gate/result.json').read_text())
    log = current / 'pagination-cached-build.log'
    completed = set(re.findall(r'Building (?:CXX|C|ASM) object (\S+)', log.read_text()))
    universe = objects(previous / 'ninja_log')
    assert len(universe) == preflight['compileCommands'] == 3263
    assert completed <= universe.keys()
    remaining = universe.keys() - completed
    observed = collections.defaultdict(list)
    inputs = [log, current / 'pagination-continuation.json',
              current / 'pagination-build-result.json', previous / 'ninja_log']
    for history in histories:
        path = history / 'ninja_log'
        inputs.append(path)
        for target, seconds in objects(path).items():
            observed[target].append({'log': str(path), 'seconds': seconds})
    rows = [{'target': name, 'historicalObservations': observed[name],
             'historicalMaxSeconds': max((x['seconds'] for x in observed[name]), default=None)}
            for name in sorted(remaining)]
    known = [r['historicalMaxSeconds'] for r in rows if r['historicalMaxSeconds'] is not None]
    total = sum(known)
    return {
        'status': 'planning-only-not-a-completion-bound',
        'testedSha': continuation['harnessSha'],
        'stopReason': continuation['stopReason'],
        'compileSeconds': continuation['compileSeconds'],
        'timeLimitSeconds': continuation['maxSeconds'],
        'newHits': continuation['samples'][-1]['newHits'],
        'newMisses': continuation['samples'][-1]['newMisses'],
        'uniqueCompletedObjectsInContinuationLog': len(completed),
        'previousCompleteGraphObjects': len(universe),
        'remainingNotInContinuationLog': len(remaining),
        'remainingByComponent': dict(collections.Counter(x.split('/')[1] for x in remaining)),
        'separatelyPassedTuCount': gate['uniqueObjectCommands'],
        'historicalTimingCoverage': len(known),
        'historicalMaxAggregateSeconds': round(total, 3),
        'idealFourWayHistoricalSeconds': round(total / 4, 3),
        'objectsWithOnlySubFiveSecondHistoricalMax': sum(x < 5 for x in known),
        'illustrativeTwoTimesHistoricalFourWaySeconds': round(total / 2, 3),
        'limitations': [
            'Previous complete graph is not the missing current full Ninja graph.',
            'Four separately compiled TUs may occur in remaining; this is conservative bookkeeping.',
            'Historical runs used different research patches; durations include cache hits.',
            'Sub-five-second objects are not proven cold compile measurements.',
            'Four-way sum ignores dependency serialization, link contention and runner variance.',
            'The 65 new misses were not retained and cannot be credited to a new run.',
            'A multiplier is a planning scenario, not an upper bound or permission to dispatch.',
        ],
        'inputs': [{'path': str(p), 'bytes': p.stat().st_size, 'sha256': sha(p)} for p in inputs],
        'remainingObjects': rows,
    }


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--current', type=pathlib.Path, required=True)
    p.add_argument('--previous', type=pathlib.Path, required=True)
    p.add_argument('--history', type=pathlib.Path, action='append', required=True)
    p.add_argument('--output', type=pathlib.Path, required=True)
    a = p.parse_args()
    a.output.write_text(json.dumps(reconcile(a.current, a.previous, a.history), indent=2) + '\n')

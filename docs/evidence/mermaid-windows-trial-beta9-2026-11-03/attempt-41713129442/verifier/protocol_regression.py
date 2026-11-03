"""Read-only, closed evidence parsing for the owned Windows inheritance control."""
import re

import product_evidence as P

MARKER = 'MILKUP_PROTOCOL_INHERITANCE '
SCOPE = 'generic-child-inheritance-mechanism; test parent stands in for helper'
TEST_PREFIX = 'test protocol_handles::tests::confined_protocol_handles_prevent_generic_child_from_holding_pipe_eof ... '
FIELDS = {'scope', 'confined', 'rendererJobActiveAfterStop', 'rendererHeldProcessSignaled',
          'holderAliveAtPipeResult', 'stdoutEof', 'stderrEof', 'stdoutWin32Error',
          'stderrWin32Error', 'holderJobActiveAfterStop', 'holderHeldProcessSignaled',
          'historicalHolderIdentified'}
MAX_LOG_BYTES = 2 * 1024 * 1024
MAX_PROOF_BYTES = 2048


def validate_native_regression(raw):
    P.require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_LOG_BYTES,
              'Bounded actual native regression log required')
    lines = raw.decode('utf-8-sig', errors='strict').splitlines()
    proofs = []
    proof_lines = []
    for number, line in enumerate(lines):
        if 'MILKUP_PROTOCOL_INHERITANCE' not in line:
            continue
        if line.startswith(TEST_PREFIX):
            line = line[len(TEST_PREFIX):]
        P.require(line.startswith(MARKER), 'Unexpected native proof log prefix')
        payload = line[len(MARKER):].encode('utf-8')
        P.require(0 < len(payload) <= MAX_PROOF_BYTES, 'Native inheritance JSON exceeds fixed budget')
        value = P.parse_json(payload)
        P.require(isinstance(value, dict) and set(value) == FIELDS, 'Closed native inheritance fields required')
        P.require(value['scope'] == SCOPE and type(value['confined']) is bool,
                  'Native inheritance scope/boolean differs')
        P.require(value['rendererHeldProcessSignaled'] is True and value['holderHeldProcessSignaled'] is True and
                  value['holderAliveAtPipeResult'] is True and value['historicalHolderIdentified'] is False,
                  'Native inheritance held-process/holder/history proof rejected')
        for field in ('rendererJobActiveAfterStop', 'holderJobActiveAfterStop'):
            P.require(type(value[field]) is int and value[field] == 0, 'Owned regression Job did not empty')
        for stream in ('stdout', 'stderr'):
            P.require(value[stream + 'Eof'] is value['confined'], 'Inheritance EOF control differs')
            error = value[stream + 'Win32Error']
            P.require(error is None if value['confined'] else type(error) is int and error == 995,
                      'Inheritance control must observe actual 995 or confined EOF without error')
        proofs.append(value)
        proof_lines.append(number)
        P.require(len(proofs) <= 2, 'Duplicate native inheritance proof')
    P.require(len(proofs) == 2 and [x['confined'] for x in proofs] == [False, True],
              'Both ordered inheritance controls are required')
    summaries = [(number, re.fullmatch(r'test result: ok\. ([1-9][0-9]*) passed; 0 failed; ([0-9]+) ignored; 0 measured; 0 filtered out; finished in [0-9.]+s', line))
                 for number, line in enumerate(lines) if line.startswith('test result:')]
    P.require(len(summaries) == 1 and summaries[0][1] is not None and summaries[0][0] > proof_lines[-1],
              'Successful actual native test completion after both controls required')
    summary = summaries[0][1]
    return {'actualLogSha256': P.sha256(raw), 'actualLogBytes': len(raw), 'controls': proofs,
            'nativeTestsPassed': int(summary[1]), 'nativeTestsIgnored': int(summary[2]),
            'historicalHolderIdentified': False,
            'scope': 'Observed generic-child inheritance mechanism; separate installed-product acceptance remains mandatory'}

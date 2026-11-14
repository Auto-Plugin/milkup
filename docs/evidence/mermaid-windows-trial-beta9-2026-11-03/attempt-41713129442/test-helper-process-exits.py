"""Synthetic diagnostic-parser checks only; no Windows or real artifact execution."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('helper_stats', Path(__file__).with_name('summarize-helper-process-exits.py'))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)


def event():
    timeout = {'waitStatus': 'timeout', 'waitResult': 258, 'win32Error': None,
               'exitCode': None, 'exitCodeWin32Error': None}
    signaled = {**timeout, 'waitStatus': 'signaled', 'waitResult': 0, 'exitCode': 1}
    return {'productPid': 42, 'requestId': 'synthetic-request', 'phase': 'finished',
            'helperProcessExitObservation': {'beforeTerminate': timeout, 'afterTerminateRequest': signaled,
                'handleReleasedBeforeAccounting': True}, 'ownedJobCreated': True, 'jobActiveAfterStop': 0,
            'successful': False, 'cleanupUncertain': True, 'ipcThreadsCompleted': True,
            'stdoutFailure': {'win32Error': 995}, 'stderrFailure': {'win32Error': 995},
            'privateTreeRemoved': True, 'privateTreeCleanup': {'attempts': 2, 'elapsedMs': 143,
                'failedAttempts': [[1, 5]], 'terminalPhase': 'complete', 'absenceChecked': True, 'absent': True}}


class StatisticsTests(unittest.TestCase):
    def test_signaled_and_job_zero_never_erase_995_or_failed_outcome(self):
        original = event(); result = S.summarize([original]); row = result['requests'][0]
        self.assertEqual(result['observedSnapshotStateCounts']['afterTerminateRequest']['signaled'], 1)
        self.assertEqual(result['counts']['requestsWithBothStreams995'], 1)
        self.assertEqual(result['counts']['requestsWithRecordedAttemptAfterTreeOs5'], 1)
        self.assertFalse(row['originalFinishedFields']['successful'])
        self.assertTrue(row['originalFinishedFields']['cleanupUncertain'])
        self.assertEqual(row['helperProcessExitObservation'], original['helperProcessExitObservation'])
        self.assertNotIn('accepted', row)

    def test_created_job_null_missing_and_uncreated_null_are_distinct(self):
        for presence, created, expected in [('null', True, True), ('missing', True, True), ('null', False, False)]:
            value = event(); value['ownedJobCreated'] = created
            if presence == 'null': value[S.OBSERVATION] = None
            else: del value[S.OBSERVATION]
            row = S.summarize([value])['requests'][0]
            self.assertEqual(row['observationMissingDespiteCreatedJob'], expected)
            self.assertEqual(S.OBSERVATION in row, presence == 'null')
            self.assertEqual(row['helperObservationAvailability'], 'explicit-null' if presence == 'null' else 'missing-field')

    def test_unfinished_request_remains_unfinished(self):
        result = S.summarize([{'productPid': 42, 'requestId': 'synthetic-request', 'phase': 'admitted'}])
        self.assertEqual(result['counts']['unfinishedRequests'], 1)
        self.assertNotIn(S.OBSERVATION, result['requests'][0])

    def test_no_observed_records_does_not_fabricate_requests(self):
        result = S.summarize([])
        self.assertEqual(result['counts']['nativeRequests'], 0)
        self.assertEqual(result['requests'], [])

    def test_closed_schema_types_and_status_mapping_reject_invalid_facts(self):
        original = event()[S.OBSERVATION]
        changes = [('waitResult', True), ('waitResult', 0), ('exitCode', 1), ('win32Error', 5), ('extra', None)]
        for key, value in changes:
            edited = copy.deepcopy(original); edited['beforeTerminate'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): S.observation(edited)
        edited = copy.deepcopy(original); edited['handleReleasedBeforeAccounting'] = 1
        with self.assertRaises(ValueError): S.observation(edited)

    def test_duplicate_json_and_duplicate_request_phase_are_rejected(self):
        with self.assertRaises(ValueError): S.parse(b'{"a":1,"a":1}')
        with self.assertRaises(ValueError): S.summarize([event(), event()])

    def test_raw_logs_must_equal_report_without_boolean_integer_coercion(self):
        with tempfile.TemporaryDirectory(prefix='synthetic-helper-statistics-') as temporary:
            root = Path(temporary); directory = root / 'pure-standard'; directory.mkdir()
            value = event(); candidate = 'a' * 40
            report = {'candidateSha': candidate, 'expectedAccountKind': 'pure-standard', 'status': 'failed', 'nativeAudit': [value]}
            (directory/'artifact-manifest.json').write_text(json.dumps({'candidateSha':candidate,'workflowRunId':'1'}))
            (directory/'ordinary-product.log').write_text(S.PREFIX + json.dumps(value) + '\n')
            (directory/'mermaid-product-e2e.json').write_text(json.dumps(report))
            self.assertTrue(S.account(root, 'pure-standard', candidate, '1')['rawLogsExactlyMatchReport'])
            report['nativeAudit'][0]['successful'] = 0
            (directory/'mermaid-product-e2e.json').write_text(json.dumps(report))
            with self.assertRaises(ValueError): S.account(root, 'pure-standard', candidate, '1')


if __name__ == '__main__':
    unittest.main()

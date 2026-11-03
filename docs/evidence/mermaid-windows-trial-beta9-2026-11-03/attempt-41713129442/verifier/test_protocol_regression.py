"""Synthetic parser rejection cases; never Windows execution evidence."""
import copy
import json
import unittest

import package_evidence as K
import protocol_regression as R


def proof(confined):
    return {'scope': R.SCOPE, 'confined': confined, 'rendererJobActiveAfterStop': 0,
            'rendererHeldProcessSignaled': True, 'holderAliveAtPipeResult': True,
            'stdoutEof': confined, 'stderrEof': confined,
            'stdoutWin32Error': None if confined else 995, 'stderrWin32Error': None if confined else 995,
            'holderJobActiveAfterStop': 0, 'holderHeldProcessSignaled': True,
            'historicalHolderIdentified': False}


def log(rows=None, prefix=R.TEST_PREFIX, summary='test result: ok. 69 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.42s'):
    rows = [proof(False), proof(True)] if rows is None else rows
    lines = [R.MARKER + json.dumps(value, separators=(',', ':')) for value in rows]
    if lines: lines[0] = prefix + lines[0]
    return ('\ufeffrunning 73 tests\r\n' + '\r\n'.join(lines) + '\r\nok\r\n' + summary + '\r\n').encode()


class ProtocolRegressionTests(unittest.TestCase):
    def test_both_actual_control_shapes_with_libtest_prefix(self):
        for prefix in ('', R.TEST_PREFIX):
            result = R.validate_native_regression(log(prefix=prefix))
            self.assertEqual([x['confined'] for x in result['controls']], [False, True])
            self.assertFalse(result['historicalHolderIdentified'])

    def test_missing_duplicate_or_reversed_control_rejected(self):
        for rows in ([], [proof(False)], [proof(True)], [proof(False)] * 2,
                     [proof(True), proof(False)], [proof(False), proof(True), proof(True)]):
            with self.subTest(rows=rows), self.assertRaises(ValueError): R.validate_native_regression(log(rows))

    def test_invalid_eof_error_pair_is_rejected(self):
        for index in (0, 1):
            for stream in ('stdout', 'stderr'):
                for field, value in ((stream+'Eof', not bool(index)), (stream+'Win32Error', 5),
                                     (stream+'Win32Error', None if index == 0 else 995)):
                    rows = [proof(False), proof(True)]; rows[index][field] = value
                    with self.subTest(index=index, field=field, value=value), self.assertRaises(ValueError): R.validate_native_regression(log(rows))

    def test_boolean_and_integer_types_are_not_interchangeable(self):
        for field, value in [('confined', 0), ('stdoutEof', 0), ('stderrEof', 0),
                             ('rendererJobActiveAfterStop', False), ('holderJobActiveAfterStop', False),
                             ('stdoutWin32Error', 995.0), ('stderrWin32Error', '995')]:
            rows = [proof(False), proof(True)]; rows[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): R.validate_native_regression(log(rows))

    def test_holder_and_renderer_cleanup_and_liveness_are_required(self):
        for index in (0, 1):
            for field, value in [('rendererJobActiveAfterStop', 1), ('holderJobActiveAfterStop', 1),
                                 ('rendererHeldProcessSignaled', False), ('holderHeldProcessSignaled', False),
                                 ('holderAliveAtPipeResult', False), ('historicalHolderIdentified', True)]:
                rows = [proof(False), proof(True)]; rows[index][field] = value
                with self.subTest(index=index, field=field), self.assertRaises(ValueError): R.validate_native_regression(log(rows))

    def test_missing_unknown_duplicate_json_fields_are_rejected(self):
        for key in R.FIELDS:
            rows = [proof(False), proof(True)]; del rows[0][key]
            with self.subTest(key=key), self.assertRaises(ValueError): R.validate_native_regression(log(rows))
        rows = [proof(False), proof(True)]; rows[0]['unknown'] = True
        with self.assertRaises(ValueError): R.validate_native_regression(log(rows))
        with self.assertRaises(ValueError): R.validate_native_regression(log().replace(b'"confined":false', b'"confined":false,"confined":false'))

    def test_unknown_marker_prefix_or_scope_is_rejected(self):
        for prefix in ('injected ', 'test unrelated ... '):
            with self.assertRaises(ValueError): R.validate_native_regression(log(prefix=prefix))
        rows = [proof(False), proof(True)]; rows[1]['scope'] = 'historical holder identified'
        with self.assertRaises(ValueError): R.validate_native_regression(log(rows))

    def test_missing_or_failed_native_completion_is_rejected(self):
        for summary in ('', 'test result: FAILED. 68 passed; 1 failed; 4 ignored; 0 measured; 0 filtered out; finished in 1.0s',
                        'test result: ok. 69 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 1.0s\r\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.0s'):
            with self.assertRaises(ValueError): R.validate_native_regression(log(summary=summary))

    def test_actual_log_and_proof_size_are_bounded(self):
        with self.assertRaises(ValueError): R.validate_native_regression(b'x' * (R.MAX_LOG_BYTES + 1))
        with self.assertRaises(ValueError): R.validate_native_regression(log().replace(R.MARKER.encode(), R.MARKER.encode() + b' ' * R.MAX_PROOF_BYTES, 1))

    def test_new_log_has_a_closed_manifest_name(self):
        files = {name: b'{}' for name in K.INSPECTION_NAMES}
        files['native-regression.log'] = log()
        files['manifest.json'] = json.dumps({'candidateSha': 'a'*40, 'includesBinariesOrProfiles':False,
            'files':[{'name':n, **K.record(v)} for n,v in files.items()]}).encode()
        result = K.inspection_manifest(files, 'a'*40)
        self.assertEqual(result['missingForAcceptance'], [])
        self.assertEqual(len(files), 17)
        with self.assertRaises(ValueError): K.inspection_manifest({**files, 'other-native.log':b''}, 'a'*40)


if __name__ == '__main__':
    unittest.main()

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import os
import sys
from unittest.mock import patch
import unittest
import yaml

spec = importlib.util.spec_from_file_location('admit', Path(__file__).with_name('webkit-build-admission.py'))
admit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admit)


def request(parent='a' * 40):
    return {'schemaVersion': 1, 'mode': 'capacity-sdk-native-preflight-only', 'sourceVersion': '2.54.3', 'sourceSha256': admit.SOURCE, 'patchSha256': admit.PATCH, 'expectedParentSha': parent, 'requestId': 'b' * 32}


def context(head='c' * 40):
    return {'repository': 'Auto-Plugin/milkup', 'ref': 'refs/heads/v2', 'event': 'push', 'sha': head, 'before': admit.BASELINE}


class Admission(unittest.TestCase):
    def test_exact_request(self):
        admit.validate_request(request(), context(), 'c' * 40, ['a' * 40], [admit.REQUEST_PATH])

    def test_scope_and_source_negative_matrix(self):
        for key, value in [('repository', 'other/repo'), ('ref', 'refs/heads/main'), ('event', 'pull_request'), ('sha', 'd' * 40), ('before', 'd' * 40)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                admit.validate_request(request(), {**context(), key: value}, 'c' * 40, ['a' * 40], [admit.REQUEST_PATH])
        for key in request():
            r = request(); r[key] = 'wrong'
            with self.subTest(key=key), self.assertRaises(ValueError):
                admit.validate_request(r, context(), 'c' * 40, ['a' * 40], [admit.REQUEST_PATH])
        for changed in [[], [admit.REQUEST_PATH, 'apps/desktop/src/main.ts'], ['wrong']]:
            with self.assertRaises(ValueError):
                admit.validate_request(request(), context(), 'c' * 40, ['a' * 40], changed)
        with self.assertRaises(ValueError):
            admit.validate_request(request(), context(), 'c' * 40, ['a' * 40, 'd' * 40], [admit.REQUEST_PATH])

    def test_real_git_boundary(self):
        with tempfile.TemporaryDirectory() as d:
            repo = Path(d)
            def git(*args):
                return subprocess.check_output(['git', '-c', 'user.name=Codex', '-c', 'user.email=codex@openai.com', *args], cwd=repo, stderr=subprocess.DEVNULL, text=True).strip()
            git('init', '-b', 'v2')
            (repo/'README').write_text('fixture')
            git('add', '.'); git('commit', '-m', 'fixture')
            baseline = git('rev-parse', 'HEAD')
            original_baseline = admit.BASELINE
            admit.BASELINE = baseline
            self.addCleanup(setattr, admit, 'BASELINE', original_baseline)
            (repo/'README').write_text('reviewed setup')
            git('add', '.'); git('commit', '-m', 'reviewed setup')
            parent = git('rev-parse', 'HEAD')
            p = repo/admit.REQUEST_PATH; p.parent.mkdir(); p.write_text(json.dumps(request(parent)))
            git('add', '.'); git('commit', '-m', '[webkit-capacity-admission] fixture')
            head = git('rev-parse', 'HEAD')
            receipt = admit.validate_checkout(repo, context(head))
            self.assertEqual(receipt['checkoutSha'], head)
            self.assertEqual(receipt['requestSha256'], hashlib.sha256(p.read_bytes()).hexdigest())
            (repo/'README').write_text('uncommitted change')
            with self.assertRaisesRegex(ValueError, 'Clean checkout'):
                admit.validate_checkout(repo, context(head))

    def test_capacity_and_memory_limits(self):
        good = {'diskFreeBytes': 89 * admit.GIB, 'freeInodes': 1000000, 'memoryEffectiveLimitBytes': 15 * admit.GIB, 'memoryAvailableBytes': 12 * admit.GIB, 'cpuAffinityCount': 4}
        self.assertEqual(admit.evaluate_capacity({'ID':'ubuntu','VERSION_ID':'26.04'}, 'x86_64', 1000, good), [])
        for field in good:
            with self.subTest(field=field):
                reasons = admit.evaluate_capacity({'ID':'ubuntu','VERSION_ID':'26.04'}, 'x86_64', 1000, {**good, field: 1})
                self.assertIn('insufficient-' + field, reasons)
        self.assertIn('requires-ubuntu-26.04', admit.evaluate_capacity({'ID':'debian','VERSION_ID':'13'}, 'x86_64', 1000, good))
        self.assertIn('ordinary-user-required', admit.evaluate_capacity({'ID':'ubuntu','VERSION_ID':'26.04'}, 'x86_64', 0, good))

    def test_no_native_probe_without_explicit_optin(self):
        result = admit.native_preflight(False)
        self.assertEqual(result['status'], 'not-run')
        self.assertFalse(result['fullWebProcessOrDisplayVerified'])
        self.assertIn('--unshare-net', admit.NAMESPACE_ARGS)

    def test_subprocess_environment_drops_credential_sentinels(self):
        with patch.dict(os.environ, {'GH_TOKEN':'test-sentinel', 'ACTIONS_RUNTIME_TOKEN':'test-sentinel', 'AWS_SECRET_ACCESS_KEY':'test-sentinel'}):
            r = admit.command([sys.executable, '-c', 'import os,json;print(json.dumps(sorted(os.environ)))'])
        names = json.loads(r.stdout)
        for name in ['GH_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'AWS_SECRET_ACCESS_KEY']:
            self.assertNotIn(name, names)

    def test_sanitized_report_omits_tool_paths_and_payloads(self):
        base = {k: False for k in ['schemaVersion', 'status', 'blockingReasons', 'os', 'resources', 'native', 'engineBuildAdmitted', 'checkpointRestoreProven', 'sourceOrPatchDownloaded', 'buildExecuted', 'releaseReady', 'checkout']}
        base['sdk'] = {'missing': [], 'tools': {'x': {'path':'private-path'}}, 'modules': {}}
        self.assertNotIn('private-path', json.dumps(admit.sanitized(base)))

    def test_workflow_has_no_execution_or_transmission_escape(self):
        p = Path(__file__).resolve().parents[2] / '.github/workflows/webkit-capacity-admission.yml'
        text = p.read_text(); workflow = yaml.safe_load(text)
        self.assertEqual(workflow['on'], {'push': {'branches':['v2'], 'paths':[admit.REQUEST_PATH]}})
        self.assertEqual(workflow['permissions'], {'contents':'read'})
        job = workflow['jobs']['admission']
        self.assertEqual(job['runs-on'], 'ubuntu-26.04')
        self.assertEqual(job['timeout-minutes'], 15)
        self.assertEqual(len(job['steps']), 2)
        self.assertIn("github.event.before == '209c3fcd3baab736dd8ad204e33cce739396b027'", job['if'])
        self.assertIn('github.run_attempt == 1', job['if'])
        self.assertIn('env -i', job['steps'][1]['run'])
        self.assertIn('--depth=3', job['steps'][0]['run'])
        self.assertIn('credential.helper=', job['steps'][0]['run'])
        self.assertIn('https://github.com/Auto-Plugin/milkup.git', job['steps'][0]['run'])
        self.assertTrue(all('uses' not in step for step in job['steps']))
        self.assertIn('env -i', job['steps'][0]['run'])
        self.assertIn('--native-preflight', job['steps'][1]['run'])
        for step in job['steps']:
            self.assertNotIn('continue-on-error', step)
            for token in ['sudo ', 'apt-get ', 'upload-artifact@', 'actions/cache@', 'secrets.', 'gh workflow', 'ninja ', 'cmake ']:
                self.assertNotIn(token, step.get('run','') + step.get('uses',''))


if __name__ == '__main__': unittest.main()

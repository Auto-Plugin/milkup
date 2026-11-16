import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import app_compile_gate as gate


class AppCompileGate(unittest.TestCase):
    def test_final_runtime_family_is_exact(self):
        good = {'searchPath': '/opt/locked/lib', 'needed': ['libwebkit2gtk-4.1.so.0', 'libc.so.6']}
        gate.verify_link(good, '/opt/locked/lib', 'app')
        for bad in [{**good, 'searchPath': '/tmp/sdk/lib'}, {**good, 'needed': ['libc.so.6']},
                    {**good, 'needed': good['needed']+['libjavascriptcoregtk-6.0.so.1']}]:
            with self.assertRaises(ValueError): gate.verify_link(bad, '/opt/locked/lib', 'app')

    def test_exact_guard_bytes_not_old_or_ambiguous(self):
        with tempfile.TemporaryDirectory() as t:
            app = Path(t)/'app'; guard = Path(t)/'guard'
            guard.write_bytes(b'synthetic-guard-contract')
            app.write_bytes(b'prefix'+guard.read_bytes()+b'suffix')
            self.assertEqual(gate.verify_embedded(app, guard)['offset'], 6)
            app.write_bytes(b'not the guard')
            with self.assertRaises(ValueError): gate.verify_embedded(app, guard)
            app.write_bytes(guard.read_bytes()*2)
            with self.assertRaises(ValueError): gate.verify_embedded(app, guard)

    def test_wrong_retained_archive_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t)/'wrong.zip'; p.write_bytes(b'wrong')
            with self.assertRaises(ValueError): gate.receive(p, Path(t)/'output')
            self.assertFalse((Path(t)/'output').exists())

    def test_exact_cc_capture_and_duplicate_rejection(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t); source = root/'product/apps/desktop/src-tauri/src/output_guard.c'
            source.parent.mkdir(parents=True); source.write_text('/* synthetic capture test */')
            out = root/'build/cargo-target/build/id/out/libmilkup_output_guard.so'; out.parent.mkdir(parents=True)
            capture = root/'build/guard-capture'; capture.mkdir()
            env = {'MILKUP_COMPILE_SOURCE': str(root/'product'), 'MILKUP_COMPILE_CAPTURE': str(capture)}
            def compiled(args):
                self.assertEqual(args[0], '/usr/bin/cc')
                out.write_bytes(b'synthetic output, not native evidence')
                return subprocess.CompletedProcess(args, 0)
            with patch.dict(os.environ, env), patch.object(gate.subprocess, 'run', side_effect=compiled):
                self.assertEqual(gate.capture_cc([str(source), '-o', str(out)]), 0)
                with self.assertRaises(ValueError): gate.capture_cc([str(source), '-o', str(out)])
            r = json.loads((capture/'output_guard.c.json').read_text())
            self.assertEqual(r['sha256'], gate.digest(out)); self.assertEqual(r['sourceSha256'], gate.digest(source))

    def test_foreign_guard_or_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t); source = root/'output_guard.c'; source.write_text('not the product')
            with patch.dict(os.environ, {'MILKUP_COMPILE_SOURCE': str(root/'product')}):
                with self.assertRaises(ValueError): gate.capture_cc([str(source), '-o', str(root/'out')])

    def test_failed_command_keeps_first_failure_and_log(self):
        with tempfile.TemporaryDirectory() as t:
            b = gate.Build(Path(t), Path(t), Path(t)/'build')
            with patch.object(gate.shutil, 'disk_usage', return_value=type('Space', (), {'free': 4*1024**3})()):
                with self.assertRaises(ValueError):
                    b.run('negative', [sys.executable, '-c', 'print("controlled failure"); raise SystemExit(7)'], dict(os.environ), 10)
            result = json.loads((b.evidence/'result.json').read_text())
            self.assertEqual(result['steps'][0]['exitCode'], 7)
            self.assertIn('controlled failure', (b.evidence/'negative.log').read_text())
            self.assertFalse(result['installed']); self.assertFalse(result['releaseReady'])

    def test_timeout_is_failure_and_persists(self):
        with tempfile.TemporaryDirectory() as t:
            b = gate.Build(Path(t), Path(t), Path(t)/'build')
            with patch.object(gate.shutil, 'disk_usage', return_value=type('Space', (), {'free': 4*1024**3})()):
                with self.assertRaises(ValueError):
                    b.run('deadline', [sys.executable, '-c', 'import time; time.sleep(20)'], dict(os.environ), 0.1)
            self.assertEqual(b.report['steps'][0]['stopReason'], 'deadline')
            self.assertIsNotNone(b.report['steps'][0]['exitCode'])

    def test_non_ci_does_not_compile_and_keeps_error(self):
        with tempfile.TemporaryDirectory() as t:
            b = gate.Build(Path(t), Path(t), Path(t)/'build')
            with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), self.assertRaises(ValueError): b.execute()
            self.assertEqual(b.report['status'], 'failed-real-app-compile-gate')
            self.assertEqual(b.report['steps'], [])

    def test_manual_operation_selects_no_engine_job(self):
        text = (Path(__file__).resolve().parents[2]/'.github/workflows/linux-webkit-build-research.yml').read_text()
        self.assertIn('on:\n  workflow_dispatch:', text)
        selected = []
        for job, condition in re.findall(r'^  ([a-z][a-z-]+):\n    if: (.+)$', text, re.M):
            expr = condition.replace('github.repository', repr('Auto-Plugin/milkup'))
            expr = expr.replace('inputs.operation', repr('current-app-binding'))
            expr = expr.replace("startsWith(github.ref, 'refs/heads/dot/')", 'True')
            expr = expr.replace('&&', 'and').replace('||', 'or')
            if eval(expr, {'__builtins__': {}}, {}): selected.append(job)
        self.assertEqual(selected, ['current-app-binding'])
        section = text.split('\n  current-app-binding:\n')[1]
        self.assertIn('timeout-minutes: 85', section)
        self.assertIn('artifacts/14264654984/zip', section)
        for forbidden in ['source-provenance', 'unified-provenance', 'cmake --build', 'ninja ', 'current_tu_gate.py', 'sudo dpkg']:
            self.assertNotIn(forbidden, section)
        uploads = re.findall(r'          path: (.+)', section)
        self.assertIn('${{ runner.temp }}/app-compile/compiled-not-package/', uploads)


if __name__ == '__main__': unittest.main()

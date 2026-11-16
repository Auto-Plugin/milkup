import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import normal_completion as normal
import frontier_checkpoint as checkpoint

HERE = Path(__file__).resolve().parent


class NormalCompletion(unittest.TestCase):
    def test_real_retained_plan_reproduces_invalid_object_only_predicate(self):
        plan = gzip.decompress((HERE / 'evidence/43890194973/normal-all-objects-plan.log.gz').read_bytes()).decode()
        shared = [shlex.split(line) for line in plan.splitlines() if '-shared' in shlex.split(line)]
        self.assertEqual([a[a.index('-o') + 1] for a in shared], ['lib/libjavascriptcoregtk-4.1.so.0.11.9'])
        with self.assertRaisesRegex(AssertionError, 'Shared links'):
            assert not shared, 'Shared links must remain in the single-job final phase'
        edges = gzip.decompress((HERE / 'evidence/43890194973/actual-shared-prerequisite-edges.ninja.gz').read_bytes()).decode()
        chain = json.loads((HERE / 'evidence/43890194973/shared-prerequisite-chain.json').read_text())
        self.assertTrue(chain[-1].endswith('.o'))
        for first, second in zip(chain, chain[1:]):
            matches = [l for l in edges.splitlines() if l.startswith('build ') and second in l[6:].split(': ', 1)[0].split()]
            self.assertEqual(len(matches), 1)
            self.assertIn(first, matches[0].split(': ', 1)[1].split())

    def test_exact_manifest_and_narrow_harness_migration(self):
        prior = normal.pinned(HERE / 'evidence/43890194973/checkpoint-manifest.json.gz')
        old = prior['identity']; current = copy.deepcopy(old)
        for name in normal.NEW_HARNESSES: current['harnessFiles'][name] = 'a' * 64
        for name in normal.REVIEWED_HARNESS:
            current['harnessFiles'][normal.REPO_PREFIX + name] = 'b' * 64
        review = normal.reviewed_identity(old, current)
        self.assertEqual(review['incompatibleCompiledIdentityFields'], [])
        for field in ['configuration', 'graph', 'generatorAndLinkTools']:
            changed = copy.deepcopy(current); changed[field] = {'changed': True}
            self.assertEqual(normal.reviewed_identity(old, changed)['incompatibleCompiledIdentityFields'], [field])
        changed = copy.deepcopy(current)
        changed['harnessFiles'][normal.REPO_PREFIX + 'research/pdf-delivery-20261116/current_segment.py'] = 'c' * 64
        with self.assertRaisesRegex(AssertionError, 'Unreviewed'): normal.reviewed_identity(old, changed)
        changed = copy.deepcopy(current); changed['harnessFiles']['/unknown.py'] = 'c' * 64
        with self.assertRaisesRegex(AssertionError, 'Unreviewed'): normal.reviewed_identity(old, changed)
        self.assertEqual(prior['compiledObjectCount'], 367)
        self.assertFalse(prior['runtimeBytesArchived']); self.assertFalse(prior['pchBytesArchived'])

    @unittest.skipUnless(shutil.which('ninja') and shutil.which('cc'), 'Native Ninja/CC required; mandatory after official SDK')
    def test_real_shared_prerequisite_normal_all_and_object_only_checkpoint(self):
        with tempfile.TemporaryDirectory(prefix='normal-ninja-') as folder:
            root = Path(folder); source = root / 'source'; build = root / 'build'
            source.mkdir(); build.mkdir()
            (source / 'shared.c').write_text('int value(void){return 7;}\n')
            (source / 'consumer.c').write_text('#include "generated.h"\nint answer(void){return VALUE;}\n')
            cc = shutil.which('cc'); entries = {}
            for stem in ['shared', 'consumer']:
                args = [cc, '-fPIC', '-I.', '-MD', '-MT', stem + '.o', '-MF', stem + '.o.d', '-c', str(source / (stem + '.c')), '-o', stem + '.o']
                entries[stem + '.o'] = {'target': stem + '.o', 'source': str(source / (stem + '.c')), 'command': args, 'kind': 'object'}
            graph = 'rule compile\n  command = '+cc+' -fPIC -I. -MD -MT $out -MF $out.d -c $in -o $out\n  depfile = $out.d\n  deps = gcc\n'
            graph += 'rule shared\n  command = '+cc+' -shared shared.o -o libfixture.so\n'
            graph += 'rule header\n  command = printf "#define VALUE 7\\n" > generated.h\n'
            graph += 'build shared.o: compile '+str(source / 'shared.c')+'\nbuild libfixture.so: shared shared.o\nbuild generated.h: header libfixture.so\nbuild consumer.o: compile '+str(source / 'consumer.c')+' | generated.h\nbuild all: phony consumer.o libfixture.so\n'
            (build / 'build.ninja').write_text(graph)
            plan = subprocess.check_output(['ninja', '-t', 'commands', *entries], cwd=build, text=True, timeout=10)
            with self.assertRaises(AssertionError):
                assert not any('-shared' in shlex.split(line) for line in plan.splitlines())
            log = subprocess.check_output(normal.native_all_arguments(), cwd=build, text=True, stderr=subprocess.STDOUT, timeout=30)
            self.assertIn('-shared', log); self.assertTrue((build / 'consumer.o').is_file())
            manifest, payload = checkpoint.capture(build, source, entries, {'fixture': True}, ['consumer.o'], {})
            self.assertEqual(manifest['compiledObjectCount'], 2)
            self.assertNotIn('build/libfixture.so', payload)
            self.assertEqual(manifest['records']['libfixture.so']['kind'], 'link')
            self.assertTrue(all(manifest['records'][n[6:]]['kind'] in ['object', 'generated', 'depfile'] for n in payload if n.startswith('build/')))

    def test_optional_checkpoint_failure_is_recorded_without_masking_engine_status(self):
        import current_engine
        from types import SimpleNamespace
        persisted = []
        report = {'status': 'pending', 'fullEngineBuilt': True}
        def fail(label):
            raise OSError('bounded archive storage failure')
        gate = SimpleNamespace(snapshot=fail, report=report,
                               persist=lambda: persisted.append(copy.deepcopy(report)))
        self.assertIsNone(current_engine.EngineGate.optional_snapshot(gate, 'linked'))
        self.assertTrue(report['fullEngineBuilt'])
        self.assertEqual(report['status'], 'pending')
        self.assertIn('bounded archive storage failure', report['optionalCheckpointErrors'][0]['error'])
        self.assertEqual(len(persisted), 1)

    def staged_fixture(self, root):
        prefix = '/opt/milkup/runtime-qa/fixture'; dest = root / 'dest'; dest.mkdir()
        names = [prefix + '/' + suffix for suffix in ['bin/WebKitWebDriver',
            'lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess',
            'lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess',
            'lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitGPUProcess']]
        for name in names:
            file = dest / name.lstrip('/'); file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'synthetic runtime retention test only'); file.chmod(0o755)
        manifest = root / 'install_manifest.txt'; manifest.write_text('\n'.join(names) + '\n')
        return prefix, dest, manifest

    def test_separate_staging_archive_bound_to_real_manifest_not_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); prefix, dest, manifest = self.staged_fixture(root)
            rows = normal.stage_inventory(dest, prefix, manifest)
            output = root / 'runtime.tar.gz'; receipt = normal.archive_stage(dest, rows, output)
            self.assertEqual(receipt['sha256'], normal.sha(output)); self.assertEqual(len(rows), 4)
            with self.assertRaises(AssertionError): normal.archive_stage(dest, rows, output)
            extra = dest / 'unexpected'; extra.write_bytes(b'not declared')
            with self.assertRaisesRegex(AssertionError, 'Undeclared'): normal.stage_inventory(dest, prefix, manifest)
            extra.unlink(); manifest.write_text(manifest.read_text() + '/usr/lib/system.so\n')
            with self.assertRaises(AssertionError): normal.stage_inventory(dest, prefix, manifest)

    def test_staging_missing_driver_and_absolute_link_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); prefix, dest, manifest = self.staged_fixture(root)
            driver = dest / (prefix.lstrip('/') + '/bin/WebKitWebDriver')
            driver.unlink()
            with self.assertRaisesRegex(AssertionError, 'manifest/payload'): normal.stage_inventory(dest, prefix, manifest)
            driver.symlink_to('/usr/bin/false')
            with self.assertRaises(AssertionError): normal.stage_inventory(dest, prefix, manifest)


if __name__ == '__main__': unittest.main()

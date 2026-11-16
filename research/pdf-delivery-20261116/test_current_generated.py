import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import generated_closure as closure
import frontier_checkpoint as checkpoint
import normal_completion

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE / 'evidence/43901289344'
RUBY = os.environ.get('MILKUP_TEST_RUBY') or shutil.which('ruby')


class GeneratedContracts(unittest.TestCase):
    def source(self, root):
        source = root / 'source'; build = root / 'build'; build.mkdir()
        for name, expected in closure.SOURCE.items():
            p = source / name; p.parent.mkdir(parents=True, exist_ok=True)
            fixture = EVIDENCE / 'source' / p.name
            data = gzip.decompress(fixture.with_suffix(fixture.suffix + '.gz').read_bytes()) if p.name == 'CMakeLists.txt' else fixture.read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), expected); p.write_bytes(data)
        block = (EVIDENCE / 'air-producer.ninja').read_text()
        block = block.replace('/home/runner/work/_temp/milkup-current-source-gate/source', str(source)).replace('/home/runner/work/_temp/milkup-current-source-gate/build', str(build))
        (build / 'build.ninja').write_text(block)
        return source, build

    def test_actual_producer_graph_and_missing_prior_payload_reject_before_reuse(self):
        with tempfile.TemporaryDirectory() as d:
            source, build = self.source(Path(d))
            proof = closure.audit(source, build)
            self.assertEqual(proof['undeclaredOutputs'], [closure.PRODUCTS[1]])
            prior = normal_completion.pinned(HERE / 'evidence/43890194973/checkpoint-manifest.json.gz')
            self.assertEqual(closure.missing(prior), [closure.PRODUCTS[1]])
            original = (source / next(iter(closure.SOURCE))).read_bytes()
            (source / next(iter(closure.SOURCE))).write_bytes(original + b'\n# drift')
            with self.assertRaisesRegex(AssertionError, 'source drift'): closure.audit(source, build)

    @unittest.skipUnless(RUBY and shutil.which('ninja'), 'Real official Ruby/Ninja required; rerun after SDK')
    def test_real_official_ruby_three_outputs_and_ninja_undeclared_loss(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); source, build = self.source(root)
            proof = closure.audit(source, build)
            generated = build / 'JavaScriptCore/DerivedSources'; generated.mkdir(parents=True)
            # Exact official Ruby and input; tiny graph isolates only the original
            # declared-output relation, avoiding unrelated whole-engine building.
            command = [RUBY, str(source / next(iter(closure.SOURCE))), str(source / 'Source/JavaScriptCore/b3/air/AirOpcode.opcodes')]
            import shlex
            graph = 'rule generate\n  command = cd JavaScriptCore/DerivedSources && ' + shlex.join(command) + '\n'
            graph += 'build ' + ' '.join(proof['declaredOutputs']) + ': generate ' + ' '.join(command[1:]) + '\n'
            graph += 'build all: phony ' + ' '.join(proof['declaredOutputs']) + '\n'
            (build / 'build.ninja').write_text(graph)
            def ninja(): return subprocess.check_output(['ninja', '-v', 'all'], cwd=build, text=True, stderr=subprocess.STDOUT, timeout=30)
            ninja(); self.assertEqual(closure.completed(build), closure.PRODUCTS)
            prior = normal_completion.pinned(HERE / 'evidence/43890194973/checkpoint-manifest.json.gz')
            for name in proof['declaredOutputs']:
                self.assertEqual(checkpoint.digest(build / name), prior['records'][name]['sha256'])
            third = build / closure.PRODUCTS[1]; full_hash = checkpoint.digest(third)
            third.unlink(); self.assertIn('no work to do', ninja())
            self.assertFalse(third.exists())
            with self.assertRaisesRegex(AssertionError, 'Partially'): closure.completed(build)
            # Proposed fallback is a genuinely clean original producer, not an
            # empty replacement header or a changed compiler/include search path.
            for name in proof['declaredOutputs']: (build / name).unlink()
            ninja(); self.assertEqual(checkpoint.digest(third), full_hash)
            self.assertEqual(closure.completed(build), closure.PRODUCTS)

    def test_lossless_large_native_evidence_parts_and_corruption_controls(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); destination = root / 'native-deps.txt'
            data = (b'actual dependency record\n' * (65 * 1024**2 // 25 + 1))
            self.assertGreater(len(data), 64 * 1024**2)
            receipt = checkpoint.retain_native_stream(data, destination)
            self.assertEqual(receipt['lineCount'], data.count(b'\n'))
            def restore(rows):
                chunks = []
                for row in rows:
                    p = root / row['file']; self.assertEqual(checkpoint.digest(p), row['storedSha256'])
                    raw = gzip.decompress(p.read_bytes()); self.assertEqual(len(raw), row['rawBytes'])
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), row['rawSha256']); chunks.append(raw)
                raw = b''.join(chunks); self.assertEqual(len(raw), receipt['rawBytes'])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), receipt['rawSha256']); return raw
            self.assertEqual(restore(receipt['parts']), data)
            self.assertEqual(checkpoint.read_native_stream(destination), data)
            with self.assertRaises(AssertionError): restore(receipt['parts'][:-1])
            with self.assertRaises(AssertionError): restore(list(reversed(receipt['parts'])))
            first = root / receipt['parts'][0]['file']; first.write_bytes(first.read_bytes()[:-1])
            with self.assertRaises(AssertionError): restore(receipt['parts'])
            with self.assertRaises(AssertionError): checkpoint.read_native_stream(destination)
            class Oversize:
                def __len__(self): return 256 * 1024**2 + 1
            with self.assertRaisesRegex(AssertionError, 'total budget'): checkpoint.retain_native_stream(Oversize(), root / 'over')

    def test_versioned_manifest_roundtrip_and_old_envelope_cannot_accept_new(self):
        # Exceeds the former 32 MiB limit, like the measured 40,782,500-byte
        # real full-graph compiler metadata. It remains bounded and lossless.
        value = {'schema': checkpoint.SCHEMA, 'compilerMetadata': 'x' * (40 * 1024**2)}
        encoded = checkpoint.encode_manifest(value)
        self.assertEqual(checkpoint.decode_manifest('manifest.json.gz', encoded), value)
        with self.assertRaises(AssertionError): checkpoint.decode_manifest('manifest.json', json.dumps(value).encode())
        prior = normal_completion.pinned(HERE / 'evidence/43890194973/checkpoint-manifest.json.gz')
        self.assertEqual(checkpoint.decode_manifest('manifest.json', json.dumps(prior).encode()), prior)
        with self.assertRaises(AssertionError): checkpoint.decode_manifest('manifest.json.gz', gzip.compress(json.dumps(prior).encode()))
        with self.assertRaises((EOFError, OSError)): checkpoint.decode_manifest('manifest.json.gz', encoded[:-5])
        with patch.object(checkpoint, 'MAX_MANIFEST_RAW', 32):
            with self.assertRaisesRegex(AssertionError, 'raw budget'): checkpoint.decode_manifest('manifest.json.gz', encoded)
            with self.assertRaisesRegex(AssertionError, 'raw budget'): checkpoint.encode_manifest(value)

    @unittest.skipUnless(shutil.which('ninja') and shutil.which('cc'), 'Native fixture requires Ninja/CC')
    def test_checkpoint_keeps_unused_producer_byproduct_without_caching_runtime(self):
        from test_frontier_checkpoint import FrontierContracts
        fixture = FrontierContracts()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            source, build, entries, identity, graph, run, restore_run, helpers, ninja = fixture.fixture(root, False)
            run(['-v', '-d', 'keepdepfile', 'initialized', 'consumer.o'])
            hidden = build / 'unused-by-frontier.h'; hidden.write_bytes(b'// actual generated byproduct fixture\n')
            old, old_payload = checkpoint.capture(build, source, entries, identity, ['consumer.o'], helpers)
            self.assertNotIn('build/unused-by-frontier.h', old_payload)
            manifest, payload = checkpoint.capture(build, source, entries, identity, ['consumer.o'], helpers, generated_products=['unused-by-frontier.h'])
            self.assertIn('build/unused-by-frontier.h', payload)
            self.assertNotIn('build/bin/LLIntSettingsExtractor', payload)
            archive = root / 'archive.tar.gz'; checkpoint.write_archive(archive, manifest, payload)
            expected = hidden.read_bytes()
            shutil.rmtree(build); build.mkdir(); (build / 'bin').mkdir(); (build / 'build.ninja').write_text(graph); run(['initialized'])
            staging = root / 'staging'; loaded = checkpoint.load_archive(archive, checkpoint.digest(archive), identity, staging)
            checkpoint.restore(loaded, staging, build, source, restore_run, entries, helpers)
            self.assertEqual(hidden.read_bytes(), expected)
            self.assertIn('no work to do', run(['-v', '-d', 'keepdepfile', 'consumer.o']))


if __name__ == '__main__': unittest.main()

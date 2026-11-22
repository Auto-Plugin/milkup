import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('binding', Path(__file__).with_name('webkit-pdfjs-resource-binding.py'))
binding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(binding)


class ResourceBinding(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.name = 'web/standard_fonts/LiberationSans-Regular.ttf'
        p = self.source / self.name
        p.parent.mkdir(parents=True)
        p.write_bytes(b'synthetic font, not release evidence')
        self.patch = patch.object(binding.notices, 'ASSETS', {self.name: hashlib.sha256(p.read_bytes()).hexdigest()})
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.notices = self.root / 'notices'
        binding.notices.prepare(self.source, self.notices)
        self.tool = shutil.which('glib-compile-resources')
        if not self.tool or not shutil.which('gresource'):
            self.skipTest('Actual GLib tools required; no simulated resource pass')
        self.bundle = self.build()

    def build(self, data=None, prefix='/org/webkit/pdfjs'):
        resource = self.root / 'resource.bin'
        resource.write_bytes(data or (self.source / self.name).read_bytes())
        xml = self.root / 'resource.xml'
        xml.write_text(f'<gresources><gresource prefix="{prefix}"><file alias="{self.name}" compressed="true">resource.bin</file></gresource></gresources>')
        bundle = self.root / 'resources.gresource'
        subprocess.run([self.tool, '--sourcedir=' + str(self.root), '--target=' + str(bundle), str(xml)], check=True, timeout=10, capture_output=True)
        return bundle

    def verify(self, sha=None, bundle=None):
        bundle = bundle or self.bundle
        return binding.verify(self.source, self.notices, bundle, sha or hashlib.sha256(bundle.read_bytes()).hexdigest())

    def test_real_compressed_roundtrip_retains_nonapproval_boundaries(self):
        result = self.verify()
        self.assertEqual(result['assets'][0]['resourceName'], binding.PREFIX + self.name)
        for field in ['completeSbom', 'installedPayloadVerified', 'finalRuntimeMembershipVerified', 'legalApproval']:
            self.assertIs(result[field], False)

    def test_malformed_identity_rejected_before_reading(self):
        for value in ['v2', 'a' * 63, 'A' * 64, 'a' * 64 + '\n', None]:
            with self.assertRaisesRegex(ValueError, 'Exact resource container SHA'):
                binding.verify(self.source, self.notices, self.bundle, value)

    def test_growth_between_stat_and_open_is_rejected(self):
        original = Path.open
        def opening(path, *args, **kwargs):
            if path == self.bundle and args == ('rb',):
                with original(path, 'ab') as stream:
                    stream.write(b'late bytes')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'open', opening):
            with self.assertRaisesRegex(ValueError, 'changed before hashing'):
                binding.identity(self.bundle)

    def test_oversized_sparse_file_rejected_before_reading(self):
        with self.bundle.open('wb') as stream:
            stream.truncate(1024 ** 3 + 1)
        with self.assertRaisesRegex(ValueError, 'Bounded regular'):
            binding.identity(self.bundle)

    def test_wrong_container_hash(self):
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            self.verify('0' * 64)

    def test_valid_container_with_wrong_embedded_bytes(self):
        self.build(b'wrong font')
        with self.assertRaisesRegex(ValueError, 'differs from reviewed source'):
            self.verify()

    def test_wrong_resource_prefix(self):
        self.build(prefix='/other')
        with self.assertRaisesRegex(ValueError, 'Missing embedded resource'):
            self.verify()

    def test_missing_or_changed_notice(self):
        p = self.notices / 'LICENSE_LIBERATION'
        p.write_bytes(b'incorrect notice')
        with self.assertRaisesRegex(ValueError, 'notice bytes mismatch'):
            self.verify()

    def test_symlink_container(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.bundle)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.verify(bundle=alias)

    def test_container_changed_during_extraction(self):
        command = binding.bounded_command
        def changed(argv, limit):
            result = command(argv, limit)
            if 'extract' in argv:
                with self.bundle.open('ab') as stream:
                    stream.write(b'changed')
            return result
        with patch.object(binding, 'bounded_command', changed):
            with self.assertRaisesRegex(ValueError, 'changed during verification'):
                self.verify()

    def test_corrupt_resource_is_not_empty_success(self):
        self.bundle.write_bytes(b'not a resource')
        with self.assertRaises(ValueError):
            self.verify()


class BoundedProcess(unittest.TestCase):
    def test_output_budget(self):
        with self.assertRaisesRegex(ValueError, 'budget'):
            binding.bounded_command([sys.executable, '-c', 'import sys;sys.stdout.write("x"*1000000)'], 16)

    def test_stall_deadline(self):
        with self.assertRaisesRegex(ValueError, 'timed out'):
            binding.bounded_command([sys.executable, '-c', 'import time;time.sleep(10)'], 16, .1)

    def test_nonzero_exit(self):
        with self.assertRaisesRegex(ValueError, 'extraction failed'):
            binding.bounded_command([sys.executable, '-c', 'raise SystemExit(2)'], 16)


if __name__ == '__main__':
    unittest.main()

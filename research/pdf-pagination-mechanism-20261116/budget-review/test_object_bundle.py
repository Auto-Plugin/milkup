import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import object_bundle as m


class Bundle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.build = self.root / 'build'
        self.build.mkdir()
        self.destination = self.root / 'objects'
        self.identity = {k: m.digest(k.encode()) for k in m.IDENTITY_FIELDS}
        self.commands = [{'directory': str(self.build), 'arguments': ['clang++', '-c', 'test.cpp', '-o', 'test.o']}]
        data = bytearray(128)
        data[:6] = b'\x7fELF\x02\x01'
        data[16:18] = (1).to_bytes(2, 'little')
        (self.build / 'test.o').write_bytes(data)

    def capture(self):
        return m.capture(self.build, self.destination, self.identity, self.commands, ['test.o'])

    def test_bounded_completed_object_roundtrip_no_runtime_or_environment(self):
        (self.build / 'credentials.pem').write_text('test-only secret sentinel')
        (self.build / 'runtime.so').write_text('test-only runtime sentinel')
        with patch.dict('os.environ', {'SECRET_SENTINEL': 'not-to-be-recorded'}):
            self.capture()
        result = m.verify(self.destination, self.identity)
        self.assertFalse(result['restorationAuthorized'])
        self.assertEqual(len(list(self.destination.iterdir())), 2)
        self.assertNotIn('SENTINEL', (self.destination / 'receipt.json').read_text())

    def test_every_identity_input_changes_key_and_blocks_reuse(self):
        self.capture()
        for field in self.identity:
            changed = copy.copy(self.identity)
            changed[field] = '0' * 64
            self.assertNotEqual(m.key(changed), m.key(self.identity))
            with self.assertRaises(ValueError): m.verify(self.destination, changed)

    def test_unknown_identity_and_plain_env_rejected(self):
        for value in [{**self.identity, 'token': 'sentinel'}, {**self.identity, 'compiler': '/usr/bin/clang'}]:
            with self.assertRaises(ValueError): m.key(value)

    def test_symlink_and_traversal_rejected(self):
        (self.build / 'test.o').unlink()
        (self.build / 'test.o').symlink_to('/etc/hosts')
        with self.assertRaises(ValueError): self.capture()
        for name in ['../test.o', '/tmp/test.o', './test.o', 'runtime.so']:
            with self.assertRaises(ValueError): m.relative_object(name)

    def test_shared_library_renamed_object_rejected(self):
        data = bytearray((self.build / 'test.o').read_bytes())
        data[16:18] = (3).to_bytes(2, 'little')
        (self.build / 'test.o').write_bytes(data)
        with self.assertRaises(ValueError): self.capture()
        self.assertFalse(self.destination.exists())

    def test_budget_stops_without_complete_receipt(self):
        with patch.object(m, 'MAX_BYTES', 64), self.assertRaises(ValueError): self.capture()
        self.assertFalse(self.destination.exists())

    def test_truncated_and_extra_file_rejected(self):
        self.capture()
        extra = self.destination / 'key.pem'
        extra.write_text('sentinel')
        with self.assertRaises(ValueError): m.verify(self.destination, self.identity)
        extra.unlink()
        next(self.destination.glob('*.o')).write_bytes(b'truncated')
        with self.assertRaises(ValueError): m.verify(self.destination, self.identity)

    def test_unconfigured_or_duplicate_object_rejected(self):
        for selection in [[], ['unconfigured.o'], ['test.o', 'test.o']]:
            with self.assertRaises(ValueError): m.capture(self.build, self.destination, self.identity, self.commands, selection)


if __name__ == '__main__': unittest.main()

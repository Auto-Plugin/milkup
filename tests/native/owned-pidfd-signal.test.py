#!/usr/bin/env python3
"""Ownership counterexamples; opens pidfds but never sends any signal."""
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('guard', 'scripts/ci/owned-pidfd-signal.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class Ownership(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='milkup-owned-pidfd-')
        root = pathlib.Path(self.tmp.name).resolve()
        self.fixture = root/'synthetic.md'
        self.fixture.write_text('OWNED PIDFD TEST\n')
        exe = str(pathlib.Path(sys.executable).resolve())
        self.child = subprocess.Popen([exe, '-c', 'import sys;sys.stdin.read()', str(self.fixture)], stdin=subprocess.PIPE)
        observed = guard.identity(self.child.pid)
        self.request = {**observed, 'uid': os.getuid(), 'root': str(root), 'fixture': str(self.fixture)}

    def tearDown(self):
        # Normal EOF, not a signal, ends the only subprocess created by this test.
        self.child.stdin.close()
        self.child.wait(timeout=5)
        self.tmp.cleanup()

    def test_correct_identity_returns_live_pinned_descriptor_without_signalling(self):
        fd, observed = guard.open_verified(self.request)
        try:
            self.assertEqual(observed['birth'], self.request['birth'])
            self.assertIsNone(self.child.poll())
        finally:
            os.close(fd)

    def test_wrong_birth_owner_binary_and_hash_are_rejected(self):
        for key, value in [('birth', '0'), ('uid', os.getuid()+1), ('executable', '/not-the-owned-executable'), ('sha256', '0'*64)]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                guard.open_verified({**self.request, key: value})
            self.assertIsNone(self.child.poll())

    def test_another_file_and_out_of_root_are_rejected(self):
        other = self.fixture.parent/'other.md'
        other.write_text('OTHER OWNED FILE\n')
        for fixture in [str(other), '/etc/hosts']:
            with self.subTest(fixture=fixture), self.assertRaises(AssertionError):
                guard.open_verified({**self.request, 'fixture': fixture})
        self.assertIsNone(self.child.poll())

    def test_self_and_parent_are_rejected(self):
        for pid in [os.getpid(), os.getppid()]:
            with self.assertRaises(AssertionError):
                guard.open_verified({**self.request, 'pid': pid})

    def test_exited_pid_is_not_retargeted(self):
        self.child.stdin.close()
        self.child.wait(timeout=5)
        with self.assertRaises((ProcessLookupError, FileNotFoundError, AssertionError)):
            guard.open_verified(self.request)


if __name__ == '__main__':
    unittest.main()

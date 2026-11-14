"""Synthetic-only regressions; no network, account operations, or extraction."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile
import unittest
from unittest import mock
import warnings
import zipfile

import archive_integrity as target

NAME = "synthetic-dual-account-12345-1"
RUN = "12345"
SHA = "a" * 40
ALLOWED = {"pure-standard/report.json", "filtered-admin/ok.png"}


def archive(rows=None, *, directories=False, extras=False, force_zip64=False, descriptor=False):
    rows = rows if rows is not None else [("pure-standard/report.json", b'{"ok":true}')]

    class Unseekable(io.BytesIO):
        def seekable(self):
            return False
        def seek(self, *_):
            raise io.UnsupportedOperation("synthetic descriptor writer")

    stream = Unseekable() if descriptor else io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as writer:
            if extras:
                writer.comment = b"ordinary archive comment"
            if directories:
                writer.writestr("pure-standard/", b"")
            for name, body in rows:
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                if extras:
                    info.extra = struct.pack("<HH", 0xcafe, 3) + b"abc"
                    info.comment = b"ordinary member comment"
                with writer.open(info, "w", force_zip64=force_zip64) as output:
                    output.write(body)
    return stream.getvalue()


def api(data):
    return {"id": 7, "name": NAME, "expired": False,
            "expires_at": "2999-01-01T00:00:00Z", "size_in_bytes": len(data),
            "digest": "sha256:" + hashlib.sha256(data).hexdigest(),
            "workflow_run": {"id": int(RUN), "head_sha": SHA}}


def patch_header(data, *, local=None, central=None):
    data = bytearray(data)
    if local:
        for offset, fmt, value in local:
            struct.pack_into(fmt, data, offset, value)
    if central:
        start = data.index(b"PK\x01\x02")
        for offset, fmt, value in central:
            struct.pack_into(fmt, data, start + offset, value)
    return bytes(data)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="archive-integrity-synthetic-")
        self.root = Path(self.directory.name)
        self.api_path = self.root / "artifacts.json"
        self.zip_path = self.root / "artifact.zip"

    def tearDown(self):
        self.directory.cleanup()

    def check(self, data=None, metadata=None, **changes):
        data = archive() if data is None else data
        metadata = api(data) if metadata is None else metadata
        self.zip_path.write_bytes(data)
        self.api_path.write_bytes(metadata if isinstance(metadata, bytes)
                                  else json.dumps(metadata).encode())
        options = dict(expected_name=NAME, run_id=RUN, candidate=SHA,
                       allowed_names=ALLOWED, max_files=96, max_total_bytes=128 * 1024 * 1024,
                       max_file_bytes=lambda name: 32 * 1024 * 1024 if name.endswith(".png") else 2 * 1024 * 1024)
        options.update(changes)
        return target.verify_archive(self.api_path, self.zip_path, **options)

    def rejects(self, data=None, metadata=None, message=None, **changes):
        with self.assertRaisesRegex(target.ArchiveIntegrityError, message or ".+"):
            self.check(data, metadata, **changes)

    def test_valid_artifact_object(self):
        summary, files = self.check()
        self.assertTrue(summary["integrityVerified"])
        self.assertEqual(summary["acceptance"], "not-evaluated")
        self.assertEqual(files, {"pure-standard/report.json": b'{"ok":true}'})
        self.assertEqual(summary["fileCount"], 1)
        self.assertEqual(summary["files"][0]["sha256"], hashlib.sha256(b'{"ok":true}').hexdigest())

    def test_valid_wrapped_list_unique_selection(self):
        data = archive()
        other = dict(api(data), name="unrelated")
        self.check(data, {"total_count": 2, "artifacts": [other, api(data)]})

    def test_valid_raw_list(self):
        data = archive()
        self.check(data, [api(data)])

    def test_allow_missing_names_without_claiming_acceptance(self):
        summary, files = self.check()
        self.assertNotIn("filtered-admin/ok.png", files)
        self.assertEqual(summary["acceptance"], "not-evaluated")

    def test_valid_ancestor_directory_extra_and_comments(self):
        summary, _ = self.check(archive(directories=True, extras=True))
        self.assertEqual((summary["entryCount"], summary["fileCount"]), (2, 1))

    def test_valid_small_zip64(self):
        self.check(archive(force_zip64=True, extras=True))

    def test_valid_data_descriptor(self):
        self.check(archive(descriptor=True))

    def test_valid_descriptor_without_signature(self):
        data = bytearray(archive(descriptor=True))
        descriptor = data.index(b"PK\x07\x08")
        del data[descriptor:descriptor + 4]
        eocd = data.index(b"PK\x05\x06")
        offset, = struct.unpack_from("<I", data, eocd + 16)
        struct.pack_into("<I", data, eocd + 16, offset - 4)
        self.check(bytes(data))

    def test_unsigned_descriptor_crc_can_equal_optional_signature(self):
        body = bytes.fromhex("ac0a7ad5")
        self.assertEqual(zipfile.crc32(body), 0x08074b50)
        data = bytearray(archive([("pure-standard/report.json", body)], descriptor=True))
        descriptor = data.index(b"PK\x07\x08")
        del data[descriptor:descriptor + 4]
        eocd = data.index(b"PK\x05\x06")
        offset, = struct.unpack_from("<I", data, eocd + 16)
        struct.pack_into("<I", data, eocd + 16, offset - 4)
        self.check(bytes(data))

    def test_valid_stored_file(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as writer:
            writer.writestr("pure-standard/report.json", b"{}")
        self.check(stream.getvalue())

    def test_valid_zip64_data_descriptor(self):
        self.check(archive(descriptor=True, force_zip64=True, extras=True))

    def test_valid_unicode_name(self):
        self.check(archive([("reports/中文.json", b"{}")]), allowed_names={"reports/中文.json"})

    def test_invalid_json_duplicate_key(self):
        self.rejects(metadata=b'{"artifacts":[],"artifacts":[]}')

    def test_invalid_json_nonfinite_constants_and_overflow(self):
        for value in (b"NaN", b"Infinity", b"-Infinity", b"1e999"):
            with self.subTest(value=value), self.assertRaises(target.ArchiveIntegrityError):
                target.parse_json(value)

    def test_invalid_json_encoding(self):
        with self.assertRaises(target.ArchiveIntegrityError):
            target.parse_json(b'"\xff"')

    def test_missing_duplicate_and_incomplete_metadata_selection(self):
        data = archive()
        for value in ([dict(api(data), name="other")], [api(data), api(data)],
                      {"total_count": 2, "artifacts": [api(data)]},
                      {"total_count": True, "artifacts": [api(data)]}, [None, api(data)]):
            with self.subTest(value=value):
                self.rejects(data, value)

    def test_api_required_fields_not_filled_from_expectations(self):
        data = archive()
        for field in ("id", "name", "expired", "expires_at", "size_in_bytes", "digest", "workflow_run"):
            value = api(data)
            del value[field]
            with self.subTest(field=field):
                self.rejects(data, value)

    def test_expiry_type_and_timestamp(self):
        data = archive()
        for expired, expires in ((True, "2999-01-01T00:00:00Z"), (0, "2999-01-01T00:00:00Z"),
                                 (False, "2000-01-01T00:00:00Z"), (False, "2999-01-01T00:00:00"),
                                 (False, "2999-01-01T01:00:00+01:00"), (False, "2999-02-30T00:00:00Z")):
            with self.subTest(expired=expired, expires=expires):
                self.rejects(data, dict(api(data), expired=expired, expires_at=expires))

    def test_metadata_run_head_size_and_digest(self):
        data = archive()
        for change in ({"workflow_run": {"id": True, "head_sha": SHA}},
                       {"workflow_run": {"id": 12346, "head_sha": SHA}},
                       {"workflow_run": {"id": int(RUN), "head_sha": "b" * 40}},
                       {"size_in_bytes": True}, {"size_in_bytes": len(data) + 1},
                       {"digest": "sha256:" + "0" * 64}, {"digest": None}):
            with self.subTest(change=change):
                self.rejects(data, dict(api(data), **change))

    def test_expected_binding_arguments_are_explicit(self):
        for change in ({"run_id": None}, {"run_id": 12345}, {"run_id": "0012345"},
                       {"candidate": SHA[:8]}, {"candidate": SHA.upper()}, {"expected_name": ""}):
            with self.subTest(change=change):
                self.rejects(**change)

    def test_unknown_file(self):
        self.rejects(archive([("installer.exe", b"MZ")]))

    def test_unsafe_names(self):
        for name in ("/report.json", "C:/report.json", "a\\report.json", "../report.json", "a/../report.json",
                     "a//report.json", "./report.json", "report\n.json", "report\x7f.json"):
            with self.subTest(name=name):
                self.rejects(archive([(name, b"x")]))

    def test_raw_nul_not_hidden_by_zip_library(self):
        data = archive([("pure-standard/report.json", b"x")])
        data = data.replace(b"pure-standard/report.json", b"pure-standard/report\0json")
        self.rejects(data, message="control/NUL")

    def test_duplicate_and_case_collision(self):
        self.rejects(archive([("pure-standard/report.json", b"x"), ("pure-standard/report.json", b"y")]))
        self.rejects(archive([("pure-standard/report.json", b"x"), ("PURE-STANDARD/REPORT.JSON", b"y")]))

    def test_directory_names_are_closed(self):
        for name in ("unknown/", "/", "pure-standard//"):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as writer:
                writer.writestr(name, b"")
                writer.writestr("pure-standard/report.json", b"{}")
            with self.subTest(name=name):
                self.rejects(stream.getvalue())

    def test_nonempty_directory(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as writer:
            writer.writestr("pure-standard/", b"not a directory")
            writer.writestr("pure-standard/report.json", b"{}")
        self.rejects(stream.getvalue())

    def test_allowed_namespace_rejects_prefix_and_case_collision(self):
        for names in ({"a", "a/b"}, {"A/x", "a/y"}, {"a/"}, ["a", "a"]):
            with self.subTest(names=names):
                self.rejects(allowed_names=names)

    def test_symlink_special_and_reparse_members(self):
        for attributes in ((stat.S_IFLNK | 0o777) << 16, (stat.S_IFIFO | 0o600) << 16,
                           (stat.S_IFSOCK | 0o600) << 16, ((stat.S_IFREG | 0o600) << 16) | 0x400,
                           ((stat.S_IFREG | 0o600) << 16) | 0x08):
            with self.subTest(attributes=attributes):
                self.rejects(patch_header(archive(), central=[(38, "<I", attributes)]))

    def test_encrypted_members(self):
        for bit in (1, 0x40, 0x2000):
            with self.subTest(bit=bit):
                self.rejects(patch_header(archive(), local=[(6, "<H", bit)], central=[(8, "<H", bit)]))

    def test_per_file_budget_before_decode(self):
        with mock.patch.object(target, "_decode_member", side_effect=AssertionError("decode must not run")):
            self.rejects(archive([("pure-standard/report.json", b"x" * 1024)]), max_file_bytes=10)

    def test_aggregate_and_count_budgets_before_decode(self):
        data = archive([("pure-standard/report.json", b"x" * 8), ("filtered-admin/ok.png", b"y" * 8)])
        with mock.patch.object(target, "_decode_member", side_effect=AssertionError("decode must not run")):
            self.rejects(data, max_total_bytes=10)
            self.rejects(data, max_files=1)

    def test_bad_callback_limit(self):
        for value in (True, -1, None, "32"):
            with self.subTest(value=value):
                self.rejects(max_file_bytes=lambda _: value)

    def test_declared_size_understatement(self):
        data = patch_header(archive([("pure-standard/report.json", b"xxxxx")]),
                            local=[(22, "<I", 1), (14, "<I", zipfile.crc32(b"x"))],
                            central=[(24, "<I", 1), (16, "<I", zipfile.crc32(b"x"))])
        self.rejects(data, message="decoded beyond declared size")

    def test_crc_mismatch(self):
        self.rejects(patch_header(archive(), local=[(14, "<I", 1)], central=[(16, "<I", 1)]), message="CRC mismatch")

    def test_local_central_name_mismatch(self):
        data = bytearray(archive())
        data[30] = ord("X")
        self.rejects(bytes(data), message="raw name mismatch")

    def test_local_central_flags_or_method_mismatch(self):
        self.rejects(patch_header(archive(), local=[(8, "<H", 0)]), message="header mismatch")
        self.rejects(patch_header(archive(), local=[(6, "<H", 8)]), message="header mismatch")

    def test_truncated_zip_and_trailing_bytes(self):
        data = archive()
        self.rejects(data[:-1])
        self.rejects(data + b"undeclared tail")

    def test_input_files_unchanged(self):
        self.check()
        before = (self.api_path.read_bytes(), self.zip_path.read_bytes())
        target.verify_archive(self.api_path, self.zip_path, expected_name=NAME, run_id=RUN, candidate=SHA,
                              allowed_names=ALLOWED, max_files=96, max_total_bytes=128 * 1024 * 1024, max_file_bytes=2 * 1024 * 1024)
        self.assertEqual(before, (self.api_path.read_bytes(), self.zip_path.read_bytes()))

    def test_input_symlink_and_symlink_ancestor(self):
        real = self.root / "real.json"
        real.write_bytes(b"{}")
        link = self.root / "link.json"
        link.symlink_to(real)
        with self.assertRaises(target.ArchiveIntegrityError):
            target._read_regular(link, 100, "metadata")
        folder = self.root / "folder"
        folder.mkdir()
        (folder / "data").write_bytes(b"x")
        directory_link = self.root / "directory-link"
        directory_link.symlink_to(folder, target_is_directory=True)
        with self.assertRaises(target.ArchiveIntegrityError):
            target._read_regular(directory_link / "data", 100, "ZIP")
        with self.assertRaises(target.ArchiveIntegrityError):
            target._read_regular(directory_link / ".." / "real.json", 100, "ZIP")

    def test_nonregular_input(self):
        with self.assertRaises(target.ArchiveIntegrityError):
            target._read_regular(self.root, 100, "ZIP")
        pipe = self.root / "pipe"
        os.mkfifo(pipe)
        with self.assertRaises(target.ArchiveIntegrityError):
            target._read_regular(pipe, 100, "ZIP")

    def test_oversized_input_refused_before_read(self):
        huge = self.root / "oversized.zip"
        with huge.open("wb") as output:
            output.truncate(target.MAX_ZIP_BYTES + 1)
        with self.assertRaises(target.ArchiveIntegrityError):
            target._read_regular(huge, target.MAX_ZIP_BYTES, "ZIP")


class RecordingResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.records.append({"name": test.id(), "passed": True})

    def addFailure(self, test, error):
        super().addFailure(test, error)
        self.records.append({"name": test.id(), "passed": False, "kind": "failure"})

    def addError(self, test, error):
        super().addError(test, error)
        self.records.append({"name": test.id(), "passed": False, "kind": "error"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    options = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ArchiveTests)
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordingResult).run(suite)
    record = {"status": "passed" if result.wasSuccessful() else "failed", "syntheticOnly": True,
              "networkUsed": False, "windowsExecuted": False, "archivesExtracted": False,
              "testsRun": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
              "moduleSha256": hashlib.sha256(Path(target.__file__).read_bytes()).hexdigest(),
              "testSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "cases": result.records}
    encoded = json.dumps(record, indent=2) + "\n"
    if options.output:
        options.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    sys.exit(0 if result.wasSuccessful() else 1)

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "notice_gate", Path(__file__).with_name("webkit-pdfjs-notices.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class NoticeGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source, self.notices, self.output = (root / n for n in ("source", "notices", "output"))
        (self.source / "web").mkdir(parents=True)
        self.notices.mkdir()
        (self.source / "web/font.ttf").write_bytes(b"synthetic font")
        (self.notices / "LICENSE").write_bytes(b"synthetic notice")
        self.asset_patch = patch.dict(gate.ASSETS, {"web/font.ttf": gate.digest(b"synthetic font")}, clear=True)
        self.notice_patch = patch.dict(gate.NOTICES, {"LICENSE": gate.digest(b"synthetic notice")}, clear=True)
        self.asset_patch.start()
        self.notice_patch.start()
        self.addCleanup(self.asset_patch.stop)
        self.addCleanup(self.notice_patch.stop)

    def prepare(self):
        return gate.prepare(self.source, self.output, self.notices)

    def verify(self):
        return gate.verify(self.source, self.output, self.notices)

    def test_exact_limited_payload_roundtrip(self):
        result = self.prepare()
        self.assertEqual(result, self.verify())
        for key in ("completeSbom", "runtimeIdentityVerified", "installedPayloadVerified", "legalApproval"):
            self.assertIs(result[key], False)

    def test_changed_resource_rejected_before_writing(self):
        (self.source / "web/font.ttf").write_bytes(b"different version")
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_wrong_notice_rejected_before_writing(self):
        (self.notices / "LICENSE").write_bytes(b"old mismatched license")
        with self.assertRaisesRegex(ValueError, "Notice identity"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_resource_symlink_rejected(self):
        p = self.source / "web/font.ttf"
        p.rename(p.with_name("original"))
        p.symlink_to("original")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.prepare()

    def test_notice_symlink_rejected(self):
        p = self.notices / "LICENSE"
        p.rename(p.with_name("original"))
        p.symlink_to("original")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.prepare()

    def test_missing_notice_rejected(self):
        self.prepare()
        (self.output / "LICENSE").unlink()
        with self.assertRaisesRegex(ValueError, "Extra or missing"):
            self.verify()

    def test_truncated_notice_rejected(self):
        self.prepare()
        (self.output / "LICENSE").write_bytes(b"synthetic")
        with self.assertRaisesRegex(ValueError, "Prepared notice"):
            self.verify()

    def test_extra_payload_rejected(self):
        self.prepare()
        (self.output / "unexpected.js").write_bytes(b"extra")
        with self.assertRaisesRegex(ValueError, "Extra or missing"):
            self.verify()

    def test_cannot_turn_limited_receipt_into_package_approval(self):
        self.prepare()
        p = self.output / "manifest.json"
        data = json.loads(p.read_text())
        data["completeSbom"] = True
        p.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "unsupported approval"):
            self.verify()

    def test_resources_rechecked_after_payload_created(self):
        self.prepare()
        (self.source / "web/font.ttf").write_bytes(b"changed after collection")
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            self.verify()

    def test_existing_output_not_overwritten(self):
        self.output.mkdir()
        original = self.output / "keep"
        original.write_bytes(b"original evidence")
        with self.assertRaises(FileExistsError):
            self.prepare()
        self.assertEqual(original.read_bytes(), b"original evidence")

    def test_oversized_resource_rejected(self):
        (self.source / "web/font.ttf").write_bytes(b"x" * (256 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, "Bounded"):
            self.prepare()


if __name__ == "__main__":
    unittest.main()

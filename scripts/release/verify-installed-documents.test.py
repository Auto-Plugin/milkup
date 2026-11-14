import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from pypdf import PdfWriter
from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject

spec = importlib.util.spec_from_file_location("audit", pathlib.Path(__file__).with_name("verify-installed-documents.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.report = {"status": "passed-ui-await-native-exit-and-pdf-audit", "files": {}, "exports": [], "checkpoints": [{}] * 10,
                       "nativeDialogs": [{"status": "passed", "input": {"accepted": True, "nativeSendInput": True, "filenameReadbackExact": True, "privateInvokeUsed": False}}] * 6,
                       "close": {"cancelPreservedDisk": True, "cancelPreservedBuffer": True, "saveRequested": True, "discardOnSwitchPreservedDisk": True}}
        self.install = {"status": "passed", "sourceSha": "a" * 40, "forcedCleanup": False, "phases": [
            {"name": "repair-normal-close", "detail": {"exitCode": 0}},
            {"name": "document-health-await-normal-close", "detail": {"closeRequestedByRealUi": True}}]}
        self.supervisor = {"status": "passed", "sourceSha": "a" * 40, "harnessSha": "b" * 40, "supervisor": {"accountKindVerified": True, "expectedAccountKind": "pure-standard", "exitCode": 0}}
        for name, text in [("unchanged-document.md", "ALPHA-CLOSE-SAVED\n"), ("identity-bravo.md", "BRAVO-EDIT-SAVED\n")]:
            data = text.encode(); (self.root / name).write_bytes(data)
            self.report["files"][name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for stem, marker, other in [("alpha", "MILKUP_IDENTITY_ALPHA_7E36", "MILKUP_IDENTITY_BRAVO_9C42"), ("bravo", "MILKUP_IDENTITY_BRAVO_9C42", "MILKUP_IDENTITY_ALPHA_7E36")]:
            for fmt in ["html", "pdf"]:
                p = self.root / (stem + "." + fmt)
                if fmt == "html":
                    p.write_text("<!doctype html><html><body><h1>Current document</h1><p>" + marker + "</p><p>Bounded output identity fixture.</p></body></html>")
                else:
                    writer = PdfWriter(); page = writer.add_blank_page(612, 792)
                    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
                    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
                    stream = DecodedStreamObject(); stream.set_data(f"BT /F1 12 Tf 40 720 Td ({marker}) Tj ET".encode())
                    page[NameObject("/Contents")] = writer._add_object(stream)
                    writer.write(p)
                data = p.read_bytes()
                self.report["exports"].append({"file": p.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "expectedMarker": marker, "excludedMarker": other})

    def run_audit(self):
        for name, data in [("installed-document-health.json", self.report), ("installation.json", self.install), ("standard-repair-supervisor.json", self.supervisor)]:
            (self.root / name).write_text(json.dumps(data))
        return audit.verify(self.root)

    def test_complete_content_and_close_proof(self):
        self.assertEqual(self.run_audit()["status"], "passed")

    def test_wrong_document_pdf_even_with_rehashed_bytes(self):
        data = (self.root / "bravo.pdf").read_bytes(); (self.root / "alpha.pdf").write_bytes(data)
        e = next(e for e in self.report["exports"] if e["file"] == "alpha.pdf")
        e.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        with self.assertRaisesRegex(AssertionError, "wrong document"):
            self.run_audit()

    def test_missing_output_or_truncated_bytes(self):
        (self.root / "alpha.pdf").write_bytes(b"%PDF-")
        with self.assertRaises(AssertionError): self.run_audit()

    def test_forced_cleanup_cannot_substitute_for_ui_close(self):
        self.install["forcedCleanup"] = True
        with self.assertRaises(AssertionError): self.run_audit()

    def test_cancel_did_not_preserve_buffer(self):
        self.report["close"]["cancelPreservedBuffer"] = False
        with self.assertRaises(AssertionError): self.run_audit()

    def test_cross_file_overwrite(self):
        (self.root / "identity-bravo.md").write_bytes((self.root / "unchanged-document.md").read_bytes())
        with self.assertRaises(AssertionError): self.run_audit()


unittest.main()

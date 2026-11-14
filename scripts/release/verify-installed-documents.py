"""Independent bounded output-content audit; no product/private IPC calls."""
import hashlib
import json
import pathlib
import sys
from html.parser import HTMLParser
from pypdf import PdfReader


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, value):
        self.parts.append(value)


def read_json(root, name):
    p = root / name
    assert p.stat().st_size <= 2 * 1024 * 1024, "Bounded JSON required"
    return json.loads(p.read_text(encoding="utf-8-sig"))


def verify(root):
    r = read_json(root, "installed-document-health.json")
    installation = read_json(root, "installation.json")
    supervisor = read_json(root, "standard-repair-supervisor.json")
    assert installation["status"] == supervisor["status"] == "passed"
    assert supervisor["sourceSha"] == installation["sourceSha"]
    assert supervisor["supervisor"]["accountKindVerified"]
    assert supervisor["supervisor"]["expectedAccountKind"] == "pure-standard"
    assert supervisor["supervisor"]["exitCode"] == 0
    assert not installation["forcedCleanup"]
    phases = {p["name"]: p["detail"] for p in installation["phases"]}
    assert phases["repair-normal-close"]["exitCode"] == 0
    assert phases["document-health-await-normal-close"]["closeRequestedByRealUi"]
    assert r["status"] == "passed-ui-await-native-exit-and-pdf-audit"
    assert all(r["close"][k] for k in ["cancelPreservedDisk", "cancelPreservedBuffer", "saveRequested", "discardOnSwitchPreservedDisk"])
    assert len(r["nativeDialogs"]) == 6 and len(r["checkpoints"]) >= 10
    for proof in r["nativeDialogs"]:
        assert proof["status"] == "passed"
        assert proof["input"]["accepted"] and proof["input"]["nativeSendInput"]
        assert proof["input"]["filenameReadbackExact"] and not proof["input"]["privateInvokeUsed"]
    assert set(r["files"]) == {"unchanged-document.md", "identity-bravo.md"}
    for name, proof in r["files"].items():
        raw = (root / name).read_bytes()
        assert len(raw) == proof["bytes"] <= 1024 * 1024
        assert hashlib.sha256(raw).hexdigest() == proof["sha256"]
    assert (root / "unchanged-document.md").read_text().endswith("ALPHA-CLOSE-SAVED\n")
    assert (root / "identity-bravo.md").read_text().endswith("BRAVO-EDIT-SAVED\n")
    assert "BRAVO-DISCARD-ONLY" not in (root / "identity-bravo.md").read_text()
    expected = {"alpha.html", "alpha.pdf", "bravo.html", "bravo.pdf"}
    assert len(r["exports"]) == 4 and {e["file"] for e in r["exports"]} == expected
    results = []
    for e in r["exports"]:
        p = root / e["file"]
        raw = p.read_bytes()
        assert 100 < len(raw) == e["bytes"] <= 8 * 1024 * 1024
        assert hashlib.sha256(raw).hexdigest() == e["sha256"], "Original output hash mismatch"
        if p.suffix == ".pdf":
            pdf = PdfReader(p, strict=True)
            assert not pdf.is_encrypted and 0 < len(pdf.pages) <= 20
            text = "\n".join(page.extract_text() for page in pdf.pages)
        else:
            parser = Text()
            parser.feed(raw.decode("utf-8"))
            text = "\n".join(parser.parts)
        marker = "MILKUP_IDENTITY_ALPHA_7E36" if p.stem == "alpha" else "MILKUP_IDENTITY_BRAVO_9C42"
        other = "MILKUP_IDENTITY_BRAVO_9C42" if p.stem == "alpha" else "MILKUP_IDENTITY_ALPHA_7E36"
        assert e["expectedMarker"] == marker and e["excludedMarker"] == other
        assert marker in text and other not in text, "Export selected the wrong document"
        results.append({"file": e["file"], "sha256": e["sha256"], "markerPresent": True, "otherDocumentAbsent": True})
    return {"status": "passed", "sourceSha": installation["sourceSha"], "harnessSha": supervisor["harnessSha"], "outputs": results, "boundary": "Installed current-document ASCII identity markers; not full PDF visual/Unicode fidelity"}


if __name__ == "__main__":
    root = pathlib.Path(sys.argv[1])
    result = {"status": "failed"}
    try:
        result = verify(root)
    except Exception as exc:
        result["error"] = repr(exc)
        raise
    finally:
        root.mkdir(parents=True, exist_ok=True)
        (root / "installed-document-content-audit.json").write_text(json.dumps(result, indent=2))

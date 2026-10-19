"""Verify the original bytes of the P5 production evidence bundle."""

import hashlib
import json
from pathlib import Path


root = Path(__file__).resolve().parent
index = json.loads((root / "index.json").read_text())
for entry in index["files"]:
    path = (root / entry["path"]).resolve()
    assert path.is_relative_to(root), entry["path"]
    data = path.read_bytes()
    assert len(data) == entry["bytes"], entry["path"]
    assert hashlib.sha256(data).hexdigest() == entry["sha256"], entry["path"]
    if path.suffix == ".json":
        json.loads(data)
    if path.suffix == ".pdf":
        assert data.startswith(b"%PDF-"), entry["path"]
        assert b"%%EOF" in data[-1024:], entry["path"]
    if path.suffix == ".html":
        assert data.lower().startswith(b"<!doctype html>"), entry["path"]

assert index["pdfTextFidelity"] == "failed-known-limitation"
print(f"Verified {len(index['files'])} original evidence files")

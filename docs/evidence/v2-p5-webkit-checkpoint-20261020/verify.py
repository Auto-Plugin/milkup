"""Verify the immutable P5 diagnostic archive using only the Python standard library."""

from pathlib import Path, PurePosixPath
import hashlib
import json
import zipfile

root = Path(__file__).parent
manifest = json.loads((root / "manifest.json").read_text())
archive = root / manifest["archive"]
assert archive.stat().st_size == manifest["bytes"]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest["sha256"]
entries = {entry["path"]: entry for entry in manifest["files"]}
assert len(entries) == len(manifest["files"])
with zipfile.ZipFile(archive) as bundle:
    assert len(bundle.namelist()) == len(entries)
    assert set(bundle.namelist()) == set(entries)
    for name, entry in entries.items():
        assert not PurePosixPath(name).is_absolute()
        assert ".." not in PurePosixPath(name).parts
        data = bundle.read(name)
        assert len(data) == entry["bytes"], name
        assert hashlib.sha256(data).hexdigest() == entry["sha256"], name
        if (root / name).is_file():
            assert (root / name).read_bytes() == data, name
    provenance = json.loads(bundle.read("provenance.json"))
    build = json.loads(bundle.read("baseline-build-proof.json"))
    assert provenance["sourceHead"] == build["sourceHead"]
    assert provenance["sourceHead"] == "cf7d407dbb9416232d4f2163e8cebf9d49798c57"
    assert provenance["binarySha256"] == build["artifact"]["sha256"]
    assert build["exitCode"] == 0 and build["inputDrift"] == []
    assert provenance["guardBytesFoundInExactBaselineELF"] is True
    gate = json.loads(bundle.read("quality-gate.json"))
    run = json.loads(bundle.read("quality-gate-run.json"))
    assert gate["passed"] is False
    assert len(gate["failures"]) == 8 and gate["positiveControlPassed"] is True
    assert run["exitCode"] == 1
    assert json.loads(bundle.read("xvfb-133-cleanup.json"))["ownedProcessExited"] is True
    for item in json.loads(bundle.read("execution-minimal,serialized.json")):
        assert item["guardianExit"] == 0
        data = bundle.read(item["variant"] + ".pdf")
        assert hashlib.sha256(data).hexdigest() == item["sha256"]
        assert data.startswith(b"%PDF-") and b"%%EOF" in data[-2048:]

print(f"PASS: {len(entries)} members and baseline provenance verified; PDF quality remains FAIL.")

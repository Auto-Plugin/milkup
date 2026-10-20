"""Verify raw checkpoint evidence; do not turn a failed performance gate into PASS."""

from pathlib import Path, PurePosixPath
import hashlib
import json
import zipfile

root = Path(__file__).parent
digest = lambda data: hashlib.sha256(data).hexdigest()
manifest = json.loads((root / "manifest.json").read_text())
archive = root / manifest["archive"]
assert archive.stat().st_size == manifest["bytes"]
assert digest(archive.read_bytes()) == manifest["sha256"]
entries = {entry["path"]: entry for entry in manifest["files"]}
assert len(entries) == len(manifest["files"]) == 251
with zipfile.ZipFile(archive) as bundle:
    assert len(bundle.namelist()) == len(entries)
    assert set(bundle.namelist()) == set(entries)
    for name, entry in entries.items():
        assert not PurePosixPath(name).is_absolute()
        assert ".." not in PurePosixPath(name).parts
        data = bundle.read(name)
        assert len(data) == entry["bytes"] and digest(data) == entry["sha256"], name
        assert not data.startswith(b"\x7fELF") and not name.endswith(".milkup-plugin")
        if (root / name).is_file():
            visible = (root / name).read_bytes()
            if name in ("review.json", "quality-gate-run.json"):
                assert json.loads(visible) == json.loads(data), name
            else:
                assert visible == data, name
    read_json = lambda name: json.loads(bundle.read(name))
    build = read_json("preparation/baseline-build-proof.json")
    assert build["sourceHead"] == "cf7d407dbb9416232d4f2163e8cebf9d49798c57"
    assert build["exitCode"] == 0 and build["inputDrift"] == []
    assert read_json("preparation/bundle-restore.json")["all11MatchCf7"]
    assert read_json("preparation/performance-source-after.json")["inputDrift"] == []
    review = read_json("review.json")
    assert review["coldReadinessPassed"] and review["functionalPassed"]
    assert not review["performancePassed"]
    samples_count = timed_count = history_count = failed_searches = violations = 0
    for run in review["runs"]:
        prefix = "native/" + run["run"] + "/"
        data = read_json(prefix + "samples.json")
        original = bundle.read(prefix + "original.md")
        assert data["complete"] and digest(original) == data["metadata"]["sha256"]
        timed = [s for s in data["samples"] if "frameMs" in s]
        assert all(s["trusted"] for s in timed)
        searches = [s for s in timed if s["kind"] == "search"]
        assert len(searches) == 1
        assert searches[0]["targetMs"] == 500 and searches[0]["cursor"] == 1
        failed_searches += searches[0]["frameMs"] > 500
        violations += len(data["violations"])
        changed = "中e\u0301👩🏽‍💻".encode() + original[1:]
        history = read_json(prefix + "history.json")
        assert [h["label"] for h in history] == [
            "replace-selection", "undo", "redo", "restore-original"
        ]
        assert [h["sha256"] for h in history] == [
            digest(changed), digest(original), digest(changed), digest(original)
        ]
        assert all(
            not h["state"]["dirty"]
            and not h["state"]["saving"]
            and h["state"]["version"] == h["state"]["savedVersion"]
            for h in history
        )
        samples_count += len(data["samples"])
        timed_count += len(timed)
        history_count += len(history)
    assert (samples_count, timed_count, history_count, failed_searches, violations) == (
        858, 726, 24, 5, 11
    )
    assert read_json("quality-gate-run.json")["exitCode"] == 1
    assert all(
        not row["executing"]
        for row in read_json("preparation/driver-final-check.json")
    )

print("PASS: 251 members, 858 samples and 24 saved history states verified.")
print("Performance remains FAIL: 5/6 first searches exceed the unchanged 500 ms budget.")

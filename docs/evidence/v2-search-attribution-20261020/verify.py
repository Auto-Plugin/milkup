"""Offline integrity check; --performance exits 1 while the original budget is open."""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text())
archive = root / manifest["archive"]
digest = lambda data: hashlib.sha256(data).hexdigest()
assert archive.stat().st_size == manifest["archiveBytes"]
assert digest(archive.read_bytes()) == manifest["archiveSha256"]
with zipfile.ZipFile(archive) as z:
    expected = {row["path"]: row for row in manifest["members"]}
    assert set(z.namelist()) == set(expected)
    for name, row in expected.items():
        data = z.read(name)
        assert len(data) == row["bytes"] and digest(data) == row["sha256"], name
        assert not data.startswith(b"\x7fELF"), name

    def read(name):
        return json.loads(z.read(name))

    proof = read("candidate-diagnostic01/proof.json")
    assert proof["sourceHead"] == "67cab4650973e4fba3fd26950b6b68ae5d09dc11"
    assert proof["exitCode"] == 0 and not proof["inputDrift"]
    assert proof["baselineUnchanged"] and proof["protectedM01ArtifactsUnchanged"]
    assert proof["artifact"]["sha256"] == (
        "c8f11431358c3e829fa8efe323a95d15634205b2aa3fd1bc1250b8544e53169b"
    )
    assert read("preparation/build-source-verification.json")["all11BundledArchivesUnchanged"]
    assert read("preparation/final-product-tree.json")["productionChanges"] == []
    assert read("preparation/github-identity.json") == {"id": 40397402, "login": "LarryZhu-dev"}
    for row in read("preparation/diagnostic-source.json"):
        assert digest(z.read("diagnostic-source/" + row["path"])) == row["sha256"]
        if row["path"] in proof["inputs"]:
            assert proof["inputs"][row["path"]]["sha256"] == row["sha256"]
    reference = read("preparation/baseline-reference.json")
    assert len(reference["rows"]) == 6
    assert sum(r["overTarget"] for r in reference["rows"]) == 5
    assert reference["samples"] == 858 and reference["timedSamples"] == 726
    original_hash = "4260c361024f7d9f0c32e9e5d2abffcbaf3a03efcdd7e553a69f0d5413c16806"
    changed_hash = "00cf94802a87feb7ac2382af4e9650da6e5a12b949b65a18208c7ed41336b9b5"
    count = timed = misses = histories = 0
    attribution = read("attribution.json")
    for mode, expected_ms in [("source", 491), ("live", 595)]:
        prefix = "native/search-attribution-" + mode + "-01/"
        samples = read(prefix + "samples.json")
        assert samples["complete"]
        assert samples["metadata"]["sha256"] == original_hash
        assert digest(z.read(prefix + "original.md")) == original_hash
        assert samples["metadata"]["bytes"] == 10485779
        assert samples["metadata"]["cycles"] == 20
        search = next(s for s in samples["samples"] if s["kind"] == "search")
        assert search["trusted"] and search["query"] == "A" and search["count"] == "1/1"
        assert search["cursor"] == 1 and search["version"] == 40 and search["targetMs"] == 500
        assert search["frameMs"] == expected_ms
        assert search["frameMs"] == search["twoFrames"] - search["started"]
        assert search["overTarget"] == (search["frameMs"] > 500)
        count += len(samples["samples"])
        timed += sum("frameMs" in s for s in samples["samples"])
        misses += sum(bool(s.get("overTarget")) for s in samples["samples"])
        trace = read(prefix + "search-stages.json")
        assert 0 < len(trace["marks"]) < 256 and trace["timerGapsDropped"] == 0
        assert trace["visible"] == "visible" and trace["focused"]
        stages = [m["detail"]["stage"] for m in trace["marks"]]
        assert stages.count("step-end") == 11 and stages.count("worker-complete") == 1
        assert "run-end" in stages and "trace-limit" not in stages
        row = next(r for r in attribution["rows"] if r["mode"] == mode)
        first_start = next(m["at"] for m in trace["marks"] if m["detail"]["stage"] == "step-start")
        first_end = next(m for m in trace["marks"] if m["detail"]["stage"] == "step-end")
        assert row["durationsMs"]["firstStepRoundTrip"] == first_end["at"] - first_start
        assert row["durationsMs"]["firstStepNative"] == first_end["detail"]["nativeMs"]
        history = read(prefix + "history.json")
        assert [h["sha256"] for h in history] == [
            changed_hash, original_hash, changed_hash, original_hash,
        ]
        histories += len(history)
    assert (count, timed, misses, histories) == (286, 242, 1, 8)
    functional = read("native/search-attribution-functional-02/results.json")
    assert len(functional) == 12 and all(r["status"] == "PASS" for r in functional)
    for mode in ["source", "live"]:
        result = read("native/search-attribution-functional-02/" + mode + "-document-switch.json")
        assert result["trace"]["dropped"] == 0 and result["atSwitch"]["trusted"]
        stages = [
            m["detail"]["stage"] for m in result["trace"]["marks"]
            if m["detail"]["run"] == result["beforeSwitch"]["run"]
        ]
        assert "controller-start" in stages and "controller-cancel" in stages
        assert "controller-complete" not in stages and "append-start" in stages
        state = result["after"]
        assert not state["dirty"] and not state["searching"]
        assert state["cursor"] == 0 and state["count"] == "0/0"
    for run, exit_code in [
        ("source-01", 0), ("live-01", 0), ("functional-01", 1), ("functional-02", 0),
    ]:
        prefix = "control/search-attribution-" + run
        assert read(prefix + "-execution.json")["exitCode"] == exit_code
        assert read(prefix + "-driver.json")["stoppedUtc"]
    assert read("control/xvfb.json")["finalState"] in ["absent", "Z"]
    for check in ["test", "typecheck", "build", "lint"]:
        assert z.read("checks/" + check + "-full.exit").strip() == b"0"
    assert read("checks/final-frontend-no-diagnostics.json")["diagnosticStageNameAbsent"]
    for shot in read("pixel-review.json")["reviewed"]:
        assert digest(z.read(shot["path"])) == shot["sha256"]

print("Evidence integrity PASS: 286 samples, 242 trusted timings, 8 history states, 12 native checks.")
print("Original 500 ms search budget OPEN: diagnostic Source 491 ms; Live 595 ms FAIL; no fix.")
if "--performance" in sys.argv:
    sys.exit(1)

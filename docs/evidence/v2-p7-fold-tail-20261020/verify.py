#!/usr/bin/env python3
"""Verify retained successes and failures; this is not a performance pass gate."""
from pathlib import Path
import hashlib
import json
import math
import re
import zipfile

root = Path(__file__).resolve().parent
index = json.loads((root / "index.json").read_text())
archive = root / index["archive"]
assert archive.stat().st_size == index["archiveBytes"]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == index["archiveSha256"]
source_sha = "8f1645cd72522c10de6714b9918d6f0dc5baee38"
fixture_sha = "997d1c7361e2a53082a935070c6f4f38b9668235744fdde5b16b8257c7d2d757"
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(set(bundle.namelist()))
    assert set(bundle.namelist()) == {row["path"] for row in index["members"]}
    for row in index["members"]:
        path = Path(row["path"])
        assert not path.is_absolute() and ".." not in path.parts
        assert path.suffix.lower() not in {
            ".exe", ".dll", ".msi", ".msix", ".deb", ".tgz", ".milkup-plugin",
        }
        data = bundle.read(row["path"])
        assert not data.startswith(b"\x7fELF")
        assert len(data) == row["bytes"]
        assert hashlib.sha256(data).hexdigest() == row["sha256"]

    def load(name):
        return json.loads(bundle.read(name))

    source = load("source-manifest.json")
    assert source["source"] == source_sha
    assert source["baseline"] == "cf7d407dbb9416232d4f2163e8cebf9d49798c57"
    for row in source["files"]:
        data = bundle.read("source/" + row["path"])
        assert hashlib.sha256(data).hexdigest() == row["sha256"]
        assert hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest() == row["gitBlob"]
    remote = load("source-remote.json")
    assert remote["sha"] == source_sha
    for role in ["author", "committer"]:
        assert remote[role] == {"id": 40397402, "login": "LarryZhu-dev"}
        assert remote["commit"][role]["name"] == "LarryZhu-dev"
        assert remote["commit"][role]["email"] == "larryzhu@foxmail.com"
    assert bundle.read("regression/read-rounds-red.exit").strip() == b"1"
    assert b"expected 8 to be less than or equal to 5" in bundle.read("regression/read-rounds-red.log")
    assert bundle.read("regression/outline-green02.exit").strip() == b"0"
    assert b"42 passed" in bundle.read("regression/outline-green02.log")
    for name in ["workspace-tests01", "typecheck01", "build01", "versions01",
                 "browser-outline01", "lint-full02"]:
        assert bundle.read(f"checks/{name}.exit").strip() == b"0"
    assert bundle.read("checks/lint-full01.exit").strip() == b"1"
    counts = re.findall(rb"Tests\s+(\d+) passed", bundle.read("checks/workspace-tests01.log"))
    assert sum(int(n) for n in counts) == 2565
    validation = load("validation.json")
    assert all(not files for files in validation["unchangedSourcePaths"].values())
    assert validation["publicAPIChanged"] is False and validation["hostChanged"] is False
    assert b"15 passed" in bundle.read("checks/browser-outline01.log")
    external = load("external-1.3.4/verification.json")
    assert external["status"] == "passed"
    assert external["version"] == "1.3.4" and external["sdkVersion"] == "0.3.7"
    assert external["runtimeImports"] == 0 and external["trustedRebuildMatches"]
    assert external["copiedSourcesUnchanged"]
    assert external["archiveSha256"] == "ff6c1304ad3dd3c3b701a7232d69bb96d55962b9191a6e1a3162ee2aff2b2235"
    for candidate in ["candidate-baseline02", "candidate-fix01"]:
        proof = load(f"{candidate}/proof.json")
        assert proof["exitCode"] == 0 and not proof["inputDrift"]
        assert proof["baselineUnchanged"] and proof["protectedM01ArtifactsUnchanged"]
    results = load("all-production-results.json")
    assert len(results["runs"]) == 10
    assert results["candidateStable250msProven"] is False
    assert results["candidateAllWarmBudgetsProven"] is False
    assert results["crossoverSequence"] == ["baseline-04", "fix-04", "fix-05", "baseline-05"]
    for row in results["runs"]:
        prefix = "native/p7-tail-" + row["run"] + "/"
        completion = load(prefix + "completion.json")
        samples = load(prefix + "measurements.json")
        assert completion["passed"] and len(samples) == 106
        assert completion["sourceSha256"] == completion["finalSourceSha256"] == fixture_sha
        assert hashlib.sha256(bundle.read(prefix + "outline.md")).hexdigest() == fixture_sha
        assert hashlib.sha256(bundle.read(prefix + "harness.mjs")).hexdigest() == "b8ccb4322a8068496ffac252245150f7bb3811a1258f90e6773ac61f29534258"
        assert all(s["status"] == "observed" for s in samples)
        for op, budget in results["budgets"].items():
            values = [s["elapsedMs"] for s in samples
                      if s["name"].startswith(op + "-") and s["name"][len(op) + 1:].isdigit()]
            assert len(values) == 20
            stats = row["operations"][op]
            assert stats["samples"] == values
            p95 = sorted(values)[math.ceil(len(values) * .95) - 1]
            assert stats["p95"] == p95 and stats["max"] == max(values)
            assert stats["p95BudgetPassed"] == (p95 <= budget)
            assert stats["overBudget"] == sum(v > budget for v in values)
    assert next(r for r in results["runs"] if r["run"] == "baseline-03")["operations"]["collapse"]["p95"] == 254
    assert next(r for r in results["runs"] if r["run"] == "fix-03")["operations"]["collapse"]["p95"] == 307
    failed = load("native/p7-tail-dense-selection-01/completion.json")
    assert not failed["passed"]
    assert load("functional-harness-correction.json")["actualSavedBytesExactlyExpected"]
    functional = load("functional-results02.json")
    assert len(functional) == 6 and all(r["exitCode"] == 0 for r in functional)
    for row in functional:
        prefix = "native/" + row["run"] + "/"
        completion = load(prefix + "completion.json")
        assert completion["passed"]
        assert completion["sourceSha256"] == completion["finalSourceSha256"]
        assert hashlib.sha256(bundle.read(prefix + "outline.md")).hexdigest() == completion["sourceSha256"]
        observations = {o["name"]: o for o in load(prefix + "observations.json")}
        assert observations["complete"]["document"]["mode"] == row["mode"]
        if row["phase"] == "keyboard":
            before = observations["selection-before-fold"]["document"]
            for name in ["collapseAll", "expandAll"]:
                after = observations["selection-after-" + name]["document"]
                assert after["cursor"] == before["cursor"] == 1
                assert after["selection"] == before["selection"]
                assert after["version"] == before["version"]
                assert not after["dirty"]
            for name in ["edited", "undo", "redo", "final-undo"]:
                assert not observations["selection-" + name + "-saved"]["document"]["dirty"]
    final = load("postrun-verification.json")
    assert not final["inputDrift"] and final["protectedArtifactsUnchanged"]
    assert all(r["stoppedUtc"] for r in final["drivers"])
    assert final["xvfbStopped"]
    for row in index["screenshots"]:
        data = (root / "screenshots" / row["copy"]).read_bytes()
        assert data == bundle.read(row["archiveMember"])
        assert hashlib.sha256(data).hexdigest() == row["sha256"]
print(f"Verified {len(index['members'])} members, 1060 performance observations and six "
      "functional runs. Failures retained; the original performance budgets remain OPEN.")

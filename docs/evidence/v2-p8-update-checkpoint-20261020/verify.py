#!/usr/bin/env python3
"""Validate the immutable update-checkpoint evidence without running installers."""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parent
index = json.loads((root / "index.json").read_text())
archive = root / index["archive"]
assert archive.stat().st_size == index["archiveBytes"]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == index["archiveSha256"]
sha = "b2f0efaf6f1689cd709c49985e616c0c6a15957e"
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(set(bundle.namelist()))
    assert set(bundle.namelist()) == {row["path"] for row in index["members"]}
    for row in index["members"]:
        path = Path(row["path"])
        assert not path.is_absolute() and ".." not in path.parts
        assert path.suffix.lower() not in {".exe", ".dll", ".msi", ".msix", ".deb"}
        data = bundle.read(row["path"])
        assert len(data) == row["bytes"]
        assert hashlib.sha256(data).hexdigest() == row["sha256"]

    def load(name):
        return json.loads(bundle.read(name))

    source = load("source-manifest.json")
    assert source["source"] == sha
    assert source["baseline"] == "5b62eb75615170f8a9cd8eede5fa42f275850ca7"
    for row in source["files"]:
        data = bundle.read("source/" + row["path"])
        assert len(data) == row["bytes"]
        assert hashlib.sha256(data).hexdigest() == row["sha256"]
        assert hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest() == row["gitBlob"]
    commit = load("candidate-remote.json")
    assert commit["sha"] == sha
    for role in ["author", "committer"]:
        assert commit[role]["login"] == "LarryZhu-dev"
        assert commit[role]["id"] == 40397402
        assert commit["commit"][role]["name"] == "LarryZhu-dev"
        assert commit["commit"][role]["email"] == "larryzhu@foxmail.com"
    assert bundle.read("red/exit-code.txt").strip() == b"101"
    assert b"0 passed; 2 failed" in bundle.read("red/rust.log")
    assert bundle.read("green/workspace-tests01.exit").strip() == b"1"
    assert b"terminates a real infinite loop while the main thread is still blocked" in bundle.read("green/workspace-tests01.log")
    for name in ["workspace-tests02", "rust-full01", "build01", "browser-updates01"]:
        assert bundle.read(f"green/{name}.exit").strip() == b"0"
    assert b"199 passed; 0 failed; 5 ignored" in bundle.read("green/rust-full01.log")
    assert b"14 passed" in bundle.read("green/browser-updates01.log")
    validation = load("validation.json")
    assert validation["candidate"] == sha
    assert all(not files for files in validation["unchangedPaths"].values())
    assert validation["local"]["workspaceVitestTotal"] == 2565
    run = load("windows-ci01/run.json")
    assert run["head_sha"] == sha and run["status"] == "completed"
    assert run["conclusion"] == index["windowsConclusion"]
    assert load("windows-ci01/artifacts.json")["total_count"] == 0
    assert load("windows-ci01/source.json")["commit"] == sha
    phases = load("windows-ci01/phases.json")
    assert len(phases) == 15
    assert all(p["status"] == "passed" for p in phases)
    assert all(c["exitCode"] == 0 for p in phases for c in p["commands"])
    assert load("windows-ci01/rust-test-result.json")["status"] == "passed"
    binary = load("windows-ci01/production-binary-manifest.json")
    assert binary["status"] == "passed" and binary["sha256"] == binary["sha256After"]
    step = next(n for n in bundle.namelist()
                if n.startswith("windows-ci01/run-logs/desktop-source/")
                and n.endswith("_Record source-validation boundary.txt"))
    lines = bundle.read(step).decode("utf-8-sig").splitlines()
    stripped = "\n".join(re.sub(r"^\ufeff?\d{4}-\d\d-\d\dT[^ ]+ ", "", line)
                         for line in lines)
    groups = dict(re.findall(r"^##\[group\]([^\r\n]+)\n(.*?)^##\[endgroup\]",
                             stripped, re.M | re.S))
    for name in ["source.json", "phases.json", "rust-test-result.json",
                 "production-binary-manifest.json"]:
        assert json.loads(groups[name]) == load("windows-ci01/" + name)
    with zipfile.ZipFile(BytesIO(bundle.read("windows-ci01/run-logs.zip"))) as raw:
        assert raw.testzip() is None
        for name in raw.namelist():
            if not name.endswith("/"):
                assert raw.read(name) == bundle.read("windows-ci01/run-logs/" + name)
print(f"Verified {len(index['members'])} members, baseline red preserved, "
      "local green and Windows source checks; no installer or GUI claim.")

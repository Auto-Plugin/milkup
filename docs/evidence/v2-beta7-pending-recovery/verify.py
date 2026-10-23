#!/usr/bin/env python3
"""Read-only verification of the published evidence, using Python stdlib only."""

import gzip
import hashlib
import json
from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_png(path):
    data = path.read_bytes()
    require(data.startswith(b"\x89PNG\r\n\x1a\n"), f"Invalid PNG: {path.name}")
    cursor = 8
    chunks = []
    while cursor < len(data):
        require(cursor + 12 <= len(data), f"Truncated PNG: {path.name}")
        size = struct.unpack(">I", data[cursor : cursor + 4])[0]
        kind = data[cursor + 4 : cursor + 8]
        end = cursor + 12 + size
        require(end <= len(data), f"Truncated PNG chunk: {path.name}")
        content = data[cursor + 8 : cursor + 8 + size]
        expected = struct.unpack(">I", data[cursor + 8 + size : end])[0]
        require(zlib.crc32(kind + content) == expected, f"PNG CRC: {path.name}")
        chunks.append(kind)
        cursor = end
        if kind == b"IHDR":
            width, height = struct.unpack(">II", content[:8])
            require(width > 0 and height > 0, f"Empty PNG: {path.name}")
    require(chunks[0] == b"IHDR" and chunks[-1] == b"IEND", "PNG framing")


listed = set()
for line in (ROOT / "SHA256SUMS.txt").read_text().splitlines():
    expected, relative = line.split("  ", 1)
    path = ROOT / relative
    require(relative not in listed, f"Duplicate manifest path: {relative}")
    require(not path.is_symlink(), f"Symlink is not evidence: {relative}")
    require(path.resolve().is_relative_to(ROOT), "Manifest path escaped root")
    require(path.is_file(), f"Missing evidence: {relative}")
    require(digest(path.read_bytes()) == expected, f"SHA256 mismatch: {relative}")
    listed.add(relative)
actual = {
    str(path.relative_to(ROOT))
    for path in ROOT.rglob("*")
    if path.is_file() and path.name != "SHA256SUMS.txt"
}
require(actual == listed, "File list differs from SHA256SUMS.txt")

report = read_json(ROOT / "result.json")
candidate = read_json(ROOT / "candidate.json")
source = "d73b46a2a745ba330949a929191e687dd5c408e9"
binary = "939a6c1e770a9c389529ab854678f24780dc1b3af42ed42ea059dee0623cf8e8"
require(report["sourceCommit"] == candidate["sourceCommit"] == source, "Source identity")
require(report["binarySha256"] == candidate["binarySha256"] == binary, "Binary identity")
require(candidate["inputDrift"] == candidate["verifiedCommitInputDrift"] == [], "Recorded input drift")
rows = report["rows"]
require(len(rows) == 32 and all(row["passed"] is True for row in rows), "32/32 result")
require(report["counts"] == {"recorded": 32, "passed": 32, "failed": 0}, "Declared counts")
require(len({row["name"] for row in rows}) == 32, "Unique step names")
for index, row in enumerate(rows, 1):
    require(row["name"].startswith(f"{index:02d}-"), "Step ordering")
    require(row["after"]["appVersion"] == "2.0.0-beta.7", "Observed app version")
    for image in row["screenshots"]:
        require(digest((ROOT / image["file"]).read_bytes()) == image["sha256"], "Row screenshot hash")

before = rows[0]["after"]["catalog"]["diagrams"]
imported = rows[1]["importResultCatalog"]["diagrams"]
require(before["active"] is None and before["pending"]["phase"] == "prepared", "Seed is failed pending, not active upgrade")
require(before["pending"]["generation"]["version"] == "1.1.1", "Seed version")
require(before["retainsPriorActivationTimeout"] is True, "Retained failure evidence")
require(imported["active"] is None and imported["enabled"] is False, "Import does not enable")
require(imported["pending"]["phase"] == "prepared", "Imported prepared phase")
require(imported["pending"]["generation"]["version"] == "1.2.0", "Imported version")
require(imported["pending"]["generation"]["host"] == "worker", "Imported host")
require(imported["pending"]["generation"]["hasApproval"] is False, "New approval does not carry over")
require(imported["hasStartAttempt"] is False and imported["tombstone"] is False, "No startup or tombstone")
require(imported["retainsPriorActivationTimeout"] and imported["retainsSupersededCandidateDiagnostic"], "Failure/supersession retained")

names = ["ordinary-flowchart", "ordinary-sequence", "windowed-flowchart", "windowed-sequence"]
for name, start in zip(names, [3, 10, 17, 24]):
    fixture = report["fixtures"][name]
    data = (ROOT / fixture["file"]).read_bytes()
    require(digest(data) == fixture["sha256"], "Stored fixture hash")
    decoded = gzip.decompress(data) if fixture["compression"] else data
    require(digest(decoded) == fixture["uncompressedSha256"], "Fixture original bytes")
    require(len(decoded) == fixture["uncompressedBytes"], "Fixture original length")
    require(b"\r\n" in decoded, "Fixture CRLF retained")
    require(rows[start]["after"]["vectorCount"] > 0, "Enabled render")
    require(rows[start + 3]["after"]["vectorCount"] == 0, "Disabled render removed")
    require(rows[start + 4]["after"]["vectorCount"] > 0, "Reenabled render")
    for index in [start, start + 2, start + 3, start + 4, start + 5]:
        require(rows[index]["saved"]["sha256"] == fixture["uncompressedSha256"], "Saved original bytes")
    require(rows[start + 1]["saved"]["sha256"] != fixture["uncompressedSha256"], "Edited saved bytes differ")

require(report["restart"]["count"] == 1 and report["restart"]["fixture"] == "windowed-sequence", "Bounded restart scope")
require(report["processSessionCount"] == 2 and report["restart"]["sameActiveGenerationChecked"], "Restart session evidence")
require(rows[30]["after"]["catalog"]["diagrams"]["active"] == rows[31]["after"]["catalog"]["diagrams"]["active"], "Restart active content identity")
require(rows[31]["after"]["vectorCount"] > 0, "Restart render present")
require(rows[31]["saved"]["sha256"] == report["fixtures"]["windowed-sequence"]["uncompressedSha256"], "Restart file bytes")

for item in read_json(ROOT / "provenance.json")["files"]:
    require(digest((ROOT / item["destination"]).read_bytes()) == item["sha256"], "Derived/copy provenance")
    require(item["sources"], "Missing source traceability")
pngs = list(ROOT.rglob("*.png"))
require(len(pngs) == 8, "Selected screenshot count")
for path in pngs:
    verify_png(path)
print(f"Verified {len(listed)} file SHA256 values, {len(pngs)} PNG structures, four fixture byte identities and 32/32 saved results.")
print("Saved evidence only: exact d73 Linux candidate, not a test rerun, final beta.7 or Windows acceptance.")

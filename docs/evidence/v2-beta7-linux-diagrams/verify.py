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

native = read_json(ROOT / "native/index.json")
expected_counts = {
    "run-default-dom": (2, 1),
    "run-default-dom-diagnostic01": (2, 1),
    "run-default-dom-diagnostic02-dbus": (41, 0),
    "run-default-dom-production-dbus": (3, 0),
    "run-delivered-worker": (42, 0),
    "run-pending-upgrade02": (1, 1),
}
require({run["directory"] for run in native["runs"]} == set(expected_counts), "Native run set")
for name, (passed, failed) in expected_counts.items():
    report = read_json(ROOT / "native" / name / "result.json")
    rows = report["rows"]
    require(sum(row["passed"] is True for row in rows) == passed, f"Pass count: {name}")
    require(sum(row["passed"] is False for row in rows) == failed, f"Fail count: {name}")
    require(len(rows) == passed + failed, f"Recorded count: {name}")
    for fixture in report["fixtures"].values():
        data = (ROOT / fixture["file"]).read_bytes()
        require(digest(data) == fixture["sha256"], "Fixture stored SHA256")
        decoded = gzip.decompress(data) if fixture["compression"] else data
        require(digest(decoded) == fixture["uncompressedSha256"], "Fixture content SHA256")
        require(len(decoded) == fixture["uncompressedBytes"], "Fixture length")

summary = read_json(ROOT / "official/summary.json")
require(summary["count"] == 50 and summary["rendered"] == 50 and summary["failed"] == 0, "Official 50/50 count")
require(len(list((ROOT / "official/rendered").glob("*.png"))) == 50, "Official PNG count")
official = ROOT / "official"
for copied in read_json(official / "provenance.json")["copies"]:
    data = (official / copied["targetPath"]).read_bytes()
    require(digest(data) == copied["targetSha256"] == copied["sourceSha256"], "Official copy provenance")
fixtures = read_json(official / "fixtures-manifest.json")["fixtures"]
require(len(fixtures) == 50, "Official fixture count")
registrations = set()
for fixture in fixtures:
    identifier = fixture["id"]
    data = (official / "fixtures" / Path(fixture["path"]).name).read_bytes()
    case = read_json(official / "rendered" / f"{identifier}.json")
    png = (official / "rendered" / f"{identifier}.png").read_bytes()
    require(digest(data) == fixture["sha256"] == case["fixtureSha256"], "Official fixture identity")
    require(digest(png) == case["pngSha256"], "Official rendered PNG identity")
    require(case["expectedRegistrationId"] == fixture["expectedRegistrationId"], "Official registration identity")
    registrations.add(fixture["expectedRegistrationId"])
require(len(registrations) == 37, "Official built-in registration count")
for derived in read_json(ROOT / "native/provenance.json")["files"]:
    require(digest((ROOT / derived["destination"]).read_bytes()) == derived["sha256"], "Native derived provenance")
pngs = list(ROOT.rglob("*.png"))
for path in pngs:
    verify_png(path)

print(f"Verified {len(listed)} file SHA256 values, {len(pngs)} PNG structures, native fixture bytes and declared run counts.")
print("This checks the saved evidence; it does not rerun rendering, prove visual quality or validate Windows behavior.")

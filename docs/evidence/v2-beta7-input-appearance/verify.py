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

candidate = read_json(ROOT / 'candidate.json')
require(candidate['sourceHead'] == 'cc2cfc1d44b937e56cfcbd6e8f3cdcf3ded10189', 'Candidate source')
require(candidate['binarySha256'] == 'ca0b00526f756528e9513fa528f654c2b166455d81b24eb5a1351db9595c197b', 'Candidate binary')
require(candidate['inputDrift'] == [] and candidate['inputCount'] == 525, 'Recorded frozen inputs')
list_final = read_json(ROOT / 'list/run-list-green03.json')
require(list_final['counts'] == {'rows': 12, 'passed': 12, 'failed': 0}, 'List rows')
phases = [p for r in list_final['rows'] for p in r['phases']]
require(len(phases) == 64 and all(p['passed'] for p in phases), 'List named saved phases')
for phase in phases:
    require(phase['actualSha256'] == phase['expectedSha256'], 'Phase SHA')
    require(phase['actualBytes'] == phase['expectedBytes'], 'Phase bytes')
    require(phase['observed']['cursor'] == phase['expectedCursor'], 'Phase cursor')
caret = list_final['caretObservations']
require(len(caret) == 12 and all(c['caretLeft'] == 49 and c['checkboxRight'] == 44 for c in caret), 'Final task caret geometry')
old = read_json(ROOT / 'list/run-list-green02.json')
require(len(old['caretObservations']) == 12 and all(c['caretLeft'] == 29 and c['checkboxRight'] == 44 for c in old['caretObservations']), 'Retained old caret defect')
require(read_json(ROOT / 'list/run-list-red01.json')['counts'] == {'rows': 1, 'passed': 0, 'failed': 1}, 'Retained marker failure')
require(len([r for r in list_final['rows'] if 'final' in r]) == 2, 'Two final byte roundtrips')
for row in list_final['rows']:
    if 'final' in row:
        require(row['final']['sha256'] == row['final']['originalSha256'], 'Final original byte hash')
for f in read_json(ROOT / 'list/fixtures.json'):
    data = (ROOT / f['file']).read_bytes()
    require(digest(data) == f['sha256'], 'Stored fixture')
    decoded = gzip.decompress(data) if f['compression'] else data
    require(digest(decoded) == f['originalSha256'] and len(decoded) == f['originalBytes'], 'Decoded fixture')

appearance = read_json(ROOT / 'appearance/final-functional.json')
require(appearance['binarySha256'] == candidate['binarySha256'], 'Appearance candidate identity')
require(len(appearance['rows']) == 26 and all(r['passed'] for r in appearance['rows']), '26 functional rows')
configs = appearance['rows'][19]['configurations']
require(len(configs) == 16 and all(c['passed'] for c in configs), '16 responsive configurations')
require({(c['width'], c['height'], c['zoom'], c['theme']) for c in configs} == {(w, h, z, t) for w, h in [(760, 520), (1280, 800)] for z in [1, 1.25, 1.5, 2] for t in ['light', 'dark']}, 'Responsive axes')
require(appearance['processExitCode'] == 1, 'Original cleanup failure remains disclosed')
post = read_json(ROOT / 'appearance/post-cleanup-readonly.json')
require(post['ownedProcessCount'] == 6 and post['allRecordedOwnedProcessesAbsent'] and post['matchingLiveLaunchCount'] == 0, 'Later read-only process absence')
require(post['signalsSent'] is False and post['originalEvidenceUnchanged'], 'No retrospective mutation/signaling')
prior = read_json(ROOT / 'appearance/prior-runs.json')
require([(r['counts']['passed'], r['counts']['failed']) for r in prior] == [(0, 0), (2, 1), (14, 1), (17, 1), (19, 1)], 'Historical failures retained')
require(sum(c.get('passed') is True for c in prior[-1]['matrixConfigurations']) == 13, 'Historical partial matrix')
for f in read_json(ROOT / 'appearance/fixtures.json'):
    data = (ROOT / f['file']).read_bytes()
    require(digest(data) == f['sha256'] and len(data) == f['bytes'], 'Self-authored CSS/document identity')

for file, passed, failed in [('browser-before.json', 8, 8), ('browser-after.json', 16, 0), ('browser-final.json', 16, 0)]:
    doc = read_json(ROOT / 'ime/preedit' / file)
    require(doc['passed'] == passed and doc['failed'] == failed, 'IME stage count')
final_browser = read_json(ROOT / 'ime/preedit/browser-final.json')
require(final_browser['sourceBefore'] == final_browser['sourceAfter'], 'IME component run source stability')
require(read_json(ROOT / 'ime/event-order/RESULT.json')['verification']['unit-fixed.log']['passed'] == 39, 'IME separate event test count')
for record in read_json(ROOT / 'provenance.json')['files']:
    require(digest((ROOT / record['file']).read_bytes()) == record['sha256'], 'Source/copy index')
    require(record['source'], 'Original source trace')
pngs = list(ROOT.rglob('*.png'))
for path in pngs:
    verify_png(path)
print(f'Verified {len(listed)} file SHA256 values, {len(pngs)} PNG structures, list 12/12 + 64 phases and appearance 26/26 + 16 configurations.')
print('Appearance original exit remains 1; IME evidence is browser/component only. No application or Windows tests rerun.')

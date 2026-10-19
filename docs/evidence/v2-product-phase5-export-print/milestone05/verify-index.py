#!/usr/bin/env python3
"""Verify immutable evidence bytes; does not turn recorded failures into passes."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "index.json").read_text())
listed = set()
for row in manifest["files"]:
    relative = Path(row["path"])
    assert not relative.is_absolute() and ".." not in relative.parts
    target = root / relative
    data = target.read_bytes()
    assert len(data) == row["bytes"], relative
    assert hashlib.sha256(data).hexdigest() == row["sha256"], relative
    listed.add(relative.as_posix())
actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and p.name != "index.json"}
# Nested index.json files are themselves immutable evidence and must be listed.
actual |= {p.relative_to(root).as_posix() for p in root.rglob("index.json") if p.parent != root}
assert listed == actual, (listed - actual, actual - listed)
print(f"PASS {len(listed)} evidence files; status claims remain those of their individual reports")

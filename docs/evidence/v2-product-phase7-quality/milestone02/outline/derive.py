"""Read-only derivation of existing production measurements; never rerun input."""
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
run = (root / "runs" / sys.argv[1]).resolve()
assert run.parent == root / "runs"
raw = run / "measurements.json"
plan = json.loads((run / "plan.json").read_text())
completion = json.loads((run / "completion.json").read_text())
measurements = json.loads(raw.read_text())


def distribution(values):
    ordered = sorted(values)
    if not ordered:
        return {"count": 0}
    result = {
        "count": len(ordered),
        "min": ordered[0],
        "median": statistics.median(ordered),
        "max": ordered[-1],
    }
    if len(ordered) >= 20:
        result["p95"] = ordered[math.ceil(len(ordered) * 0.95) - 1]
    return result


groups = {}
rows = []
for row in measurements:
    if row["status"] != "observed":
        rows.append({"name": row["name"], "status": row["status"]})
        continue
    name = row["name"].rsplit("-", 1)[0]
    frames = sorted(set(t for t in row["stableFrameTimes"] if t <= row["done"]))
    assert len(frames) >= 3
    record = {
        "name": row["name"],
        "status": "observed",
        "totalMs": row["elapsedMs"],
        "inputToStableTargetFrameMs": frames[0] - row["start"],
        "stableTargetFrameToCompletionMs": row["done"] - frames[0],
        "stableFrames": frames,
        "renderProof": row["renderProof"],
    }
    if row["goal"]["kind"] == "index":
        record["firstRowsMs"] = row["firstRowsMs"]
    if row["goal"]["kind"] == "scroll":
        record.update(
            burstAndDriverAckMs=row["triggerFinishedAt"] - row["start"],
            postAckToCompletionMs=row["done"] - row["triggerFinishedAt"],
            actualWheelEvents=row["wheelEvents"],
            actualWheelDeltaY=row["wheelDeltaY"],
            viewport=row["viewport"],
            rangeRevision=row["virtual"].get("virtualRevision"),
        )
    rows.append(record)
    group = groups.setdefault(name, {})
    for key, value in record.items():
        if key.endswith("Ms"):
            group.setdefault(key, []).append(value)

result = {
    "run": str(run),
    "binarySha256": plan["binarySha256"],
    "harnessSha256": plan["harnessSha256"],
    "rawMeasurementsSha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
    "functionalCompletion": completion,
    "groups": {
        name: {metric: distribution(values) for metric, values in group.items()}
        for name, group in groups.items()
    },
    "rows": rows,
    "limits": [
        "Frame split is a DOM convergence proxy, not renderer CPU or physical display time.",
        "First stable-target frame is the start of the final unchanged frame sequence, not every intermediate target occurrence.",
        "Wheel burst and driver acknowledgement are inside total latency; 160ms virtual-list scheduling may also contribute but is not isolated by these observations.",
        "No worker queue, storage, scan, append or updatePanel stage attribution without a separately identified diagnostic run.",
        "No p95 below 20 comparable samples; three full indices report min/median/max only.",
    ],
}
(run / "derived-stages.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"run": str(run), "groups": result["groups"]}, indent=2))

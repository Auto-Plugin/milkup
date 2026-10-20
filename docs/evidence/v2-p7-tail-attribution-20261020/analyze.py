#!/usr/bin/env python3
"""Offline derivation from frozen inputs. --check verifies committed results."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import math
import re
import statistics
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
INDEX = json.loads((ROOT / "index.json").read_text())
BUDGET = {"collapse": 250, "expand": 250, "editor-cursor-follow": 200,
          "outline-click": 200, "wheel-burst-10": 200}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def distribution(values):
    values = sorted(values)
    if not values:
        return {"n": 0}
    result = {"n": len(values), "min": values[0],
              "median": statistics.median(values), "max": values[-1]}
    if len(values) >= 20:
        result["p95"] = values[math.ceil(len(values) * .95) - 1]
    return result


def load(bundle, name):
    return json.loads(bundle.read(name))


def operation(name):
    return re.sub(r"-\d+$", "", name)


def components(measurement):
    # The original completion callback stamps done on frame 3. Three raw arrays
    # gained a fourth timestamp after completion; never treat it as completion.
    frames = measurement["stableFrameTimes"]
    assert len(frames) >= 3 and frames[:3] == sorted(set(frames[:3]))
    start, done = measurement["start"], measurement["done"]
    # Five stored done values differ from the corresponding integer frame
    # timestamp by -7.3e-12 ms. Tolerance is only for this floating-point identity;
    # budget verdicts below still compare the original elapsed values exactly.
    assert start - 1e-6 <= frames[0] <= frames[2] <= done + 1e-6
    assert all(t > done for t in frames[3:])
    lead = frames[0] - start
    span = frames[2] - frames[0]
    after = done - frames[2]
    assert abs(lead + span + after - measurement["elapsedMs"]) < 1e-6
    return {"beforeFirstStableFrameMs": lead, "stableFrameSpanMs": span,
            "completionAfterThirdFrameTimestampMs": after,
            "afterFirstStableFrameMs": done - frames[0],
            "rawExtraFramesAfterCompletion": frames[3:]}


def summary(rows):
    bad = [r for r in rows if r["overBudget"]]
    return {"n": len(rows), "violations": len(bad),
            "leadAloneOverBudget": sum(r["beforeFirstStableFrameMs"] > r["budgetMs"]
                                       for r in bad),
            "afterFirstFrameOver100ms": sum(r["afterFirstStableFrameMs"] > 100
                                           for r in rows),
            "elapsedMs": distribution([r["elapsedMs"] for r in rows]),
            "leadMs": distribution([r["beforeFirstStableFrameMs"] for r in rows]),
            "tailMs": distribution([r["afterFirstStableFrameMs"] for r in rows])}


def counters(text):
    return {key: int(value) for key, value in (line.split() for line in text.splitlines())}


def cpu_delta(before, after):
    a, b = counters(before), counters(after)
    delta = {key: b[key] - value for key, value in a.items()}
    assert all(value >= 0 for value in delta.values())
    return delta


def union_and_peak(intervals):
    if not intervals:
        return 0, 0
    ordered = sorted(intervals)
    total, start, end = 0, *ordered[0]
    for a, b in ordered[1:]:
        if a > end:
            total += end - start
            start, end = a, b
        else:
            end = max(end, b)
    total += end - start
    active = peak = 0
    # Zero-duration intervals do not establish observable overlap.
    edges = [(a, 1) for a, b in ordered if b > a]
    edges += [(b, -1) for a, b in ordered if b > a]
    for _, delta in sorted(edges):
        active += delta
        peak = max(peak, active)
    return total, peak


def diagnostic(trace, measurements):
    assert trace["dropped"] == trace["pendingDropped"] == 0
    phases = {m["name"]: m for m in measurements}
    assert len(phases) == len(measurements) == 124
    requests, pairs = {}, []
    for event in trace["events"]:
        if event["kind"] == "rpc-request":
            key = (event["workerId"], event["protocol"], event["id"], event["direction"])
            assert key not in requests
            requests[key] = event
        elif event["kind"] == "rpc-response":
            reverse = ("host-to-worker" if event["direction"] == "worker-to-host"
                       else "worker-to-host")
            key = (event["workerId"], event["protocol"], event["id"], reverse)
            request = requests.pop(key)
            assert request["method"] == event["method"] and event["ok"]
            pairs.append((request, event))
    assert not requests
    stale_targets = [e for e in trace["events"] if e["kind"] == "target-first-observed"
                     and (e["phase"] not in phases
                          or abs(e["start"] - phases[e["phase"]]["start"]) > 1e-6)]
    rows = []
    for measurement in measurements:
        name = measurement["name"]
        phase_pairs = [(a, b) for a, b in pairs if a["phase"] == name]
        reads = [(a, b) for a, b in phase_pairs if a["method"] == "temporaryGet"]
        renders = [(a, b) for a, b in phase_pairs if a["method"] == "render"]
        read_union, peak = union_and_peak([(a["at"], b["at"]) for a, b in reads])
        row = {"name": name, "elapsedMs": measurement["elapsedMs"],
               **components(measurement),
               "methodsInNamedPhase": dict(Counter(a["method"] for a, _ in phase_pairs)),
               "storageRequests": len(reads),
               "requestedKeysIncludingRepeats": sum(a["keys"] for a, _ in reads),
               "readRpcUnionMs": read_union, "readRpcPeakOverlap": peak,
               "renderPhases": dict(Counter(a.get("renderPhase") for a, _ in renders)),
               "renderRequestsBeforeInput": sum(a["at"] < measurement["start"]
                                                for a, _ in renders),
               "renderRequestsDuringMeasuredInterval": sum(
                   measurement["start"] <= a["at"] <= measurement["done"] for a, _ in renders)}
        if reads:
            first = min(a["at"] for a, _ in reads)
            last = max(b["at"] for _, b in reads)
            row.update(readEnvelopeMs=last - first,
                       inputToFirstReadRequestMs=first - measurement["start"],
                       lastReadToFirstStableFrameMs=measurement["stableFrameTimes"][0] - last,
                       readRpcMaxMs=max(b["durationMs"] for _, b in reads),
                       readRpcSumMs=sum(b["durationMs"] for _, b in reads))
        rows.append(row)
    folds = [r for r in rows if operation(r["name"]) == "collapse"]
    assert len(folds) == 20
    assert all(r["readRpcPeakOverlap"] <= 2 for r in folds)
    assert all(r["inputToFirstReadRequestMs"] >= 0
               and r["lastReadToFirstStableFrameMs"] >= 0 for r in folds)
    fields = ["elapsedMs", "storageRequests", "requestedKeysIncludingRepeats",
              "readEnvelopeMs", "readRpcUnionMs", "readRpcMaxMs",
              "inputToFirstReadRequestMs", "lastReadToFirstStableFrameMs"]
    return {"events": len(trace["events"]), "rpcPairs": len(pairs),
            "observerMs": trace["observerMs"], "staleAuxiliaryTargetsExcluded": stale_targets,
            "foldSummary": {field: distribution([r[field] for r in folds]) for field in fields},
            "rows": rows}


old_path = ROOT / INDEX["priorArchive"]
new_path = ROOT / INDEX["archive"]
assert digest(old_path.read_bytes()) == INDEX["priorArchiveSha256"]
assert digest(new_path.read_bytes()) == INDEX["sha256"]
assert new_path.stat().st_size == INDEX["bytes"]
with zipfile.ZipFile(old_path) as old, zipfile.ZipFile(new_path) as new:
    assert old.testzip() is None and new.testzip() is None
    assert len(new.namelist()) == len(set(new.namelist())) == len(INDEX["members"])
    for row in INDEX["members"]:
        data = new.read(row["path"])
        assert len(data) == row["bytes"] and digest(data) == row["sha256"]
    measurements = []
    per_run = []
    for version in ["baseline", "fix"]:
        for number in range(1, 6):
            run = f"{version}-{number:02}"
            prefix = f"native/p7-tail-{run}/"
            source = load(old, prefix + "measurements.json")
            assert len(source) == 106
            completion = load(old, prefix + "completion.json")
            assert completion["passed"]
            for measurement in source:
                assert measurement["status"] == "observed"
                op = operation(measurement["name"])
                row = {"run": run, "version": version,
                       "cohort": "primary" if number <= 3 else "crossover",
                       "name": measurement["name"], "operation": op,
                       "startMs": measurement["start"],
                       "elapsedMs": measurement["elapsedMs"], **components(measurement)}
                if op in BUDGET:
                    row.update(budgetMs=BUDGET[op],
                               overBudget=measurement["elapsedMs"] > BUDGET[op])
                measurements.append(row)
            warm = [r for r in measurements if r["run"] == run and r["operation"] in BUDGET]
            assert len(warm) == 100
            before = load(old, f"preparation/{run}-before.json")
            after = load(old, f"preparation/{run}-after.json")
            per_run.append({"run": run, **summary(warm),
                            "operations": {op: summary([r for r in warm if r["operation"] == op])
                                           for op in BUDGET},
                            "cpuDeltaAcrossEnvelope": cpu_delta(before["cpuStat"], after["cpuStat"])})
    warm = [r for r in measurements if r["operation"] in BUDGET]
    all_groups = {version: summary([r for r in warm if r["version"] == version])
                  for version in ["baseline", "fix"]}
    extras = [{"run": r["run"], "name": r["name"],
               "extraFrames": r["rawExtraFramesAfterCompletion"]}
              for r in measurements if r["rawExtraFramesAfterCompletion"]]
    assert len(extras) == 3
    old_trace = load(old, "native/p7-tail-diagnostic-02/rpc-dom-trace.json")
    old_ms = load(old, "native/p7-tail-diagnostic-02/measurements.json")
    new_trace = load(new, "native/p7-tail-attribution-01/rpc-dom-trace.json")
    new_ms = load(new, "native/p7-tail-attribution-01/measurements.json")
    completion = load(new, "native/p7-tail-attribution-01/completion.json")
    assert completion["passed"]
    assert completion["sourceSha256"] == completion["finalSourceSha256"] == (
        "997d1c7361e2a53082a935070c6f4f38b9668235744fdde5b16b8257c7d2d757")
    diagnostics = {"baseline": diagnostic(old_trace, old_ms),
                   "candidate": diagnostic(new_trace, new_ms)}
    system = load(new, "system-samples.json")
    assert not system["errors"] and system["sampleCount"] <= system["limit"] == 300
    assert len(system["samples"]) == system["sampleCount"]
    samples = system["samples"]
    brackets = []
    for measurement in new_ms:
        op = operation(measurement["name"])
        if op not in BUDGET or measurement["elapsedMs"] <= BUDGET[op]:
            continue
        start = new_trace["timeOrigin"] + measurement["start"]
        end = new_trace["timeOrigin"] + measurement["done"]
        before = max((s for s in samples if s["wallMs"] <= start), key=lambda s: s["wallMs"])
        after = min((s for s in samples if s["wallMs"] >= end), key=lambda s: s["wallMs"])
        brackets.append({"name": measurement["name"], "elapsedMs": measurement["elapsedMs"],
                         "bracketMs": after["wallMs"] - before["wallMs"],
                         "cpuDelta": cpu_delta(before["cgroupCpuStat"], after["cgroupCpuStat"])})
    process_count = len({(p["pid"], p["startTicks"]) for s in samples for p in s["processes"]})
    process_series = {}
    for sample in samples:
        for process in sample["processes"]:
            process_series.setdefault((process["pid"], process["startTicks"]), []).append(process)
    process_cpu = []
    for (pid, birth), series in sorted(process_series.items()):
        first, last = series[0], series[-1]
        ticks = (last["utimeTicks"] + last["stimeTicks"]
                 - first["utimeTicks"] - first["stimeTicks"])
        assert ticks >= 0
        process_cpu.append({"pid": pid, "startTicks": birth, "comm": first["comm"],
                            "samples": len(series), "sampledStates": dict(Counter(p["state"] for p in series)),
                            "observedCpuSeconds": ticks / system["clockTicksPerSecond"]})
    # /proc/stat aggregate fields; guest counters are already included in user
    # counters, so they are not added to the total again.
    names = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"]
    first_ticks = list(map(int, samples[0]["systemCpuStat"].split()[1:9]))
    last_ticks = list(map(int, samples[-1]["systemCpuStat"].split()[1:9]))
    system_ticks = {name: b - a for name, a, b in zip(names, first_ticks, last_ticks)}
    assert len(system_ticks) == 8 and all(t >= 0 for t in system_ticks.values())
    cleanup = load(new, "postrun-verification.json")
    assert cleanup["additionalExperiments"] == 1 and cleanup["newProductionRuns"] == 0
    assert not cleanup["inputDrift"] and cleanup["candidateBinaryUnchanged"]
    assert cleanup["driverStopped"] and cleanup["xvfbStopped"]
    result = {
        "sourceArchiveSha256": INDEX["priorArchiveSha256"],
        "diagnosticArchiveSha256": INDEX["sha256"],
        "productionObservations": len(measurements), "warmObservations": len(warm),
        "budgetsUnchanged": BUDGET,
        "interpretation": {
            "beforeFirstStableFrameMs": "Input to timestamp of first frame of final accepted three-frame sequence; NOT pure read/IPC/layout time or exact first DOM availability.",
            "afterFirstStableFrameMs": "Remaining accepted-frame interval and callback completion; NOT proven GPU, OS contention, layout, or GC duration.",
            "rpcIntervals": "Host-realm request/response observation; includes scheduling/transport/handler waits. Union/envelope/sum are not separable CPU or disk costs.",
            "cohorts": "Fixed ordered runs, not randomized independent samples. Descriptive worsening does not establish causal regression; no significance test or universal speedup claim.",
            "firstRowsMs": "Not used: warm operations can observe old nonempty rows before the target state.",
        },
        "cohortSummary": all_groups, "runs": per_run,
        "extraRawFramesAfterCompletion": extras,
        "productionMeasurements": measurements,
        "diagnostics": diagnostics,
        "system": {
            "samples": system["sampleCount"], "processIdentities": process_count,
            "observerMs": system["observerMs"], "maxSampleMs": system["maxSampleMs"],
            "wallMs": samples[-1]["wallMs"] - samples[0]["wallMs"],
            "cpuDelta": cpu_delta(samples[0]["cgroupCpuStat"], samples[-1]["cgroupCpuStat"]),
            "pressureAvailability": load(new, "preparation/pressure-availability.json"),
            "diagnosticViolationBrackets": brackets,
            "processCpuBetweenFirstAndLastObservation": process_cpu,
            "systemCpuTickDeltas": system_ticks,
            "systemStealFractionOfAggregateTicks": system_ticks["steal"] / sum(system_ticks.values()),
            "cpuScopeCaveat": "Process CPU is multithreaded aggregate and misses unsampled start/end. Difference from cgroup CPU includes harness/sampler and cannot identify neighbor load. System steal is aggregate, not this app's stall duration.",
        },
        "decision": {"retainAsIsolatedCandidate": True, "integrationForPerformanceSupported": False,
                     "functionalRegressionObserved": False, "causalPerformanceRegressionResolved": False,
                     "stable250msProven": False, "highConfidenceProductFixAvailable": False,
                     "furtherExperimentAuthorizedByThisPlan": False},
    }
    assert result["productionObservations"] == 1060 and result["warmObservations"] == 1000
    assert result["cohortSummary"]["baseline"]["violations"] == 25
    assert result["cohortSummary"]["fix"]["violations"] == 64

target = ROOT / "analysis.json"
rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
if "--check" in sys.argv:
    assert json.loads(target.read_text()) == result, "Derived evidence differs from frozen inputs"
else:
    target.write_text(rendered)
print("Verified 1060 original observations; one separate diagnostic; budgets remain OPEN.")

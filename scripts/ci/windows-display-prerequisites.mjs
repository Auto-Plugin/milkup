import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
export function classifyDisplayPrerequisites(report) {
  assert.equal(report.status, "capabilities-observed-not-product-accepted");
  assert.equal(report.productTested, false);
  for (const k of [
    "scaleChanged",
    "driversInstalled",
    "systemSecurityChanged",
    "runtimeRemoved",
    "guestStarted",
  ])
    assert.equal(report[k], false);
  assert.deepEqual(report.errors, []);
  const d = report.display;
  assert.equal(d.threadPerMonitorV2, true);
  assert.equal(d.awareness, 2);
  assert.equal(d.threadAwarenessRestored, true);
  assert.equal(d.systemSettingsChanged, false);
  assert.equal(d.hiddenOwnedWindowsOnly, true);
  assert(d.monitors.length > 0 && d.monitors.length <= 8);
  assert.equal(
    new Set(d.monitors.map((m) => m.device)).size,
    d.monitors.length,
  );
  for (const m of d.monitors) {
    assert.equal(m.windowDestroyed, true);
    assert(
      Number.isInteger(m.windowDpi) && m.windowDpi >= 48 && m.windowDpi <= 768,
    );
    assert(Number.isInteger(m.scalePercent) && m.scalePercent > 0);
    assert.equal(
      m.windowDpi,
      Math.round((96 * m.scalePercent) / 100),
      "Native window DPI and scale must agree",
    );
    assert(m.bounds.length === 4 && m.bounds.every(Number.isInteger));
    assert(m.bounds[2] > m.bounds[0] && m.bounds[3] > m.bounds[1]);
    assert(typeof m.adapter === "string" && m.adapter.length > 0);
  }
  const differentDpiPair = d.monitors.some((a, i) =>
    d.monitors.some(
      (b, j) =>
        i !== j &&
        a.windowDpi !== b.windowDpi &&
        (a.bounds[2] <= b.bounds[0] ||
          b.bounds[2] <= a.bounds[0] ||
          a.bounds[3] <= b.bounds[1] ||
          b.bounds[3] <= a.bounds[1]),
    ),
  );
  return {
    productAcceptance: "not-run",
    monitorCount: d.monitors.length,
    nativeDpis: [...new Set(d.monitors.map((m) => m.windowDpi))],
    highDpiMonitorAvailable: d.monitors.some((m) => m.windowDpi > 96),
    differentDpiTopologyAvailable: differentDpiPair,
    osScaleChangeTested: false,
    crossMonitorTransitionTested: false,
    missingRuntimeOnHost:
      report.facilities.runtimeVersions.length === 0
        ? "unproven-by-directory-inventory"
        : "existing-runtime-present",
    locatedGuestImageCount: report.facilities.guestImages.length,
    nextGate: differentDpiPair
      ? "Owned product window, exact PID+birth, actual transition and layout still required"
      : "No different-DPI topology: do not claim cross-monitor acceptance",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = JSON.parse(
    fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""),
  );
  const classification = classifyDisplayPrerequisites(report);
  fs.writeFileSync(
    process.argv[3],
    JSON.stringify(classification, null, 2) + "\n",
  );
  console.log(JSON.stringify(classification, null, 2));
}

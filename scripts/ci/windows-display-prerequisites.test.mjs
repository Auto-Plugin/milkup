import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDisplayPrerequisites as classify } from "./windows-display-prerequisites.mjs";
function fixture() {
  return {
    status: "capabilities-observed-not-product-accepted",
    productTested: false,
    scaleChanged: false,
    driversInstalled: false,
    systemSecurityChanged: false,
    runtimeRemoved: false,
    guestStarted: false,
    errors: [],
    display: {
      threadPerMonitorV2: true,
      awareness: 2,
      threadAwarenessRestored: true,
      systemSettingsChanged: false,
      hiddenOwnedWindowsOnly: true,
      monitors: [
        {
          device: "DISPLAY1",
          adapter: "owned test adapter",
          windowDpi: 96,
          scalePercent: 100,
          bounds: [0, 0, 1024, 768],
          windowDestroyed: true,
        },
      ],
    },
    facilities: { runtimeVersions: ["existing"], guestImages: [] },
  };
}
test("one native 96-DPI monitor does not become a DPI matrix via browser DPR or requested scale", () => {
  const r = fixture();
  r.browserDevicePixelRatio = 2;
  r.requestedScale = 200;
  const c = classify(r);
  assert.equal(c.highDpiMonitorAvailable, false);
  assert.equal(c.differentDpiTopologyAvailable, false);
  assert.equal(c.osScaleChangeTested, false);
  assert.equal(c.productAcceptance, "not-run");
  assert.equal(c.missingRuntimeOnHost, "existing-runtime-present");
});
test("two distinct real DPI observations authorize only a future transition test, never its acceptance", () => {
  const r = fixture();
  r.display.monitors.push({
    ...r.display.monitors[0],
    device: "DISPLAY2",
    windowDpi: 144,
    scalePercent: 150,
    bounds: [1024, 0, 2944, 1080],
  });
  const c = classify(r);
  assert.equal(c.differentDpiTopologyAvailable, true);
  assert.equal(c.crossMonitorTransitionTested, false);
  r.display.monitors[1].bounds = [0, 0, 1920, 1080];
  assert.equal(classify(r).differentDpiTopologyAvailable, false);
});
test("virtualized awareness, inconsistent scale, missing identity or cleanup cannot satisfy preflight", () => {
  for (const mutate of [
    (r) => (r.display.awareness = 0),
    (r) => (r.display.threadPerMonitorV2 = false),
    (r) => (r.display.threadAwarenessRestored = false),
    (r) => (r.display.monitors[0].scalePercent = 150),
    (r) => (r.display.monitors[0].windowDestroyed = false),
    (r) => (r.display.monitors[0].adapter = ""),
    (r) => r.display.monitors.push({ ...r.display.monitors[0] }),
    (r) => (r.productTested = true),
    (r) => r.errors.push("incomplete"),
  ]) {
    const r = fixture();
    mutate(r);
    assert.throws(() => classify(r));
  }
});

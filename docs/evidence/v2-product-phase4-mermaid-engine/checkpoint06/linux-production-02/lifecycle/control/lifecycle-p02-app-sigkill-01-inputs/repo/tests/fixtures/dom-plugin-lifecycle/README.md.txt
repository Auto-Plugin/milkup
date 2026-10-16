# Generic DOM renderer lifecycle fixture

`main.js` is a normal default-export DOM plugin module used only by the production
native test. It performs genuine text layout and returns public inert presentation
data. A source containing `LOOP_FOREVER` deliberately loops synchronously inside the
independent renderer. No fixture ID, source token or package exception is added to
the product host.

`tests/native/tauri-dom-plugin-lifecycle.mjs` writes a documented version-1
`.milkup-plugin` JSON archive around this module, with `host: "dom"`, only
`document:read`, and one fence renderer. The archive goes through the normal GTK
package picker, approval/enable controls and native installed-package validation.

All five cases passed against the frozen Linux production-01 executable, SHA256
`46cc0e09b39966bc958fb2887c97caece3debf6ad132b098447406975969ebeb`.
The [production-01 lifecycle report](/workspace/milkup-mermaid-engine-evidence/linux-production-01/LIFECYCLE-README.md)
retains the five passing runs, nine original failures, exact inputs and measured
limitations; see also the [phase report](../../../docs/v2-product-phase4-mermaid-engine-2026-10-16.md).
Production-02 changes the fence scheduling path and requires a new build and all
five cases to run again. Its build and runtime validation are still pending; the
production-01 results apply only to the recorded executable and configuration.

## Run contract

Run one case at a time, with a new disposable XDG profile and the dedicated native
driver/display in the reviewed narrow runtime. The Node harness, driver and editor
must share a PID namespace. Keep the namespace and external process observer alive
until the verdict; do not use driver shutdown as process-cleanup evidence.

Required environment:

- `TAURI_APP_PATH`: frozen production executable copy outside a Cargo `target/`
  directory; no Vite/dev-origin binary. Its SHA is checked before and after the run.
- `MILKUP_NATIVE_EXPECTED_BINARY_SHA256`: reviewed hash of that frozen executable.
- `TAURI_DRIVER_URL`: already-running dedicated driver, defaulting to port 4444.
- `DISPLAY`: dedicated X display used by driver, editor and XTest.
- `MILKUP_NATIVE_PROFILE_ROOT`: explicit disposable directory; `XDG_DATA_HOME`,
  `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` must be subdirectories, shared with the driver.
- `MILKUP_DOM_DIAGNOSTICS=1`: also present in the driver's inherited environment.
- `MILKUP_NATIVE_APP_LOG`: existing append-only file capturing actual application
  stderr (driver's combined log is acceptable). Native phases are correlated by
  the fixture guardian's exact instance ID, not by process name.
- `MILKUP_NATIVE_EVIDENCE_DIR`: fresh nonexistent case directory, with existing
  parent, writable by the harness and readable by the native package picker.
- `MILKUP_DOM_CASE`: one of `timeout`, `disable`, `remove`, `wm-close`, `app-sigkill`.
- `MILKUP_NATIVE_RUN`: unique `lifecycle-...` name shared with the driver launcher.
- Keep `TMPDIR` unset or `/tmp` for the current exact-private-directory observer.

After the unified product build and an exclusive CPU/UI slot:

```sh
node tests/native/tauri-dom-plugin-lifecycle.mjs
```

The runtime needs Python with `pidfd_open`/`pidfd_send_signal`, Node, XTest/xdotool,
X11 tools, GTK native picker, WebKit driver, and the same retained WebKit sandbox
configuration as the reviewed product probes. No old proot runner or sandbox-disable
switch is part of this harness. It does not launch or rebuild the application/driver
outside the standard WebDriver session, and it does not launch a replacement renderer.

## Cases and interpretation

Before installing the fixture, the harness disables any bundled plugins through
the ordinary visible controls in the disposable profile. This prevents unrelated
renderer startup from being mistaken for the fixture's new guardian. It then
requires a successful real DOM preview, exact installed module hash, one new native
guardian and at least 100 ms of observed CPU growth in its running WebKit process
before injecting a lifecycle action.

`timeout` sends trusted editing input during the busy render, observes the expected
cursor plus two animation frames, saves and verifies exact bytes, then requires the
original request ID's native deadline and terminal plugin failure. A source-version
change cannot be hidden by a replacement request/deadline. `disable` and `remove`
exercise the visible controls while busy, continue editing/save observations, and
require owned-process/private-directory cleanup plus appropriate card/package state.
Normal close sends WM_DELETE_WINDOW to the exact app window. The fault case uses a
pidfd to SIGKILL only the app after PID/birth/argv revalidation. Both keep the observer
alive until the actual app and its fixture renderer tree disappear.

This harness uses page observation instrumentation: event listeners, MutationObserver,
20 ms timers and requestAnimationFrame callbacks. They observe shipped DOM and trusted
XTest events; they do not replace product methods, invoke private runtime APIs, wrap
Worker, or inject editor state. A 100 ms observation baseline is retained, and the
instrumentation's overhead is not subtracted. The warm trusted-input target is 200 ms;
all raw samples and misses are preserved. Two animation frames are a presentation
proxy, not a physical-screen timestamp.

The observer records exact PID/birth/parent/group, CPU ticks, private directory and
native trace timings. The first failure is retained without retry. Test cleanup is
explicitly recorded after the verdict and cannot turn a failure into success. A
prepared script is not a successful product test; each new executable requires
actual runs against that frozen production build. Official Mermaid rendering and
visual fidelity are covered by a separate harness.

For App SIGKILL in the cloud container, the reviewed launcher acts only as a
subreaper providing normal init wait/reap duties. It must not signal descendants,
remove their private directories or end the namespace before the verdict. The
harness requires the exact guardian PID/birth to be naturally reaped with exit0,
alongside strict disappearance of every observed identity and private directory.
The terminal ECHILD diagnostic is asynchronous and can be lost on process exit;
when absent its exact time is unknown, and natural exit supplies only an upper
bound. The earlier failed assertions remain in production-01 evidence.

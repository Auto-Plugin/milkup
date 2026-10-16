# Linux production DOM lifecycle evidence

The first Linux production `tauri build --bundles deb` completed successfully. Five full-editor generic DOM lifecycle cases passed on the same immutable executable extracted from that deb: timeout05, disable02, remove01, wm-close02 and app-sigkill04. This is lifecycle validation, not the separate official Mermaid UI/layout/pixel matrix.

## Frozen artifacts

See `provenance.json` for full paths, hashes, commands, timestamps, frontend files, native guard provenance and all 2,909 frozen source/dependency inputs. `source/`, `source-before.json` and `source-after.json` are preserved unchanged. `final-source-check.json` identifies three later test-only harness changes; product inputs remain unchanged.

- Executable: `install/usr/bin/milkup-desktop`, 21,859,680 bytes, SHA256 `46cc0e09b39966bc958fb2887c97caece3debf6ad132b098447406975969ebeb`.
- Deb: `artifacts/milkup_2.0.0-beta.1_amd64.deb`, SHA256 `fd67a5a3490b9b4b45247fc412d6370abf37354dc87d4f7131c1124f082275f1`.
- Embedded native guard: `artifacts/libmilkup_dom_guard.so`, SHA256 `5b1082768123b9ac1923eb8ef3f6f8c0bd05ffd5d66b8b2a023f75b69106c44c`.
- Installed official archive frozen alongside build: `artifacts/milkup.diagrams-1.1.0.milkup-plugin`, SHA256 `27db9bdefb9b241b03da2f3536f7e50d334117f928f963cfe290543f650b6239`.
- SDK: `artifacts/plugin-sdk-0.3.4.tgz`, SHA256 `1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f`.

The initial incorrect assertion that the post-bundle Cargo target and deb executable were identical is retained. `bundle-marker-attribution.json` proves the sole difference is the unique three-byte `UNK`→`DEB` bundle marker at offset 3,006,615; replacement yields complete byte equality, with identical ELF build ID. Every runtime case uses the actual extracted deb executable.

## Results and timing interpretation

`lifecycle-summary.json` indexes every command, original verdict, helper snapshot and raw evidence directory. Each successful case observed nine exact PID/birth identities plus the private extension directory disappear before any test/driver cleanup. App exit was separately required for WM close and SIGKILL. Real WebKit process CPU growth demonstrated a running non-cooperative renderer. Public installation/enable/disable/remove controls and actual XTest editing were used; no product runtime hooks or Worker interception were enabled.

Every native phase below is seconds from the original native render dispatch, **not elapsed time after a UI click or fault action**. These are measured monotonic scheduling points, not hard real-time guarantees.

| Run | Deadline observed | Kill started | ECHILD cleanup | Timeout control emitted |
| --- | ---: | ---: | ---: | ---: |
| timeout05 | 2.000142597 | 2.000302070 | 2.020326901 | 2.041812912 |
| disable02 | — | 0.577877586 | 0.622820198 | — |
| remove01 | — | 0.656763037 | 0.705506385 | — |
| wm-close02 | — | 0.189257104 | 0.214622801 | — |
| app-sigkill04 | — | 0.197269367 | 0.223058068 | — |

In timeout05, source-version cancellation caused by editing did not replace/reset the original `render_2` native deadline. Cleanup completed before the trusted timeout control notification. Trusted input→DOM / input→two animation frames measured 13/68 ms for timeout, 28/60 ms for disable and 9/24 ms for remove; exact edited source bytes were saved. Disable/remove typing occurred after cleanup, so those input samples do not prove overlap with cleanup.

Page listeners, MutationObserver, a 20 ms timer, rAF and the external process sampler add observational overhead. No overhead was subtracted. In the observed busy→cleanup window, maximum rAF gaps were 232 ms (timeout), 119 ms (disable), and 254 ms (remove); maximum timer gaps were 64, 96, and 54 ms. The passing 200 ms assertion applies to the specific trusted input→two-rAF sample, not every frame gap or an uninstrumented benchmark. Full samples and instrumented baselines remain in each run.

## Original failures remain failures

There are fourteen recorded runs: five passing runs and nine original failed runs. No whole-case automatic retries were used. New runs followed explicit environment or harness corrections; exact commands/timestamps/exit codes are retained under `../editor-lifecycle-runs/control`.

- timeout01: missing readonly proxy mapping and unsettled bundled-install UI.
- timeout02: long runtime socket path/proxy failure and premature/offscreen pointer setup.
- timeout03: hidden helper GTK window selected by the test, causing XSetInputFocus BadMatch.
- timeout04: sibling user namespace denied the observer `/proc/.../environ`; deadline phase was not reached.
- disable01: pointer target at bottom edge; exact details transition did not happen.
- wm-close01: menu setup action had not settled before selecting a hidden section.
- app-sigkill01: real injected fault; renderer descendants/private directory cleared, but guardian remained a zombie under the container's non-reaping PID1. Strict PID disappearance failed. This original configuration did not pass.
- app-sigkill02: readonly X11 search BadWindow startup race; no fault injection. The next harness permits at most three read-only observations for BadWindow/BadDrawable only, with each attempt recorded.
- app-sigkill03: real fault cleanup succeeded, but the test incorrectly required a final best-effort asynchronous diagnostic. Exact guardian naturally exited and was reaped with exit0, all nine identities and private directory disappeared; the original diagnostic assertion remains RED.

For SIGKILL runs02–04, a trusted ancestor supplies only normal init `waitid`/`waitpid` reaping. It sends no descendant signals, deletes no private directories and keeps the driver/namespace alive until the verdict. Root's independent review is `../editor-lifecycle-preparation-07/root-launcher-review.json`. This does not reinterpret the first failed environment as passing.

Root reviewed the product source: guardian successful return requires ECHILD, while native diagnostics use a best-effort asynchronous queue. Run04 therefore requires exact guardian PID/birth natural waitpid exit0 plus unchanged strict identity/directory checks and original 4.5 s observation bound. If the terminal trace is absent, exact ECHILD time is explicitly unknown; observed natural exit is an upper bound. Run04 happened to contain the terminal trace as well. No product logging flush or product change was made.

## Execution and handoff

Successful driver/environment: `../editor-lifecycle-preparation-04/{driver.sh,run-env.sh}` with exact readonly WebKit/proxy mappings, short private `XDG_RUNTIME_DIR`, native WebKit sandbox retained, and old proot runner unset. Driver runs in the reviewed user/mount namespace; the approved outer harness/observer share its PID namespace and can inspect the exact owned process identities. This is not a same-user-namespace claim and is not evidence that the cloud namespace itself provides product confinement.

Each run has a new XDG profile. Outer driver teardown occurs only after the recorded product verdict. SIGKILL04's driver was stopped after PASS, and the native slot was released. Xvfb :126 was deliberately kept alive for the root-authorized UI matrix handoff. No Windows build, upload, release or merge occurred.

For a minimal review archive, retain this README, `lifecycle-summary.json`, `final-source-check.json`, `provenance.json`, build/marker records, `source-before.json`, and all run control manifests/raw logs/events/observer samples/screenshots plus preparation change records. Source snapshots, frontend and executable/deb/guard/archive bodies remain in this external evidence tree; their hashes alone are not substitutes for those bodies.

Final read-only audit (`owned-process-final-audit.json`) checked 72 historical owned identities and all fourteen driver identities. No driver or passing-run owned identity remains. Two historical failed-environment guardians remain zombies under non-reaping PID1: timeout04 preparation failure PID 290043/birth 4415971, and app-sigkill01 PID 293457/birth 4476597. They do not execute CPU, cannot be reaped by the non-parent observer, and were not hidden or counted as successful cleanup.

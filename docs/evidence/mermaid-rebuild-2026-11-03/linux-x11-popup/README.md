# Linux X11 offscreen renderer fix and real UI verification

Source fix: `ee305c4c8e8fc2e2a8fb7356170a6ec59b6674e4` (`private_mermaid_linux.rs` only). Frozen production ELF SHA-256: `9bfce3146a9d6f5b44a2c769a3e55b72521fdb33beed8247980aaa412742347a`, 316547648 bytes. Installed WebKitGTK 2.52.6; WebKit's own sandbox stayed enabled. The build used `--locked --bin milkup-desktop --features tauri/custom-protocol` and the previously recorded unchanged production frontend from source0e. `cargo-check.log`, `cargo-build.log`, and `build-provenance.json` retain exact evidence. Both Cargo commands passed; the existing unused `plugin_catalog::prepare` warning remained.

## Problem and supported behavior

On the prior source0e binary, Xfwm4 repositioned the supposedly hidden managed Toplevel to (5,29), mapped it, and stacked its blank window above the editor. The actual root screenshots and IsViewable observations are retained in `../linux-close-0e3912db/focus-observation-run-04/`. Keyboard-focus theft was not observed; the confirmed defect was visible screen coverage.

The helper now checks its actual display GType after GTK initialization and accepts `GdkX11Display` only. It uses a GTK Popup, which X11 implements with override-redirect, retains screen coordinates (-20000,-20000), and explicitly disables focus on map as well as accepting focus. Sandbox, fixed assets, plugin boundaries, and output/cleanup budgets are unchanged.

**X11 only:** native Wayland is explicitly rejected by the display guard and source fallback remains available. The generic rendering failure notice does not automatically switch display backends. No parent backend is forced, and Wayland behavior has not been tested or accepted. This is an intentional support boundary, not an assertion of general Linux/Wayland compatibility.

## Accepted actual tests

`window-and-close-run-02`: a fresh profile, actual Xfwm4, single real plugin enable, actual decoded 448x126 Mermaid PNG, no programmatic activation compensation after startup, and actual XTest Alt+F4. All seven retained helper samples were IsViewable, override-redirect=yes, absent from WM client stacking, and fully outside the screen at (-20000,-20000), including the resize from1280x768 to448x126. Both sampled active-window and actual X input focus remained the main window. Root screenshots taken while the helper existed show the editor/menu normally. Exact child exit0 with no signal was observed after 88.663 ms, before WebDriver session cleanup. One native guardian and one owned private-directory cleanup completed; no product/helper/WebKit process or private renderer directory remained. The observer, driver, Xfwm4, xfconfd, and Xvfb all exited0. `window-regression.json` contains each criterion and sample. Finite observation gaps are retained in the sampler summary; this is not an unsampled universal focus guarantee.

`product-native`: the unchanged original 11-step actual product scenario passed on the identical frozen ELF (14:59:20–15:00:03 UTC). It covered initial source fallback, enable→native PNG, source mode/caret, actual Chinese edit/save/replacement, undo/exact bytes, disable, re-enable, natural wide dimensions, C4, invalid grammar/source diagnostic, and final disable/exact files. Its WebDriver teardown is **session cleanup**, separate from the real normal-close evidence above. Display/driver groups exited0. `post-product-cleanup.json` records no remaining owned product processes, ports4450/4451, or :144 lock/socket. Later HEAD522b9b4d at cleanup contained Windows evidence only; this ELF remains pinned to sourceee305.

## Preserved unsuccessful attempts

`window-and-close-run-01` generated an actual PNG and naturally exited0, but the new observation gate failed because it incorrectly required the first realized-yet-unmapped helper sample to be IsViewable. Every observed bound was already offscreen; five later samples were IsViewable. Its original failed `window-regression.json` is preserved. A runner bug also left `run.json.exitCode=0` despite an orchestration exception; that status is not accepted as regression success. The runner was corrected to require **all observed helper bounds offscreen plus at least two mapped samples**, and to return exit1 on any orchestration exception. The subsequent run02 above passed; the failed attempt was not rewritten.

`product-session.log` records an initial original11 attempt that exhausted /tmp while copying the ELF, before starting an application or display. `owned-copy-cleanup.json` records SHA/identity-checked deletion of only seven copied ELF files from already completed, archived, process-free owned runs, freeing2.2GB. The frozen build ELF and all original evidence were preserved. `product-session-02.log` is the successful retry.

`native-corpus-ee305c4c-02/corpus`: all50 original fixed fixtures rendered through the same production ELF and retained fully decoded PNGs. Every guardian exited0, removed its owned private directory, and left no active native processes; the separate :143 namespace and all owned service groups exited. The short-profile smoke also passed. This is a direct production-helper test, not a Registry lease test or50 editor UI scenarios.

Historical comparison retains the exact prior provenance and file hashes: all50 fixture source SHA-256s and dimensions match;48/50 PNG file hashes and decoded RGBA hashes match exactly. Cases06-gitGraph and14-classDiagram differ and are listed explicitly in `historical-png-comparison.json`; no universal pixel-equality claim is made. `06-gitGraph` differs in generated commit identifiers. An initial visual interpretation of `14-classDiagram` incorrectly reported a missing `+save()` line. That interpretation is explicitly withdrawn: the title, attribute, and method text interiors are pixel-identical; the method contains the same145 dark glyph pixels. The517 changed pixels have maximum per-channel difference9/255 and no alpha difference, consistent with small outline pixel variation; a specific cause has not been established. `native-corpus-ee305c4c-02/correction.json` preserves and supersedes the original mistaken observation, and `class14-independent-pixel-verification.json` plus its script reproduce the numerical check. No extra render was run for this correction. Full visual acceptance is not inferred solely from decoding PNGs.

The first direct-helper smoke under `native-corpus-ee305c4c-01` failed before PNG output because its long XDG_RUNTIME_DIR produced a118-byte WebKit bus-proxy path, exceeding the Unix-domain socket path budget. Its guardian cleanup and service teardown succeeded. The unchanged failed scripts/report are retained. Attempt02 uses a fresh short `/tmp/milkup-corpus-*` runtime profile; it does not disable WebKit's sandbox or proxy. All successes above use the identical frozen production ELF.

## Representative evidence

- Prior visible defect: `../linux-close-0e3912db/focus-observation-run-04/evidence/renderer-observed-01-system.png`.
- Fixed helper alive with normal editor/menu: `window-and-close-run-02/evidence/renderer-observed-01-system.png`.
- Actual PNG before normal close: `window-and-close-run-02/evidence/01-enabled-before-normal-close-system.png`.
- Normal close, process, and native cleanup record: `window-and-close-run-02/evidence/normal-close.json`.
- Popup attributes and input focus: `window-and-close-run-02/evidence/window-regression.json`.
- Product edited Chinese/C4/wide screenshots: `product-native/evidence/`.

`reproduction/` preserves the derived scripts, earlier attempt, diffs, and hashes. The existing namespace wrapper and runtime overlay design are retained under `../product-linux/reproduction/` and `../native-linux-helper/`. Scripts use only isolated owned processes and real XTest input; DOM/privateIPC close and forced termination are not accepted as successful normal close. Artifact collection excludes executables, profiles, runtime state, caches, and credentials.

Final owned-process/display/port cleanup and the archive hash check are retained in `final-cleanup-and-archive-verification.json`. The actual build remains sourceee305; later shared HEADf72 includes the separate failure-notice wording change and Windows evidence, which are not part of this ELF.

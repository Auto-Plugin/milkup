# Linux shutdown and helper-window verification

Frozen source: `0e3912db3f2cc4d77dd73513ce73d5440ec36f54`. Frozen ELF SHA-256: `3c94ccaed3ada935e890691eadbdf1b8caa241deefc5b9a68776292321b8ac42`. Installed WebKitGTK 2.52.6; own sandbox remained enabled. Build and runtime identities are in `build-provenance.json`.

## Results

- `product-native`: original 11-step actual product UI scenario passed. Its WebDriver session teardown is recorded as session cleanup only, not normal OS-close acceptance.
- `normal-close-run-01`: failed before sending Alt+F4 because the old menu helper did not observe closing within its wait. No normal-close success is claimed. Outer owned namespace teardown completed. Its first launcher observer buffered logs, so its empty application log is not proof that no native work occurred.
- `normal-close-run-02`: fresh profile, single actual plugin enable and decoded PNG, then actual XTest Alt+F4. Exact product child exited 0 without signal in 89.795 ms. One guardian and one owned directory cleanup completed, no helper or native private directory remained. The launcher observed exit before WebDriver session cleanup. This run explicitly activated the main window before closing the menu; recorded active-window IDs before and after activation were identical. It does not establish absence of transient render-time focus or placement problems.
- `focus-observation-run-03`: failed before Alt+F4; first click was followed by an immediate geometry read and a second click, which rejected its target. Preserve as failed. Its samples establish helper-managed screen coordinates but not Map State or captured visible pixels. The sampler produced a complete bounded summary, but outer cleanup reports its exit as -15, not a natural exit. The product's 180 ms closing animation keeps the menu laid out and inert until completion; this is a plausible explanation for the premature repeat-click failure, not a proven explanation for run01.
- `focus-observation-run-04`: no programmatic activation after startup. Single real menu click followed by bounded observation closed the menu. Actual Alt+F4 exited 0 in 64.665 ms; one guardian/private-directory cleanup, no active product/helper/WebKit process or owned private directory remained, all observer/driver/window-manager/display processes exited 0.

## Confirmed product defect on the frozen source

Run04 mapped helper `0xa0000e`, PID 1062, title `Milk up fixed diagram renderer`, to absolute coordinates (5,29). `xwininfo -all` reports `Map State: IsViewable`. `_NET_CLIENT_LIST_STACKING` lists main `0x60000e` then helper. Two actual root screenshots, `renderer-observed-00-system.png` and `renderer-observed-01-system.png`, show the large blank helper window visibly covering the editor. It was initially 1280x768 and subsequently resized to 448x126. This is a visible helper-window defect; the successful renderer/close results do not waive it.

During retained helper samples, both `_NET_ACTIVE_WINDOW` and actual X input focus remained the main window (`6291470`). No keyboard-focus steal was observed. Sampling is finite (52 retained samples, maximum gap 478.547 ms including screenshot work); this is not a proof that no sub-sample transient can occur.

The pre-existing Toplevel uses `move_(-20000,-20000)`, which is only a WM placement request. GTK documents that [Toplevel positions may be ignored](https://docs.gtk.org/gtk3/method.Window.move.html) and [Popup windows are not managed by the WM](https://docs.gtk.org/gtk3/enum.WindowType.html). A prospective X11-only Popup/focus-on-map fix is not part of this frozen candidate.

## Cleanup and source ownership

`post-run02-cleanup-source-freeze.json` records exact source0e, clean git, unchanged frozen binary, no owned active process, no listener on 4450/4451, no :144 lock/socket at 14:40:09 UTC. Source freeze was released after that record.

`post-run04-cleanup.json` records clean HEAD44ef263e (later Windows-only diagnostics), the unchanged binary source0e/SHA3c94, and no owned active process, listener, or display artifact. No product source was modified by these runs. All four normal-close/focus profiles and displays were fresh and isolated; failure cleanup remains explicitly distinguished from a naturally successful product exit.

## Reproduction records

`normal-close-reproduction/` contains original/derived runners, launcher observer, read-only X11 observer, script SHA manifests and diffs. Attempt03 scripts are preserved separately from attempt04. No DOM close, private IPC close, or direct SIGTERM is used as normal-close acceptance. SIGTERM/SIGKILL is restricted to explicitly owned cleanup groups on orchestration/failure teardown; successful OS close is observed before that cleanup.

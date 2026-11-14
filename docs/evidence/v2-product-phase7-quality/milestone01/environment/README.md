# P7 Linux environment and real IME feasibility

Observed 2026-10-19 UTC; baseline `fa530b399a5ebbd020f9bfa7ca039378604c8282` on `dot/milkup-v2-product-phase7-quality`. No product source edited by this audit. Read the product completion plan and cloud environment document; the old plan's progress snapshot is historical, while the current P7 task remains open.

## Exact production baseline

`../baseline-production/milkup-desktop` is the newly built, frozen ELF: 23,138,832 bytes, SHA-256 `f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e`. `tauri build --no-bundle --ci` exited 0; all 458 tracked build-input hashes match before/after. `proof.json` records inputs, frontend assets, HEAD, concurrent documentation/test additions, and output identity. No installation package, runtime download, or UI acceptance is implied by the successful build.

P6 milestone02 production07 (`b909794f6d83b5e27a92e852f4c2b81d0b5630a336ca182b85f0bea310e26f94`, 23,138,400 bytes) is preserved but predates the full current source state. It is not the current P7 baseline.

## Space and isolated runtime

The initial overlay had 387,260,416 bytes available. Only rebuildable debug incremental cache moved to `/tmp/milkup-p7-rebuildable-cache/debug-incremental`: 520 files / 397,142,237 logical bytes, each file verified by size and SHA-256 before removal of the original cache copy and replacement by a symlink. `cache-relocation.json` retains the complete verification. `/tmp` is a separate filesystem. No evidence, profile, source, or unique binary was removed. After the build and frozen ELF copy, overlay available was 700,092,416 bytes; `/tmp` available 6,230,675,456 bytes (inventory timestamp).

Existing Xvfb :126 PID 22604 / birth 8044916 remains untouched. The authorized P7 Xvfb uses :127, PID 254857 / birth 10958947. The new driver process group is PID 255016 / birth 10961036; its tauri-driver child uses port 4477, WebKitWebDriver 4478. Readiness was `{ready:true,message:"No sessions"}`. No application session was started by this agent. Ownership and readiness are recorded under `../native-ui/control/`.

The driver reuses the existing bwrap namespace, GTK/WebKit sysroot, xdg-dbus-proxy layout and sandbox. XDG directories are unique and set before `dbus-run-session`; no sandbox-disabling option or library interposition was introduced. Starting this namespace went through normal automatic approval. Root owns subsequent UI and performance runs.

```bash
source /workspace/milkup-p7-quality-evidence/milestone01/native-ui/runtime/run-env.sh p7-baseline-input-01
# Run the approved native harness here; TAURI_APP_PATH and TAURI_DRIVER_URL are frozen.
```

Stop the owned driver with `python3 ../native-ui/runtime/driver-control.py stop p7-baseline-input-01`. Start a subsequent unique run with `python3 ../native-ui/runtime/driver-control.py start p7-<unique-run>` through the same normal namespace approval, then source `run-env.sh` with the identical run name. Driver start refuses existing profile/evidence/log/runtime paths. Xvfb ownership has a separate `xvfb-control.py stop`. Both controls verify PID birth; zombie state is recorded as not running, not claimed fully reaped. Do not manage unrelated PID1 zombies.

## Chinese system IME is blocked in this environment

`inventory.json` records the exact search roots and missing executables/modules. No `ibus-daemon`, `ibus-engine-libpinyin`, `ibus-engine-pinyin`, `fcitx`, `fcitx5`, or GTK3 `im-ibus.so` was found in the inspected system/cloud/cache roots. No IBus/Fcitx process is running. The historical `/workspace/.cache/milkup-ime-phase11` extraction is absent. Qt's ibus context plugin and IME icons do not provide a GTK input method daemon or Chinese engine.

The historical phase11 report records IBus/libpinyin extraction and a failed `SetGlobalEngine` attempt with a closed D-Bus connection. It did not establish a working candidate window or committed Chinese text. Its scripts depend on the now-missing cache and an older :99/proot environment, so they cannot be replayed unchanged or treated as prior success.

The existing Xvfb, xdotool, libX11, and libXtst permit actual XTest physical key events for ASCII input, shortcuts, selection, undo, save, caret and native window behavior. This is useful native input evidence. Clipboard Unicode, WebDriver Unicode actions, keyboard remapping and synthetic DOM `CompositionEvent` tests do **not** demonstrate a real system IME. They must be labeled separately.

A real Chinese IME run requires an installed daemon, Chinese engine and dictionary, GTK3 bridge, a shared X/D-Bus session, engine-ready confirmation and an actual candidate window. Then hardware-like pinyin key events can cover candidate selection, commit, Escape cancellation, replacing selection, blur, undo/redo, and Chinese punctuation. These prerequisites are absent and installing/downloading system packages is outside this task's authorization. The appropriate remaining route is an approved environment with those components already installed; neither security changes nor synthetic composition can close this acceptance item.

Related existing entries: `tests/helpers/native-production.mjs`, `tests/helpers/native-clipboard.mjs`, and `tests/native/x11-save-history.py` / `x11-windowed-blocks.py` / `x11-scroll-limits.py`. Root prepares and owns the new P7 harness; this audit does not claim those tests ran.

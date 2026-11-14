# Final Linux production/lifecycle execution preparation

Prepared only. No build, driver, browser or native test was launched. Root controls the exclusive CPU/UI gate; release_sdk currently owns the slot. No Windows build, upload, release, merge or product setting change is involved.

## Build gate and exact command

First root completes converter/public package preparation and full repository tests/types/build. Freeze/hash the approved source set and generated bundled plugin inputs before native compilation; retain `git status` and pre/post hashes. Do not silently rebuild stale plugin archives from a different source revision.

From `/workspace/milkup`:

```sh
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER PROOT_NO_SECCOMP
bash scripts/cloud/pnpm.sh --filter @milkup/desktop tauri build --bundles deb
```

The env sets the reviewed user-space sysroot, 3 Cargo jobs and Linux PNG icon override. CLI `--bundles deb` explicitly overrides repository's NSIS target, so this produces Linux only. Tauri beforeBuildCommand rebuilds the actual desktop Vite production assets; it is not a dev-server/profiling build. Record command, UTC start/end, exact exit code and raw stdout/stderr. Preserve any first failure.

Expected outputs: `apps/desktop/src-tauri/target/release/milkup-desktop` and `target/release/bundle/deb/milkup_2.0.0-beta.1_amd64.deb`. Copy the completed deb into a fresh external evidence directory and extract using `dpkg-deb -x` there; compare hash of extracted `/usr/bin/milkup-desktop` with the final post-bundling target binary. Tauri patches bundle type before bundling, so capture after build completion. Test the extracted binary, never the shared target.

Freeze: deb and binary hashes; exact release build OUT_DIR native extension bytes/hash (derive its build-script fingerprint/output, do not guess among old directories); bundled frontend contents/hashes; all Rust/C/JS native sources + Cargo manifests/lock/build.rs; production TS/core/view/plugin sources and SDK/package/archive inputs from root's full source manifest; harness/helpers/fixture; config/environment wrappers and exact WebKit header/runtime version. Verify embedded guard byte sequence in the actual app binary and source hashes again after freeze. Retain bodies externally, archive compact source/log/hash evidence. The new release guard is independent of earlier debug build03 provenance.

## Runtime prerequisites

- Explicit root GO and successful narrow namespace auto-review for driver launch, as in existing candidate10/11. Do not call the historical proot runner.
- Dedicated Xvfb display `:126`, 1600x1100x24, no TCP listener. Verify display/ports 4626 and 4627 are free before starting. The fixture host keeps WebKit's own sandbox enabled. No security or rendering settings change; LBSE stays default off.
- `run-env.sh` accepts RUN_NAME CASE FROZEN_BINARY EXPECTED_SHA256. Fresh names use `lifecycle-...`; each case has its own profile/log/output. It does not create the output directory, because the harness requires exclusive creation.
- `driver.sh` accepts the same arguments and uses the reviewed private user/mount namespace: read-only root/library overlay, read-only exact WebKit helper bind, existing workspace/tmp write access. No PID namespace, so the external observer can verify exact identities while the namespace/driver survives the verdict.
- Start the driver with a separately recorded owned session/PID. Wait for HTTP driver readiness, not an arbitrary sleep. Source the same env into the harness shell; verify diagnostics inheritance and log existence before invoking Node.

Example after authorization, using actual captured immutable path/hash (not placeholders in execution):

```sh
bash /workspace/milkup-mermaid-engine-evidence/editor-lifecycle-preparation-02/driver.sh lifecycle-timeout-01 timeout FROZEN_BINARY SHA256
```

Separate harness process from repo root:

```sh
source /workspace/milkup-mermaid-engine-evidence/editor-lifecycle-preparation-02/run-env.sh lifecycle-timeout-01 timeout FROZEN_BINARY SHA256
node tests/native/tauri-dom-plugin-lifecycle.mjs
```

Run sequentially with new names/profiles: timeout, disable, remove, wm-close, app-sigkill. A failed case is recorded and reported; no automatic retry or weakened assertions. Stop only the exact owned driver/display sessions after the case verdict and separate process audit. Do not use driver/namespace teardown as product cleanup evidence.

## Assertions and attribution

The harness already calls `startProduction(..., { diagnostics: false })`, so it does not monkeypatch Worker. It uses observation-only page listeners/MutationObserver/timers, with their overhead explicitly recorded, and real XTest keyboard/pointer operations. Public picker/approval/enable/disable/remove paths only. The separate process observer identifies the real App and one fixture guardian by exact argv/birth, requires real WebKit CPU growth, and remains alive for App SIGKILL. Timeout correlates the original native request before source-version cancellation, requiring the unchanged two-second deadline and cleanup before timeout notification. Saved bytes and input-to-two-rAF target are checked. Full product lifecycle runtime remains unverified until these fresh runs occur.

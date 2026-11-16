# Corrected-archive current-source gate: missing MPEG-TS SDK

Run https://github.com/Auto-Plugin/milkup/actions/runs/43847602183 tested **0a5d233deb2eb6433580b8a10d4f4beb2c64f36f**. Job began 2026-11-16 10:18:10 UTC, completed failure at 10:21:14 UTC (3m4s). The 30-minute deadline was 10:48:10 UTC; no timeout or automatic retry occurred. Driver elapsed 175.549 seconds.

Original artifact **14216480888**, 53,778 bytes, SHA-256 **2d16119335eecd736de6c84e915c2d696d052d639e9f3f06a4145d2af9de0fd3**, is retained unchanged as `original.zip`. ZIP and SHA verified. GitHub expiry is 2026-11-23 10:21:09 UTC. `result.json`, `configure-command.json`, and `configure.log` are exact readable copies.

## Progress actually made

- Eleven remote non-engine preflight tests passed. Only this operation ran; old engine/stock/pagination jobs were skipped.
- Official Ubuntu SDK dependency simulation and installation passed. No old object cache restore or full engine target.
- Official **2.54.2** archive SHA verified; the exact duplicate-pair parser succeeded; full source extracted in 12.093 seconds.
- Normal-path patch check/application succeeded and every changed source matched locked output hashes. Patch SHA remains `855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5`.
- CMake ran against the final QA prefix, release/non-developer GTK3 recipe, with default sandbox and hardening settings. It found GTK3.24.52, GTK Unix printing, Soup3 and other dependencies. These are configure-log findings, **not a completed generated-config/ABI gate**.

## Earliest failure

After 48.246 seconds of configure:

```
Could NOT find GStreamer (missing: GSTREAMER_MPEGTS_LIBRARIES)
(found suitable version "1.28.2", minimum required is "1.18.4")
```

The exact source's `GStreamerChecks.cmake` requires `video mpegts tag gl` when ENABLE_VIDEO is enabled. The Ubuntu 2.52.6 build-dependency set plus our explicit SDK list had base/extra runtime libraries but omitted **libgstreamer-plugins-bad1.0-dev**. This is a dependency declaration gap in the new current-source QA workflow, not a compiler failure or product/native-PDF behavior result. `gstreamer-full`, codecparser/transcoder and WebRTC discovery messages are also retained; the fatal required item was MPEGTS. No video/MPEGTS option was disabled to continue.

Source checks are retained in three original CMake files and `gstreamer-source-lock.json`, fetched from the same full hash-verified official archive. [Ubuntu's package/file listing](https://packages.ubuntu.com/resolute/all/libgstreamer-plugins-bad1.0-dev/filelist) identifies the development package. Direct inspection of the official HTTPS amd64 deb independently confirmed `gstreamer-mpegts-1.0.pc`, MPEG-TS headers and `libgstmpegts-1.0.so` link entry. Version 1.28.2-1ubuntu1.2, 238,594 bytes, SHA `cec79245c9a33b742ca98417adc97836e3f57be9665b210ce73387f148b93df3`; URL/control/contents are in `mpegts-sdk-inspection.json`. The deb was inspected, not installed or executed locally. Future CI uses authenticated APT resolution rather than this downloaded sample.

## Local correction, not remotely verified

The workflow now explicitly requests that SDK package, retaining the original simulation/no-removal/no-system-WebKit-change gates. A pkg-config prerequisite checks every required core/video/audio GStreamer module before source work. No feature, sandbox, source hash, final prefix or behavior threshold changed.

An actual local pkg-config test reproduces the missing-module failure, then parses the unmodified official MPEGTS `.pc` with controlled core/base metadata dependencies; it still rejects an old or missing base dependency. This proves metadata wiring only, **not native linking or installation**. All **27 local tests pass**.

Tool paths/hashes/version output will now be retained before configure: this run's error path showed the runner's PATH selected CMake4.4 while the installed APT package was CMake4.2.3. No claim is made that this caused the failure. The selected tool is not silently replaced. Failed configurations will also retain any existing CMakeCache/configure diagnostics; the old path copied those only after configure success.

## Still not executed

CMake did not finish. Actual generated ABI/printing/sandbox checks, header generation, real modified TUs, complete graph, engine, final-path package, installed mappings and PDF/IME/editor/upgrade/recovery/uninstall remain **unexecuted**. No completed objects or reusable object archive. Resource limits were not the cause (initial free disk 95,284,293,632 bytes; four CPUs; 16,077,544 KiB total memory).

Exactly one run was dispatched in this continuation; none is still running and no corrected follow-up was dispatched. The dependency fix is ready for a separately bounded continuation of the same gate. The prior research 15/15 result remains separate, not inherited by this normal/current runtime. No main merge, release, upstream post, production configuration, notifications or security-policy changes.

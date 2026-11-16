# Current-source TU gate 43849878532: real configuration passed, first TU blocked by missing PCH

- Candidate: `68ed9169ec7cbd21a6fd9c627af423996ddfef7b`; operation `current-source-preflight`.
- Unique run: https://github.com/Auto-Plugin/milkup/actions/runs/43849878532 . Deduplication returned no queued/in-progress runs before dispatch. No second run was dispatched.
- Job ran 2026-11-16 10:33:16–10:39:37 UTC (6m21s), failed. Job hard limit 30 minutes; work limit 1,560 seconds; no stage timeout fired.
- Artifact: https://github.com/Auto-Plugin/milkup/actions/runs/43849878532/artifacts/14217810649 . 6,264,839 bytes, SHA-256 `b947f81665d6d1712e00a09adab3d8dcc493b882607265b2997b1f741d1e38b8`, expires 2026-11-23 10:39:33 UTC. The exact ZIP is retained here, including all original graph, commands, logs and failure receipts; no signed download URL retained.

## Actual completed work

Local audit compared 229 official-source CMake inputs with prior real discoveries and SDK inventory. The fixed MPEGTS SDK and additional downstream metadata checks all passed on this runner. GStreamer required modules all 1.28.2; Fontconfig 2.17.1, Expat 2.7.4, WebP mux 1.5.0, sysprof-capture 50.0. Actual CMake is 4.4.5 and Clang is 21.1.8, with resolved tool hashes in the receipt.

Official 2.54.2 archive SHA `a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065` and all 22 patched-file hashes passed. The normal-path patch SHA remains `855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5`.

CMake completed in 42.653 seconds. Actual generated config confirms API 4.1, ENABLE_2022_GLIB_API=0, ENABLE_DEVELOPER_MODE=0, ENABLE_BUBBLEWRAP_SANDBOX=1, HAVE_GTK_UNIX_PRINTING=1; all requested settings consumed. The configured final prefix remains `/opt/milkup/runtime-qa/webkitgtk-2.54.2-855e58cc8ad531cc`. No runtime was installed or executed, so configured sandbox is not a live process sandbox claim.

The inspected header graph executed 5,746 commands plus one allowed glob check, in 10.612 seconds; XML/XLink/XMLNS exact generators also passed. 2,785 generated-header hashes retained. All ten changed CPP files uniquely mapped to ten actual unified translation units. No full-engine target, old cache, or runtime install was invoked.

## Earliest failure and secondary retention error

First actual command `compile-FontCascade` exited 1 in 0.064 seconds:

```
error: unable to read PCH file .../Source/WebCore/CMakeFiles/WebCore.dir/cmake_pch.hxx.pch: 'No such file or directory'
fatal error: PCH file '.../cmake_pch.hxx.pch' not found: module file not found
```

This is a missing configured compile prerequisite in the narrow harness, not an observed C++ behavior error. The normal Release configuration uses PCH. The wrapper generated ordinary headers but skipped PCH compilation before invoking the unchanged TU command. Actual compile DB proves the ten selected units reference exactly **two** PCH producers (`WebCore.dir`, `WebCoreStyle.dir`), out of 20 in the complete database. No selected TU completed, and no reusable object was produced. Remaining nine TU commands, full engine, installation, process mappings and native PDF were not executed.

Independent final-retention error: `Configuration evidence budget exceeded`. `build.ninja` is 48,696,643 bytes and `compile_commands.json` is 38,998,330 bytes, exceeding the old 32 MiB per-file limit. Both had already been copied and are fully present in the verified original ZIP. The secondary exception left `elapsedSeconds` and `objectRetention` unset in the original receipt; do not rewrite that receipt to claim success or objects.

## Local correction prepared, not remotely executed

The harness now resolves only the selected commands' exact PCH references against the actual compile DB, rejects missing/duplicate/foreign/nested producers, and invokes each exact Ninja compiler command directly before the objects. Original flags, PCH use and strict warnings are preserved. No umbrella Ninja object target is used, no PCH is disabled, and no other engine PCH is compiled. PCH inputs, commands and hashes are retained; PCH binaries are explicitly not archived. Same stage/work limits apply.

Large configuration files use ordered lossless gzip parts, each at most 32 MiB raw, with per-part and full-file lengths/SHA-256; aggregate configuration input is capped at 128 MiB. Small files remain raw. Independent replay on the **actual two files from this artifact** restored exact hashes and all bytes: Ninja two parts/2,976,705 compressed bytes; compile DB two parts/2,346,992 compressed bytes. Original files remain in original.zip. Truncation, growth and budget failures remain failures, and compiler failure status is not overwritten by successful retention.

30 local tests passed, including this real compile DB/graph replay and negative producer/flags cases. This verifies selection and retention, **not actual PCH compilation or normal-path TU success**. No product patch, final profile, security policy or release input changed. A next explicitly bounded native TU gate is still necessary; none started automatically.

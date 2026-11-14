# Final-format native backend checkpoint

The generic Linux backend implementation is ready for review. This is a native implementation/mechanism checkpoint, not complete product acceptance.

`provenance.json` freezes 13 source files and three binaries. `post-run-check.json` confirms current sources/binaries matched all frozen hashes after native03. Binary bodies remain external in `bin/`; the archive manifest deliberately excludes them. Executable SHA256: `669a6695eebd22e1473e222827fd9b3191b0c1799b47b194800f7891cc472ae3`.

Every command has an exact argument array, UTC and monotonic start/end, exit code, and original raw log. Execution order:

1. `rustfmt-first-check`: owned Rust files only, `skip_children=true`; first check passed, no Rust files changed.
2. `prettier-first-check`: first check failed on bootstrap.js and bootstrap.test.mjs only; original failure retained.
3. `prettier-write`, `prettier-final-check`: formatted those two files and verified success.
4. `bootstrap-tests`: four Node VM/bootstrap protocol tests passed; this log is saved, unlike the previous historical console-only run.
5. `test-build`, `build`: rebuilt test binary and application offline, both passed. Existing unrelated piece_tree.rs unused Arc warning remains.
6. `freeze-build03.py`: copied exact source and binaries before runtime execution. Only the two JS sources and embedded application binary differ from frozen02. Other Rust/native sources, native guard and test binary hashes are unchanged.
7. `native-03`: first actual native attempt passed (exit 0) for default module activation, genuine Unicode bbox, exact native resource guard, denied network/file fetch, global alias tampering, synchronous loop deadline and full observed descendant cleanup. No runtime retry occurred.

Relative to native dispatch, the deadline was observed at 2.000178438 s; guardian SIGKILL started at 2.000545009 s; guardian cleanup reached ECHILD at 2.016063793 s; the app confirmed cleanup at 2.020809078 s; trusted timeout control emitted at 2.020903628 s and was received at 2.021034034 s. Raw trace print order can lag event receipt because diagnostics use a separate bounded logger; use embedded CLOCK_MONOTONIC values, not text ordering.

Frozen02 retains the separate actual busy-WebKit parent-SIGKILL first PASS and 14 direct Rust unit passes, including the shared guardian escaped-child fixture. Guardian/Rust code did not change for formatting; parent-SIGKILL was not needlessly rerun. The original native01 complete source snapshot was not retained; its historical logs/hashes do not masquerade as a reproducible snapshot. Frozen02 and frozen03 close that gap for their exact tested code.

Full editor UI responsiveness, disable/uninstall workflows and plugin renderer integration remain separate acceptance work. Linux runtime retained the native WebKit sandbox; its narrow cloud wrapper is not automatically a shipped confinement boundary. Windows/macOS report backend unavailable. See frozen02 README for the complete lease/idle-CPU/platform evidence limits.

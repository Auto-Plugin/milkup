# Next package binding: exact engine retained, application not yet built

This is an executable-input review, not native evidence or release approval.
The final-prefix host preflight 43947952662 is the only current run. No new
application or engine job is dispatched by this document.

## Fixed inputs

- Application source: `546796b005390642ee5cc655440b4b350a730717` (external reload
  fix included); do not build the research harness branch as the application.
- Runtime/patch/prefix and original bytes: `RUNTIME-INTAKE.md`.
- Runtime archive contains seven needed ELF components, their declared SONAME
  chains, locale/typelib resources and SDK files. It contains no Milkup binary,
  frontend assets or application guard. It has no installed license notices.
- The ordinary package builder at that product SHA declares
  `system-webkitgtk-4.1` and deb dependencies `libwebkit2gtk-4.1-0`, `libgtk-3-0`.
  Reusing that receipt unchanged would misidentify a final-prefix candidate.
  Do not remove the system dependency from an old binary and assume rebinding.

## Necessary separate candidate build, without engine recompilation

1. Verify the exact product tree and its lockfiles/configuration. Keep
   `release/update-channel.json`, updater keys/endpoints, package version and
   all trusted plugin seals unchanged. Existing `prepare-bundled-plugins.mjs`
   must run, with its reviewed dependency closure and exact manifest hashes.
2. Use the CMake-installed SDK from this actual artifact for API4.1 headers and
   pkg-config data in the controlled build workspace. Reject pkg-config output
   pointing to system WebKit/JSC; the expected prefix/library/include paths must
   match the approved final prefix. Preserve source SDK hashes. This is a build
   input, never a runtime `LD_LIBRARY_PATH` or `WEBKIT_EXEC_PATH` workaround.
3. Link the application at the final absolute runtime path, preserving hardening
   and default production Tauri frontend preparation. Verify actual ELF NEEDED,
   Build ID, final RPATH, and exact binary hash. Do not relabel an old binary.
4. `apps/desktop/src-tauri/build.rs` separately compiles `plugin_dom_guard.c`
   and `output_guard.c` using `webkit2gtk-web-extension-4.1` pkg-config. Their
   bytes are embedded by include_bytes; their build inputs/hashes and API must
   also be bound. The Rust flags alone do not cover these C compiler invocations.
   Native output must still prove the app-owned guard in the real WebProcess.
5. Flatten only the two authenticated SONAME chains into real SONAME files;
   preserve byte hashes and 0644 library modes, and 0755 helper/driver/app modes.
   The stage gate already verifies origin paths and explicit CMake exclusions.
   Add actual app resource inventory, notices and a genuine build-derived SBOM.
6. Produce a distinct unsigned QA deb, with no replacement of system WebKit or
   global loader configuration. Its control dependencies come from the measured
   host ABI closure, not an invented minimum distribution. Use existing strict
   stage, archive and ordinary-user installed gates before launching anything.
7. On the same supported host, verify actual application/helper/driver process
   birth identity, mapped private libraries and unchanged default sandbox.
   Reuse native PDF entry/guard and all 15 behavior cases; include code-wrap,
   external reload and #255 on that exact package. #94 has no supported language
   switch at this source and remains not applicable, not a fabricated test.

## Explicitly open gates

The source notice corpus is retained, but static/header-only dependencies,
expanded UnifiedSource constituents, Rust/JS closure and applicable notices
still need a complete inventory. A conservative source notice bundle does not
satisfy the existing `complete-build-derived` SBOM assertion. Host readelf
closure does not prove runtime dlopen, sandbox mappings or PDF behavior.
Final package install/upgrade/recovery/uninstall and maintenance ownership
remain open. No additional CI is justified until these inputs can be validated
without weakening the existing gates.

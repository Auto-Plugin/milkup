# Local package boundary review — no shipping runtime yet

This records exact-source constraints found while the combined gate was pending.
It is not a decision to bundle WebKit, a product loader change or authorization
to ship. The combined fifteen-case gate has not completed. The preferred route
remains a maintained distribution backport, with the ordinary installed product
retested against that actual distribution runtime and later security updates.

`package-boundary-source.json` binds the reviewed 2.52.6 source files and actual
43829429928 CMake cache paths. These are facts about the research build, not an
assertion that a current supported distro already includes the fixes.

## Concrete reasons the research prefix cannot be copied into a package

1. `PlatformGTK.cmake` defines `PKGLIBEXECDIR` and `PKGLIBDIR` from installation
   directories. The retained build embeds `/home/runner/work/_temp/.../prefix`,
   including its libexec directory. Relocating just its `.so` files does not
   relocate child executables and injected bundle resources.
2. `ProcessExecutablePathGLib.cpp::findWebKitProcess` uses the compiled
   `PKGLIBEXECDIR` outside developer mode. `WEBKIT_EXEC_PATH` and sibling-process
   lookup are inside `ENABLE(DEVELOPER_MODE)`. Enabling developer mode to make
   relocation convenient is not an acceptable shipping solution. A real
   candidate must explicitly prove the generated non-developer configuration;
   a `Release` label by itself is insufficient.
3. `WebKitWebContext.cpp::injectedBundleDirectory` separately accepts
   `WEBKIT_INJECTED_BUNDLE_PATH`, or falls back to compiled `PKGLIBDIR` plus
   `injected-bundle`. The injection family must be checked too; matching only
   WebKit and JavaScriptCore SONAMEs is insufficient. No such environment
   override was introduced by this review.
4. `BubblewrapLauncher.cpp` already read-only binds compiled `LIBDIR` and
   `PKGLIBEXECDIR`, plus standard library directories. It also handles
   `LD_LIBRARY_PATH`. The current research loader override explains a test
   setup, not a production package boundary. The supported candidate must use
   its real final locations and retain the existing sandbox, without new broad
   binds, disabled sandbox, modified host loader cache or global environment.

## Reviewable candidate boundary if a distro backport is unavailable

Before any product implementation, specify a single installation-owned,
versioned final prefix under the application's package ownership. Build at
that exact prefix (stage with the normal packaging mechanism); do not reuse
the CI temporary-prefix binaries as the candidate. Include the matching
WebKit/JavaScriptCore, child executables, injected bundle and official installed
runtime resources as one versioned family. Keep development headers and
research logs/fixtures outside the runtime payload. Derive the actual resource
set from the maintained release's install manifest and runtime loads, not the
six ELF records from this experiment alone.

The candidate's local review record must bind:

- maintained upstream/distribution source version and authenticated source
  digest, minimal production patch preimages/digests, compiler/ABI/build inputs;
- official install-manifest paths, ELF SONAME/NEEDED/RPATH/RUNPATH, build IDs,
  hashes, symlinks and ownership/modes of each family member and resource;
- supported distribution/architecture dependencies, licenses/source notices
  and dependency inventory; OS libraries are not silently frozen into the app;
- the owner/process for following WebKit security advisories, supported update
  cadence and a stop-shipping rule when a safe maintained rebase is absent;
- exact package revision, installed version/family identity and recovery
  semantics. A previous package retained for manual recovery is not automatic
  rollback and must not be described as such.

Loading should be proven with the actual installed application and child
ancestry/maps, without a QA `LD_LIBRARY_PATH` or developer executable fallback.
The exact loader design remains to be implemented and reviewed; this document
does not claim RUNPATH alone solves transitive dependency/resource resolution.
The current checkout's `apps/desktop/src-tauri/src/output_linux.rs` passes
`std::env::current_exe()` into the output launch path, so selecting a different
runtime for that application binary cannot be assumed to affect only PDF.
An actual delivery candidate must also verify the normal Tauri editor WebView,
plugin loading, editing/IME and normal exit under its selected runtime family.
This is a boundary requirement for that future candidate, not a new CI matrix
or a claim that the current PDF-helper run covers the editor.
Any own-process environment handling must prevent incompatible injected-bundle
selection while preserving supported application behavior, and be tested rather
than changing global user/system settings. A writable or mixed runtime family,
wrong build identity, missing helper/resource or unsupported ABI must produce
a visible failure, not silent fallback to an untested engine.

## Required product evidence, not yet obtained

Use only a synthetic isolated installation to validate package contents and
ownership, ordinary user launch, original PDF/print entry and all fifteen
combined contracts with default sandbox. Then verify the same behavior after
a maintained security-version rebase, package update/failure/recovery and
normal removal, without touching user documents or system WebKit. Record the
actual package hashes and family mappings on each supported target.

First extract and review non-diagnostic production patches. The current URI
dedup remains fixture/environment gated; source transport includes research
negative controls, and pagination patches contain observers. Those cannot enter
the payload as-is. No general complex-text, manual clipboard/click, internal
destination, physical-print or other release claim is implied by this design.

No new runtime package, wrapper, source download, security setting, dependency
installation, test endpoint, release configuration or external issue/PR was
created in this local review. Existing shipping standards and feature/output
promises are unchanged.

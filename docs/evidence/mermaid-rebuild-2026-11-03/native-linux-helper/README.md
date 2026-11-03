The fixed Linux native helper rendered, decoded and retained all 50 fixtures at
candidate `688fc89aad6c6b4b54cdec87ffa66179e5dd0def`. This exercises the same
registry/backend used by the desktop command, through a native Rust test entry.
It does **not** establish that all 50 diagrams passed through the editor UI.
Per-image SHA-256 and source SHA-256 values are in `corpus/provenance.json`.
The source corpus is pinned to prototype commit
`ea5ebcc69d83a6c8eecf4edc73aabd6445b8dac4`.

`linux-helper-unit-final.log` records four passing conversion, framing and
checked-cleanup tests. `linux-helper-native-cancel-final.log` records cancellation
followed by another render; each guardian reports `cleanup-complete` only after
its existing ownership loop observes `ECHILD`. The backend additionally confirms
guardian exit and checks removal of its owned extension directory before
publishing an image. The 50-case log has 50 confirmed guardian exits and 50
checked directory removals. It retains 49 of the guardian's asynchronous,
best-effort `cleanup-complete` trace messages; the missing trace is not counted
as an additional recorded event. Denied removal is tested through an injected PermissionDenied result;
NotFound is accepted as already cleaned. Cleanup failures stop further native
launches and retain the owned path in the error.

The actual desktop binary was built with `tauri/custom-protocol` so it embeds
the production frontend. Its SHA-256 is
`01487ea1f1fcf22f6c9557b7e0c85d14bd93942d9bbc26c30ace8e6fce5af746`.
`final-native-build-provenance.json` records the binary, frontend, bootstrap,
official Mermaid bundle and installed WebKitGTK 2.52.6 hashes. The Rust test
binary hash is recorded separately in `corpus/provenance.json`.

This new environment stores its installed WebKit runtime in a sysroot. The
execution wrapper's read-only user-namespace map initially blocked WebKit's own
sandbox, and the initial proot runner did not expose WebKit's hard-coded dbus
proxy path inside that sandbox. Tool-approved execution used a temporary mount
namespace to map the existing runtime, loader and proxy files to their expected
paths. `run-native-mounted.sh` records the mapping. The system installation was
unchanged; no old Windows Fixed Runtime was used. WebKit sandboxing stayed
enabled throughout, with the native three-resource request guard unchanged.

Two product integration defects were discovered and repaired by the native test:
the custom-scheme response lost its JavaScript MIME type when response headers
were replaced, causing `nosniff` to reject the fixed bootstrap; and WebKit could
not serialize the Promise returned by the asynchronous dispatch callback.
The retained diagnostic/MIME logs show those failures before the fix. Dispatch
now returns an inert boolean, and completion still arrives through the bounded
JavaScript data queue. Startup failure reports a fixed error instead of silently
waiting for the full deadline. Diagnostics contain phases and opaque request
identities, not document text.

The 50 images use the light/default theme, width request 1280 and native scale
100%. Full dark-theme/DPI/editor-interaction coverage is separate work. The
wide fixture retains a natural 3528×102 image; the editor's horizontal-scroll
behavior requires its own UI evidence. C4, CJK and wide images received an
initial visual spot check; the complete visual review is recorded separately.
The Linux guardian and WebKit sandbox do not provide the Windows Job Object
hard memory limit. Resource filtering is not a claim of OS-wide network denial
or immunity to browser vulnerabilities.

Only the test-owned `:143` display was stopped after this run. The temporary
runtime overlay was retained for the separate product UI test, which uses its
own display/profile/processes. No original offline instance was modified.

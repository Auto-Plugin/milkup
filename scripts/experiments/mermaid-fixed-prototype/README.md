# Fixed Mermaid 12.2.0 Windows prototype candidate

This is an isolated, reviewable experiment based on `b7f9cdecfc02c2f0710fc9d6b71c12419364e644`, on branch `dot/milkup-v2-mermaid-prototype`. It is not linked into Milk up, a plugin distribution, or a release package. The user approved a bounded independent fixed-renderer experiment, including the explicitly disclosed residual network risk. No Windows execution, workflow installation, CI run, installer, elevation, account change, Runtime installation, firewall change, or product gate change occurred while preparing this candidate.

## Exact implementation

`run-reviewed-windows.ps1` verifies the isolated branch/source scope, existing Runtime, compiler and fixed engine. It may fetch only the existing exact Cargo lockfile build packages; compilation/tests then run offline. It does not install a toolchain, Node packages, browser or WebView2 Runtime. `proposed-windows-workflow.patch` is an unapplied review artifact, not an active workflow.

The standalone executable's parent reads reviewed diagram fixture text, verifies its SHA-256, and sends a bounded JSON data request. The helper never reads a plugin package or accepts JavaScript, HTML, module paths, URLs to load as code, arbitrary configuration, CDP commands, file paths or a native command proxy. The fixed appearance presets are `classic` and `neo`; source frontmatter/init cannot replace secured engine configuration.

The only browser program is the unmodified official `mermaid@12.2.0/dist/mermaid.min.js`, followed by the reviewed fixed bootstrap. The official bytes are staged in `assets/` and embedded in the executable. `build.rs` rejects any engine length/digest mismatch. The MIT license and upstream embedded notices are retained. Local `.gitattributes` prevents Windows checkout newline conversion of pinned engine/fixture bytes.

`launcher.rs` creates a fresh zero-capability AppContainer and binds the helper to a Job at process creation. The Job retains the product's 512 MiB committed-memory and 16-process limits, kill-on-close and no breakaway. The execution subtree is read/execute only for the AppContainer; only its sibling state/UDF subtree is writable. Source and private executable copies are byte-compared and held open without write/delete sharing. Reparse paths are rejected. Temporary impersonation of the already-created child token performs read-only access-open checks on code ancestors; it does not adjust token privileges. Unprovable access denial fails closed.

Helper preparation has a 10-second deadline after resume. After ready and browser ownership checks, the parent enforces a 2-second deadline for input delivery, official render, frame wait, screenshot and result delivery. **This is not an end-to-end 2-second host deadline**: private setup, token/ownership evidence, host PNG validation, evidence writes and cleanup are separate. Cleanup has bounded Job and IPC waits; uncertain cleanup stops the matrix after saving the current case. No retry uses an ordinary helper, broader ACL, changed policy or weaker Job.

The helper uses direct WebView2 COM without initializing Tauri, host objects, DevTools protocols or application IPC. Its two in-memory routes are an exact private-origin index and fixed script. CSP, all-source WebResourceRequested filtering, navigation/frame cancellation, SourceChanged checks, external-scheme cancellation, new-window/download denial and permission denial are installed before navigation. Failure to install an essential deny operation sends a bounded fatal frame and exits, allowing the parent to terminate the entire Job. Browser policy controls are not an OS all-network firewall.

The native parent verifies the actual browser PID belongs to its Job before releasing diagram text. Helper, suspended child and browser must report AppContainer, zero capabilities, not elevated and no SeDebugPrivilege. Host token membership, elevation and SeDebugPrivilege are only observed. An administrator CI host never becomes standard-user evidence because of this test; no account or token is changed to make that result pass.

`CapturePreview(PNG)` writes into a bounded IStream. Total helper ready/result framing, metadata and PNG are at most 256 KiB. Each axis is at most 8192 pixels; aggregate image pixels are at most 16,777,216. The parent checks PNG signature, bounded complete chunk framing, CRCs, a single zero-length terminal IEND at exact EOF, no APNG, dimensions and full bounded decoding. It rejects uniform screenshots. Pixel inspection does not allocate a second RGBA image. The decoder's 64 MiB allocation setting is **not a hard limit on the entire parent process**, and the stream cap does not bound WebView2 allocations before its Write calls. Job memory evidence and real screenshot working set remain Windows validation items.

## Corpus and actual preparation evidence

The positive manifest contains 50 examples: all 37 built-in registration IDs plus selected HTML-label, Markdown-label, MathML, CJK, width/height, nested-graph, neo and C4 variants. This is not exhaustive coverage of every grammar production or configuration combination. ZenUML/external diagram plugins, external icon packs, arbitrary document configuration, remote assets and interactive links are outside the fixed static service contract.

The five negative/security fixtures cover unknown grammar, a long valid graph expected to exceed geometry limits, HTTPS links, a `javascript:` URI as inert diagram data and an external-image observation. Unknown/oversized-geometry success requires the exact expected original renderer error and complete cleanup; startup failure or timeout cannot substitute. Link fixtures inspect removal of active links/executable elements but do not click links or prove an attempted navigation was blocked. The fifth fixture is explicitly observation-only with no presumed outcome. It is recorded with a separate observation status and zero accepted assertions, neither passing nor failing an unasserted semantic expectation. Actual ownership/cleanup/control failures still fail the run. The summaries distinguish 50 positive assertions, four asserted negative/security cases and one observation.

Completed locally using existing dependencies:

- The exact official ESM and selected UMD each parsed all 50 positive fixtures with expected registration IDs. An invalid-grammar control was rejected. See `fixtures/parser-validation-*.json`.
- The same UMD matched all five negative parser expectations. These checks did not render geometry, start a browser, attempt navigation/network, or test Windows isolation. See `fixtures-negative/parser-validation.json`.
- Windows MSVC-target offline `cargo check --locked` passed for the final candidate; this is type checking, not linking/running Windows. See `evidence/windows-target-check.log.txt`.
- Four trusted Rust tests passed on Linux: strict data input, complete PNG/decode negative cases with synchronized lengths, actual matrix scheduling that saves a cleanup failure then refuses to launch a subsequent helper, and neutral observation accounting that still fails broken controls. See `evidence/offline-tests.log.txt`.
- Script syntax, fixture/bundle hashes, existing lockfile provenance, patch applicability and formatting are recorded in `evidence/preparation-audit.json`.

## Windows execution scope proposed for review

The proposed job uses the existing `windows-2025` runner, repository `Auto-Plugin/milkup`, this exact prototype branch, an explicit `[mermaid-fixed-prototype]` marker, first attempt only, and `contents: read`. Checkout uses the triggering SHA with credentials disabled. It runs 50 positive cases; only if these succeed does it run the five negative/security observations. No product integration or release job is involved.

The job may download the already-locked public Cargo build sources, then builds offline. Existing compiler and WebView2 are mandatory; absence is a blocker, with no installation fallback. The helper does not inherit `WEBVIEW2_*` overrides, credentials or the host profile. AppContainer/profile and ACL work is limited to its newly created identities/private tree. It does not change existing Runtime/application/system directory ACLs or network settings. An unavailable API, nonowned browser PID, unexpected helper/browser token, failed ACL proof or unverified cleanup stays a failure.

Only synthetic PNGs and JSON/text audit records from a uniquely created evidence root are uploaded. The artifact gate recognizes only that successful creation marker, rejects root/subdirectory/file reparse points and unexpected extensions, and caps the upload at 256 MiB with one-day retention. It does not upload the executable, installer, UDF or arbitrary temporary files.

Current blockers are actual Windows execution and evidence, not a new permission request: hidden-window rendering may produce blank/old frames; geometry measurement does not prove all filter/negative-coordinate ink is included; the 2-second/512 MiB limits may reject complex diagrams; all 37 registrations have not yet been visually captured. Real standard-user behavior is also unverified. No result here establishes OS all-network denial after a renderer/browser exploit; the previously observed UDP/WebRTC gap remains explicitly outside this guarantee.

## Size and integration boundary

The exact full official script is **5,494,801 bytes** (SHA-256 `a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`). Gzip level 9 with mtime 0 is **1,566,718 bytes**, only a script compression reference. Actual Windows helper executable size/hash is recorded by the proposed job after linking; neither figure is an NSIS/package increment measurement.

The product has no host-owned raster output/asset lease contract yet. This prototype deliberately adds no SDK, renderer capability, editor raster integration, export integration or Windows DOM/PDF gate change. Even a successful prototype would require a separate integration decision and end-to-end product acceptance before inclusion in a release.

# Output candidate, 2026-11-12

**Status: partial implementation, NOT release acceptance.** Baseline is
`ef221deb1bde9b56b6bc5faf09105d5bcbd059d7` (beta.10). This change does not
publish a release, replace the editor or alter Mermaid plugin modes.

## Root causes and changes

Windows was not merely missing a menu: `output_windows_picker.rs` rejected PDF
leases, and `output.rs::render` rejected every non-Linux PDF/print request.
The candidate connects Windows PDF selection and rendering to the existing
host-owned lease/publication path. The new renderer uses **the installed
Evergreen WebView2**, already a desktop dependency, through
`ICoreWebView2_16::PrintToPdfStream`. It does not install a browser or add a
separate Chromium dependency.

The renderer is a separate static-document helper. The host assigns its
kill-on-close Windows Job before supplying HTML. The helper has no destination
path, Tauri invocation bridge or plugin loader. Browser scripts, permissions,
new windows, downloads, frame navigation and external protocol launches are
blocked. Only a fixed custom-scheme document is served, with a deny-by-default
resource handler and CSP; data images are allowed. PDF bytes are bounded to
64 MiB and the operation has a 90-second deadline. Both pipe directions run off
the cancellation polling thread. Private browser state is created with a
protected owner/SYSTEM ACL and cleaned after process-tree termination. The
existing output target guards, source identity checks and atomic publication
remain authoritative. A4/Letter, portrait/landscape and background printing use
WebView2 print settings. Native render correctness still needs the gate below.

## Checks performed here

- Rust 1.99.0 rustfmt and `git diff --check`: passed.
- Isolated Windows GNU-target type-check of the new module and its tests,
  using the same pinned `windows`/`webview2-com` crates: passed. Host lease types
  were stubbed in that external checking harness, so this is **not** a desktop
  build, test execution, linking, or runtime result.
- Full desktop Windows cross-check: **blocked** while building a dependency,
  because `x86_64-w64-mingw32-gcc` is absent. No full build pass is claimed.
- Windows native tests and GUI: **not run on this Linux executor**.
- Linux native output: **not run**; no GTK/WebKit pkg-config installation here.

## Native gate to run on the exact integrated Windows candidate

```powershell
pwsh -File tests/native/windows-pdf-backend.ps1 -EvidenceDirectory C:\new-output-evidence
```

The gate preserves logs and exact candidate identity, runs actual Windows
output contracts, and explicitly runs the ignored installed-WebView2 PDF test.
That test exports A4 and Letter landscape documents and checks that document
network requests do not reach a controlled localhost listener. It retains PDFs
for independent text extraction, page geometry and all-page pixel inspection.
A PDF header/byte check is intentionally **not** a Unicode or layout pass.

Before delivery, also run actual GUI export with the installed application:
HTML regression; A4 and Letter, portrait and landscape; Chinese, emoji, quotes,
combining sequences, diagrams, images and long blocks; cancelled picker;
existing output confirmed/rejected; source/hardlink conflict; rapid repeat;
abort during engine startup and rendering; close/plugin disable; helper and
profile cleanup; and both ordinary/admin accounts. Preserve original failure
logs, source hashes, executable identity and final PDF hashes. Do not treat the
native helper-only fixture as a substitute for that acceptance.

## Still open, not hidden by this patch

1. **Windows printing remains unavailable.** `ShowPrintUI` returns without a
   print-completed/cancelled result. Calling it and returning `printed` would
   falsely report success and allow lease cleanup to kill an active dialog.
   A real owned native selection/submission lifecycle must be implemented and
   verified, including cancel, queue failure and safe file-printer destinations.
2. **Linux PDF text/copy/search and long-block pagination are not repaired.**
   The prior user decision is to keep existing dependencies and pursue a WebKit
   patch, not add system Chromium or bundle a large private engine. See
   [the preserved analysis](../../v2-product-phase5-webkit-repair-2026-10-19.md)
   and its linked WebKit build/ABI/distribution evidence. There is still no
   verified application-only fix or runnable/distributable patched engine.
   No global library replacement, sandbox disabling or runtime injection is
   introduced here.
3. **Rich export still follows the reviewed worker export capabilities.**
   Main-editor official Mermaid rendering does not prove complete Mermaid
   export. This candidate does not silently lift the export parser's limits or
   loosen isolated rendering deadlines.

Gap 1 therefore remains **open** until those missing features and platform
acceptance are complete. None of this evidence authorizes formal publication.

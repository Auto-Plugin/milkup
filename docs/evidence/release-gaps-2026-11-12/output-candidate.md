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
The PDF test exports A4 and Letter landscape documents and checks that document
network requests do not reach a controlled localhost listener. It retains PDFs
for independent text extraction, page geometry and all-page pixel inspection.
A PDF header/byte check is intentionally **not** a Unicode or layout pass.
The gate also explicitly runs a real native print-dialog cancellation test.
It identifies only the exact owned helper PID and its visible native dialog,
sends Cancel with a bounded Win32 call, and requires `cancelled` back. It does
not submit a physical print, drive the full product plugin UI or replace the
remaining positive queue/file-printer acceptance.

Before delivery, also run actual GUI export with the installed application:
HTML regression; A4 and Letter, portrait and landscape; Chinese, emoji, quotes,
combining sequences, diagrams, images and long blocks; cancelled picker;
existing output confirmed/rejected; source/hardlink conflict; rapid repeat;
abort during engine startup and rendering; close/plugin disable; helper and
profile cleanup; and both ordinary/admin accounts. Preserve original failure
logs, source hashes, executable identity and final PDF hashes. Do not treat the
native helper-only fixture as a substitute for that acceptance.

## Still open, not hidden by this patch

1. **Windows printing now has a candidate implementation, not native acceptance.**
   It uses the native printer chooser and WebView2 `Print` callback, rather than
   equating `ShowPrintUI` with success. Queue acceptance, native cancellation,
   printer failure, copies, collation and page range are represented. A4/Letter
   and orientation stay with the plugin's explicit options. The native chooser
   disables and intercepts Properties instead of accepting unmapped paper-tray,
   quality or vendor choices; color/duplex use printer defaults. Its button
   identity follows Microsoft's PrnSetup.Dlg/psh2, verifies the native template,
   and fails closed if it cannot enforce this limit. Re-enabling on printer
   change is countered after notifications, with command interception throughout.
   The plugin explains the limited chooser before confirmation.
   The built-in English-named Microsoft Print to PDF destination returns bytes
   to a second, host-owned PDF save picker. Other known FILE:/PORTPROMPT:
   destinations are rejected; renamed/localized or third-party virtual printer
   behavior still needs validation.
   The physical printer and file-printer GUI paths have **not run here**.
   The export-print plugin is bumped to 1.0.1 and no longer tells users that a
   canceled wait retracts an already submitted queue entry. The integrator must
   rebuild/update its bundled package and inventories; this patch does not
   silently edit their hashes or publish an archive.
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

## Latest Linux dependency check (2026-11-12)

The latest stable release page checked is WebKitGTK 2.54.2 (2026-10-23).
Both its tagged `FontSkia.cpp` and upstream main pinned to
`98d4e2c3ae520d58ad0c5c06a76f3cef90293181` still build glyph-only blobs with
`allocRunPos` / `allocRunPosH`, not original-text/cluster-bearing runs. See
[exact URLs, hashes and line observations](webkit-upstream-check.json).
This source check does **not** claim the current release binary was tested;
it shows no verified upstream repair to adopt for the identified metadata loss.
A full matched WebKit patch/build plus normal-distribution delivery remains
necessary under the chosen dependency constraint. No extra engine, hidden text
layer, glyph-to-Unicode guessing, Unicode normalization, clipping or document
container splitting was used to mask the open fidelity/pagination failures.

Second-stage checks: isolated Windows-target type-check including the printer
module and protocol tests passed. Independent export-print 1.0.1 build,
TypeScript check and 19 Vitest tests passed using the public SDK 0.3.8 tarball.
Those tests are plugin/controller tests, not Windows printing or Linux output.

## Independent native-code review follow-up

Three findings were fixed before the next candidate handoff: the parent now
uses the original print lease for human choice rather than the PDF's 90 seconds;
cleanup drops the Job owner before bounded try-wait/thread completion checks,
so failed termination cannot hang on unconditional waits; and the native chooser
no longer accepts vendor Properties that WebView2 cannot forward. Added tests
cover deadline choice, bounded pipe-thread cleanup and native control enforcement.
Actual printer switching/keyboard interaction still require Windows execution.


## First integration feedback and corrected native gate

The integration executor reported a 612 × 792 pt Letter "landscape" artifact.
The old test fixture incorrectly supplied `@page{size:A4}` for both requests,
contradicting its second Letter-landscape API call. Production `static-html.ts`
already derives both paper and orientation from the same user options. The gate
now uses matching production-style CSS for all four A4/Letter orientations and
asserts every direct PDF MediaBox (including failed artifacts saved for inspection).
This is a fixture correction, **not proof the Windows orientation defect is fixed**;
the corrected gate still must execute on Windows. PageWidth/Height are not blindly
swapped in the backend, which could break the matching production path.

The previous one-line network assertion conflated an accepted connection with any
listener error other than WouldBlock. It now reports accepted peer/request bytes
separately from observation failure, after each output, and accepts only WouldBlock.
No networking failure is waived and no isolation control has been weakened.

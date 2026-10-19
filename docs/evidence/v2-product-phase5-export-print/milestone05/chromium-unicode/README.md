# System Chromium static PDF feasibility

This experiment used existing Debian Chromium 154.0.8037.57, existing Playwright 1.61.1 and existing PDF readers. It installed nothing and did not change HTML, fonts, WebKit, Windows, Runtime or Library. The later Rust module is a separate implementation; its native acceptance evidence belongs in ../chromium-controlled/.

## Reproducibility and sandbox

`run.mjs`, `run.sh`, `execution.json`, `attempt-default.log`, `attempt-namespace.log` and `attempt-approved-02.log` preserve the experiment. Chromium was launched headless with `chromiumSandbox:true`, through the existing private namespace after normal tool approval. No display was used. No sandbox-disable flag or system ownership/permissions change was used.

The first tool-sandbox launch failed on the SUID helper owner mapping; the first namespace launch failed to map UIDs. Approved namespace execution succeeded. `execution.json` records Chromium's own chrome://sandbox status: namespace layer, PID namespace, network namespace, seccomp-BPF and TSYNC all enabled. This describes Chromium's process sandbox; it does not prove all browser-process background network traffic is blocked. A nonessential command-line probe initially failed because --enable-automation was absent, then succeeded with that ordinary automation marker.

The Playwright experiment used JavaScript-disabled contexts, disabled service workers, denied downloads, request interception and CDP URL blocking. Its default automation flags are recorded and are NOT the production Rust launch policy. The Rust module uses its own minimal flags, preserves sandboxing/web security/IPC protections, and additionally serves the exact HTML from an intercepted synthetic request with a restrictive response CSP.

## Exact inputs and results

- `unicode.pdf`: original `native-unicode/baseline-fixture/unicode-baseline.html`, SHA256 8728310cfe58315399377fb4f739792e23e05c88a58fbfd139b05783548318c9. One letter landscape page. Original Han 文一人口 and Kangxi ⽂⼀⼈⼝ remain distinct; quotes, combining sequences, ffi versus ﬃ and complete emoji sequences are preserved in Poppler/MuPDF extraction.
- `real.pdf`: unchanged genuine plugin export `p5-html-04/complete.html`, authoritative input SHA256 22e8037770e9be50d33318aa5fdcdaec12f1d591e2cb836b2a3efcad39f403d0. Two A4 pages. Code single quotes, emoji, Chinese diagram labels and body content survive extraction.
- `pagination.pdf`: unchanged serializer `content-pagination/baseline.html`, SHA256 5e7f09d8566363c81fbe775ed24308f1f398c84a810df6f23a7c5978f0ce8f25. Nine heading/first-item checks pass; all content markers appear exactly once. This check establishes page placement, not comprehensive visual acceptance.

`comparison.json`, `reader-compatibility.json`, raw/layout/PyMuPDF/pypdf text files and `actual-text.json` expose the comparisons without normalization. `unicode.page-content.txt` contains 20 direct page /ActualText entries, including original Han code points, e+U+0301, A+U+030A, ffi/fi, heart+variation selector, and SVG Chinese. The original text is present in the generated PDF; no hidden-text patch or glyph substitution was added.

Limits: Poppler -raw omits some spaces between emoji/SVG words; -layout restores those but introduces code layout spaces. PyMuPDF retains all requested baseline sequences, but Arabic reading order differs. pypdf's extraction path ignores /ActualText and still returns radicals/composed characters/ligature code points. Do not claim universal reader-independent or arbitrary Unicode round-trip fidelity. `unicode-page1.png` was visually inspected: no tofu in this sample, emoji remain colored, and SVG labels are legible.

## Native integration shape and costs

The generic host output contract stays unchanged: plugins receive snapshot metadata and opaque target leases; no HTML/path/filesystem privilege is added. The host passes its frozen bounded HTML and approved paper settings to an isolated native converter. A private CDP pipe avoids a TCP debugging port. The converter denies page JavaScript, downloads and external resource requests before loading; it accepts exactly one synthetic document request. Browser process isolation is necessary in addition to these content rules.

HTML including trusted paper-size override is capped at 32 MiB; protocol responses at 1 MiB; decoded IO chunks at 64 KiB; final PDF at 64 MiB. Stream mode bounds transfer chunks, not Chromium's own peak render memory. A host deadline and the existing descendant-owning guardian handle timeout, cancellation, plugin disable/revoke and parent death. A stage is never a user output until the existing target/atomic-publication checks commit it. Native print submission must wait for a real terminal outcome after acceptance; an uncertain spooler handoff cannot be reported as safely cancelled.

Linux packaging acquires a substantive system dependency. This machine's chromium/chromium-common/chromium-sandbox Installed-Size values total 385984 KiB (about 377 MiB), excluding shared libraries and fonts. There is no installer/download/fallback browser in this proposal. Distribution packages must provide sandbox support, graphics/font libraries and security updates; distro/browser versions need revalidation. Only Chromium 154 was tested. CDP streaming/tagging are documented experimental features, so capability failures must remain explicit errors. The production native module must not depend on Node or Playwright.

GTK print consistency requires submitting the exact Chromium PDF, rather than rerendering HTML in WebKit. GTK3 offers GtkPrintJob set_source_fd (since 3.22), with gtk_printer_accepts_pdf capability checking. This preserves PDF page content at the spool boundary, but printer filters, paper hardware and driver scaling still need native validation. PostScript-only printers require a separate approved conversion policy or an explicit unsupported result. A GtkPrintUnixDialog/PrintJob integration must carry copies, page ranges, collation, selected paper and orientation, obtain real acceptance/cancellation, retain the private FD through completion, and respect the same target/overwrite protections for Print to File. No physical printer was tested in this feasibility experiment.

## Primary sources

- Chrome official headless architecture: https://developer.chrome.com/docs/automation-and-testing/headless
- Playwright browser launch: https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox (sandbox defaults false, explicitly enabled here; custom system executable support is not its bundled-browser guarantee).
- Official CDP schema: https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json (Page.printToPDF, ReturnAsStream, generateTaggedPDF, IO.read).
- PDFium text processing: https://raw.githubusercontent.com/chromium/pdfium/main/core/fpdftext/cpdf_textpage.cpp (PreMarkedContent and ProcessMarkedContent read ActualText into the text buffer); https://raw.githubusercontent.com/chromium/pdfium/main/fpdfsdk/fpdf_text.cpp (FPDFText_GetText reads that page text). This is source evidence, not a claim of a tested Chromium viewer clipboard path.
- GTK3 native print source/FD API: https://raw.githubusercontent.com/GNOME/gtk/gtk-3-24/gtk/gtkprintjob.c (set_source_file and set_source_fd; printer PDF capability matters).

# Exact-source Linux rebuild and installed acceptance

No release is published. Application source is `b877746f5dfd236dfc13f718ed23d837b8e4f89d`; only the CI acceptance harness changes. Default Ubuntu 26.04 security policy is retained.

## Build and first installed attempt

Run [43558261633](https://github.com/Auto-Plugin/milkup/actions/runs/43558261633), harness `87c63ad580e890d4e75541f85a2f95fb886604bf`, used the baseline official `scripts/release/build-candidate.mjs`, frozen dependencies and an independent exact-source checkout. The ordinary-user WebKitGTK sandbox preflight, release DEB build, install, installed/extracted executable comparison and package removal passed.

- New DEB: `milkup-2.0.0-beta.10-linux-deb-b877746f5dfd.deb`, 9,853,762 bytes, SHA-256 `4941f3a1ab85b7c7ed1d96edf4807c388a7c883240a2aa32ee13c062661fc813`.
- Original preserved DEB SHA-256: `36c4873d840a06e85bf08398e119f9ddb494c813727eff6479aa4e434141f86e`. **Different bytes**; the rebuilt candidate never substitutes acceptance of the original.
- New installed executable SHA-256: `1f2eb69ca6fda7f2cad047fe72aed483d571209b4659a33d3adbe7494723fcfa`.
- New package artifact: `14099980957`; ZIP SHA-256 `6ea16526fdda7904bf54279bc2b03dfa9d546d7411abde02bcb53b9beeef3db1`, 9,811,122 bytes.
- Evidence artifact: `14099651532`; ZIP SHA-256 `922287dc1cc3b16342f869a94b47fb402ee0d2571c41f926aa9f0efed2afd0bb`, 138,657 bytes.

Installed ordinary-user GUI open passed in 2,593 ms and exact edit/save passed in 1,505 ms. Normal close failed; reopen and PDF were **not executed**. Failure cleanup was forced and is not normal-close proof.

The harness incorrectly focused the Windows-only close button, hidden by the Linux stylesheet, and sent Return. The failure screenshot shows an extra newline and dirty state. This does not establish an application close failure. The corrected harness sends the supported X11 `WM_DELETE_WINDOW` protocol only after checking the owned process generation and window PID. Other UI actions use native pointer input with visible-target hit checks. It never uses XDestroyWindow or a signal as a successful close.

The next run reuses the exact new package artifact, verifying ZIP size/hash/CRC, manifest source identity and DEB size/hash before installation. It does not rebuild, transfer the preserved private original or configure repository secrets.

## Actual installed result with corrected native input

Run [43559220183](https://github.com/Auto-Plugin/milkup/actions/runs/43559220183), tested harness `6fd03468b7f29ef5d6c18bf2fc165ad723ed457e`, reused the exact new DEB above, verified its complete ZIP and DEB hashes, installed it, and compared installed/extracted executable bytes. **Final result: failure**, specifically PDF exact Chinese text fidelity. No further rebuild or repeat run was used to hide it.

Environment: Ubuntu 26.04.1 image `20261111.196.1`, uid 1001, WebKitGTK `2.52.6-0ubuntu0.26.04.1`, GTK `3.24.52`. Default sandbox preflight passed without changing security policy.

| Operation | Actual result |
| --- | --- |
| Installed production open | Passed, 2,243 ms |
| Native keyboard edit and save | Passed, 1,439 ms; exact expected file bytes |
| Normal GTK close after save | Passed, 150 ms; owned process disappeared after supported WM_DELETE_WINDOW; no signal or force |
| Fresh process reopen | Passed, 1,252 ms; saved marker visible and file bytes exact |
| Enable output through visible UI | Passed, 1,671 ms; real pointer clicks |
| A4 portrait PDF | Generated in the 5,840 ms test step; 5 pages, 595 × 842 pt, all 100 BODY markers plus start/end/saved markers once; Chinese fidelity failed |
| Letter landscape PDF | Generated in the 3,278 ms test step; 7 pages, 792 × 612 pt, all markers once; Chinese fidelity failed |
| Final normal GTK close | Passed, 159 ms; owned process disappeared, no force |
| Package removal | Passed; only the package installed by this run was removed |

Independent review checked all 12 pages: rotation 0, expected dimensions, BODY markers in source order, no empty page or extracted word outside page bounds. A4 marker distribution is 19/22/22/22/15; Letter is 12/15/15/15/15/15/13. First and last page raster images were inspected. This simple paragraph fixture does not cover oversized tables/code, heading orphan rules or every rich-content pagination case. The Markdown hash remained the exact saved expectation after export.

### Reproduced Chinese failure

Original: `中文复制验收：春风又绿江南岸，明月何时照我还。`

Extracted: `中⽂复制验收：春⻛⼜绿江南岸，明⽉何时照我还。`

| Original | Actual PDF mapping |
| --- | --- |
| 文 U+6587 | ⽂ U+2F42 |
| 风 U+98CE | ⻛ U+2EDB |
| 又 U+53C8 | ⼜ U+2F1C |
| 月 U+6708 | ⽉ U+2F49 |

Both CI Poppler and independent local Poppler reproduce these same four substitutions. Their full text whitespace differs, so the entire extraction is not claimed byte-identical. Inspection of the PDFs' own ToUnicode CMaps finds the radical mappings, establishing that the problem is present in the generated PDF, not merely the harness string comparison. Fonts are embedded/subset NotoSansCJKsc Type 3, producer `Skia/PDF m145`. Exact text fidelity remains failed; normalization, visually similar glyphs or embedded-font presence are not substitutes for correct Unicode. This evidence does not by itself isolate which internal WebKit/Skia source function loses the original characters, and no system library or application output was patched.

### Evidence and boundaries

[Retained fixture, expected values, PDFs, raw extraction and reviews](./linux-b877-rebuild-2026-11-14/43559220183/retained-evidence.json) include byte sizes and SHA-256 for every retained file. Full CI evidence artifact `14099897100` is 616,670 bytes, SHA-256 `72127d42ae67b9826799e1b0395ea8acfab3d79a148075649c4b27677cfc51d0`, expires **2026-11-21 05:00:27 UTC**. The retained repository subset and workspace download are separate from that retention deadline.

The application source, plugins and lockfiles are unchanged from b877; only acceptance code and evidence are changed. The original b877 DEB remains independently preserved. No repository secret, original-package transfer, release or publication workflow was used.

Not covered: manual PDF-viewer clipboard interaction, complex rich-content fidelity, native IME, physical printer output. This runner still has no CUPS/ippeveprinter queue; no Print-to-File operation is counted as physical printing. Further Linux PDF acceptance requires a real original-character mapping fix and regression against these retained failing PDFs/fixture, without normalizing away the defect.

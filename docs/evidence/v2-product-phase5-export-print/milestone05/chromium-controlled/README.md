# Native Chromium controlled-output acceptance

All six renders passed using the compiled production module through the existing native output guardian/helper protocol. This was not a Playwright render. Test binary SHA256: `950c8c4de38de8e5079a60d50983c4763c01f8d6232bf35c510394a9bede17e7`. `run.py`, `run.sh`, `run.log` and `execution.json` preserve execution. The existing private namespace was launched through normal approval; no display, sandbox-disable flags, system permission changes or dependency installation were used.

- `security-script.pdf`: visible script sentinel unchanged; inline script did not execute; external image/fetch and self-owned file HTML/SVG content blocked. A data image is present in the PDF, so the check did not merely suppress all resources.
- `security-resources.pdf`: onload/SVG scripts did not mutate content; external CSS/import/font/background/SVG requests blocked; self-owned file embed did not enter the PDF.
- The controlled loopback HTTP server received **zero requests** across both security cases. This proves those content requests were blocked; it is not a trace of unrelated Chromium browser background traffic.
- `unicode.pdf`: unnormalized MuPDF extraction preserves Han/Kangxi distinctions, combining sequences, ligature distinctions, quotes, all emoji sequences and SVG Chinese labels. Arabic reading-order exact match still fails.
- `real.pdf`: unchanged genuine plugin-export HTML retains Chinese diagram labels, complete code single quotes, emoji and decomposed e+accent.
- `pagination.pdf`: unchanged nine-case serializer input; every heading shares the first content item's page, with no missing or duplicate markers.
- `compatibility.pdf`: ordinary `豈塚崎` and compatibility `豈塚﨑` (U+F900/U+FA10/U+FA11) remain distinct. Double/single quotes, backticks, composed and decomposed accents are preserved.

Every helper's guardian exited 0 and its private stage was removed after exit. Output PDF headers/terminal EOF markers were checked, and generated files fit native output budgets. Native unit suite: 15 passed, including 5 module tests; 3 ignored tests are explicit native helper/GTK entrypoints. See ../native-integration/ for the unified compile/test logs.

`comparison.json` contains exact text and pagination comparisons. The general reader limitation remains: pypdf ignores ActualText in this extraction path, while Poppler/MuPDF can use it. See ../chromium-unicode/README.md for the earlier engine experiment, directly decoded ActualText entries, system dependency costs, primary-source references and GTK same-PDF integration considerations. No universal reader fidelity, physical printing, non-Linux support or unrelated historical P4 fixes are claimed.

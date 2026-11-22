# Limited WebKit PDF.js notice payload

This offline tool covers four exact Liberation Sans resources and the exact
`quickjs-eval.js` wrapper found in WebKitGTK 2.54.2 and 2.54.3. It prepares notice
files for a future package assembler; it does not install or approve a package.

The four font files identify Liberation 1.07.4. PDF.js corrected its mismatched
OFL notice in [4315a4be](https://github.com/mozilla/pdf.js/commit/4315a4be3168373e6c674fbf6723a20c50994f80),
without replacing the fonts. The corrected notice contains GPL v2 and the
Liberation font exception. Do not replace these files with Liberation 2.x merely
to change the license label: PDF.js width and scale tables depend on glyph order.

The generated QuickJS wrapper is unchanged across PDF.js's
[a3beacc1](https://github.com/mozilla/pdf.js/commit/a3beacc1a35f2d285f0505c5489d8cb4a9ebcc89)
notice correction. Both MIT notices are retained. `sources.json` records exact
upstream locations and hashes; the tool separately locks accepted notice bytes.
Original notice whitespace is preserved to retain byte-for-byte upstream identity.
The wrapper's header is a generated-file marker, not a complete license notice.
WebKit deliberately removes `quickjs-eval.wasm`; this payload does not add it or
claim a complete executable QuickJS engine.

```sh
python3 scripts/release/webkit-pdfjs-notices.py prepare \
  /path/to/verified-webkit/Source/ThirdParty/pdfjs /new/notice-payload
python3 scripts/release/webkit-pdfjs-notices.py verify \
  /path/to/verified-webkit/Source/ThirdParty/pdfjs /new/notice-payload
python3 -m unittest discover -s scripts/release -p test_webkit_pdfjs_notices.py -v
```

Preparation requires a new directory and leaves source bytes unchanged. Changed
resources or notices require review; no filename-based license fallback exists.
Verification rejects missing, truncated, extra or symlinked payloads and claims
that this limited receipt is a complete SBOM or installation/legal approval.

The package assembler still must place these exact notices in its actual
installed notice directory and bind them to the runtime resources and package
hash. WebKit's GResource manifest excludes license files, so source-tree presence
alone does not meet this requirement. Corresponding-source availability,
applicable redistribution obligations, other static dependencies, the generated
wrapper's reproducible build inputs, and security maintenance remain separate
gates. This is technical provenance/packaging work, not legal clearance.

## Binding to a generated resource container

`webkit-pdfjs-resource-binding.py` additionally extracts the five reviewed assets
from a real GLib GResource container (or a resource-bearing ELF) and matches their
exact decompressed bytes to the source and prepared notices. Supply the expected
container SHA-256 explicitly. The container is never executed; extraction has
byte/time bounds, rejects changed containers and symlink paths, and preserves
all incomplete-SBOM and nonapproval flags.

```sh
python3 scripts/release/webkit-pdfjs-resource-binding.py \
  /path/to/verified-webkit/Source/ThirdParty/pdfjs /new/notice-payload \
  /path/to/exact/resource-container EXPECTED_SHA256
```

A standalone generated bundle proves only that bundle's byte correspondence.
It does not prove membership in the final linked library or installation. Run
again against the final resource-bearing runtime, bind its hash to the actual
package inventory, and verify these notice files are present in that same
package before claiming that limited packaging obligation is met. Other PDF.js
assets, all static dependencies and corresponding-source obligations still need
their own evidence; no complete license expression is inferred here.

# URI annotation research, not a product dependency

Scope: matched Ubuntu WebKitGTK 2.52.6 with the already-tested scalar text patch.
Only `GraphicsContextSkia::setURLForRect` is added, passing a valid URL and local
rectangle to Skia's existing annotation API. No PDF rewriting, Unicode
normalization, rasterization, system library replacement or sandbox changes.
Internal named destinations are deliberately not advertised or implemented.

Upstream checked 2026-11-14:

- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/graphics/skia/GraphicsContextSkia.h
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/graphics/skia/GraphicsContextSkia.cpp
- https://bugs.webkit.org/show_bug.cgi?id=91171

The current GTK class still lacks this override. The old Chromium backend had an
analogous reviewed fix in 2012; that is a useful precedent, not a modern GTK patch
or current acceptance. Its later linker failure reinforces checking actual Skia
API availability and final linkage. In matched source, `SkAnnotation.cpp` and
`SkData.cpp` are already in `Source/ThirdParty/skia/CMakeLists.txt`.
`SkPDFDevice::drawAnnotation` applies local/page transforms and clip intersection.
Do not duplicate these transformations in the WebKit adapter.

Low-cost checks: patch applicability to the exact source, real Skia header syntax,
positive verifier plus nine rejection mutations, generated fixture identities.
Local host has no WebKitGTK development package; it cannot substitute for native
printing. CI preflight uses the default system runtime to require exactly three
pages, no URI annotations and rejection specifically for missing URI/page set.
The no-link control also requires no annotations. It must not pass by crashing,
failing to print or rendering the wrong page count. Known system Unicode mapping
failure is not confused with this annotation counterexample.

After same-SHA preflight and real first-invocation cache hits, one explicit resume
may compile the private engine and run only four URI targets across three pages,
including two targets on one page, escaped URL/query, wrapped text and a translated
later-page target. Independent pypdf annotation inspection and Poppler word boxes
check exact URI/page sets, tight regions, coverage and absence of extraneous
clickable areas. The matching document without anchors must have zero annotations
and identical extracted text. Chinese plus deliberate radicals appear twice and
must remain exact. This is not a PDF-viewer clicking/clipboard test, installed
Milkup end-to-end retest, physical print or internal-destination acceptance.

Ordinary-user GTK uses an ephemeral context, explicit sandbox, no JavaScript and
a restrictive fixture CSP; only Print to File is used. Each print has a 45-second
internal deadline and 55-second external bound. Private host and actual web-process
birth/path/maps are recorded against fixed library hashes. Full build retains the
existing memory/disk/no-progress/total deadlines and acceptance reserve. No new
application build, package installation or full GUI/IME/update matrix is selected.

Cache 10528414254 from successful run 43614932570 is still available at inspection,
433656526 bytes. This metadata alone is not proof of a hit: existing first-object
cache probes remain mandatory. No concurrent equivalent workflow was running when
checked. Any failed preflight stops expensive dispatch until its cause is resolved.

Delivery remains separate: prefer an upstream/distro backport using its normal
signed security updates. A private app runtime would require relocatable ABI and
resource packaging, source/license/SBOM provenance, signed per-version integrity,
timely security rebuilds, atomic activation/recovery and installed sandbox/update
tests. Pinning a private runtime must not silently bypass future system WebKit
security fixes. No such supported delivery pipeline exists in this research.

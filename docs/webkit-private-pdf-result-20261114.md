# Private WebKit PDF result and delivery boundary

Run https://github.com/Auto-Plugin/milkup/actions/runs/43614932570 succeeded
at research SHA `a6e22b5f82a545d5703342c4fc95d2d40740430c`. This is not a
release candidate or acceptance of a distributable modified runtime.

## Independently checked evidence

The matched Ubuntu WebKitGTK 2.52.6 source built and installed into an isolated
test prefix (compile exit 0, 2541.501 seconds). Actual ordinary-user installed
application and PDF-helper process mappings identify the private WebKit and
JavaScriptCore libraries. Default sandbox preflight passed. System library hashes
before and after agree. The tested application is the b877 source-series rebuild
deb, SHA-256 `4941f3a1ab85b7c7ed1d96edf4807c388a7c883240a2aa32ee13c062661fc813`,
not the newer 383c composite package and not the historical original b877 bytes.

All eight selected GUI/save/reopen/export/normal-close steps passed. The A4
portrait PDF has six pages and Letter landscape eight. Both retain all 103
document markers and the original-character/radical, deliberate-repeat, fallback,
bold, wrap and later-page cases. Poppler raw extraction was independently repeated
against the retained PDFs; Chinese and intended radicals remain distinct. Search
proof is bounding-box text probing. Neither claim is an interactive PDF-viewer
search or manual clipboard test. URI annotation lists are empty in both PDFs.

| Retained original output | Bytes | SHA-256 |
| --- | ---: | --- |
| a4-portrait.pdf | 89915 | `89a5cb36dedaf1be5948061194d5f015cb72e1ea60dfea278aa05897a872cb71` |
| letter-landscape.pdf | 91487 | `5bbd81e0dd37156391c1f03b142c55b5b8bc950a6b6f71ceb33e39bfdf14b07b` |

Original artifact 14123790688 (build evidence) has ZIP SHA-256
`dac0a2944239fc0cec83dcd0e95a122cd7ba34f6a7e4e136d501b2036b535f9e`;
14123316286 (installed/PDF evidence) has
`62fe4a2f08e4394411cab3a2438dea01f1daf134164190410013c6026a57c245`.
They expire 2026-11-21 at 17:04:31 and 17:04:30 UTC respectively.
Downloaded ZIP bytes, CRC and extracted hashes were verified in the isolated
workspace. The original workflow did **not** upload the linked runtime binaries;
maps/hashes/install manifest do not constitute a retained runnable SDK.

## Link-loss localization

Offline reproduction uses the actual fixture Markdown and the unchanged product
serializer. Its HTTPS anchor survives `renderStaticMarkdownDocument`, and the
Rust static-output guard accepts safe anchors. The Linux output path validates
then passes the original HTML bytes. This reproduction is not a capture of the
actual helper's received HTML.

In the exact matched engine source:

- `OutlinePainter.cpp:697-705` obtains href and calls `setURLForRect`.
- GTK `WebPrintOperationGtk.cpp:406,717-719` uses SkPDF and
  `GraphicsContextSkia` when spooling pages.
- `GraphicsContext.h:365` defines `setURLForRect` as an empty virtual function.
  `GraphicsContextSkia.h/.cpp` does not override it. Destination support is also
  absent; `supportsInternalLinks()` defaults false.
- Skia already exposes `SkAnnotateRectWithURL` in `SkAnnotation.h` and its PDF
  device handles URL annotations.

Thus this backend has a statically demonstrable missing annotation implementation,
consistent with both original PDFs. A serializer workaround alone cannot supply
the missing backend annotation. No annotation fix has been compiled or accepted.
A narrow research implementation should preserve URL validation/encoding, canvas
transforms and clipping, with tests for HTTPS, Unicode/escaped targets, wrapped
links, later pages, rejected unsafe schemes and internal destinations. Text and
pagination must remain unchanged. An independent annotation reader should check
URI values and rectangle placement; clickable-viewer behavior is a separate test.

## Safe delivery options

Prefer an upstream/distribution fix with normal signed security updates. If a
private runtime is pursued, it needs a separate supported packaging project:
relocatable helpers/resources/RUNPATH; exact ABI and dependency matrix; upstream
source/license/SBOM provenance; per-version integrity; timely security rebuilds;
atomic app/runtime activation and verified recovery; ordinary-user sandbox and
installed-update tests. Current linked WebKit/JSC alone total about 664 MB
unstripped, before helpers/resources. The CI prefix and environment-based library
selection are research infrastructure, not that delivery mechanism.

Do not replace system libraries, relax sandbox policy, substitute global Unicode
rewrites or rasterize text. No unaccepted WebKit patch is in the product candidate.
Remaining limits include URI links, runtime delivery/security maintenance, manual
clipboard/viewer checks and broader font/layout coverage. No release was published.

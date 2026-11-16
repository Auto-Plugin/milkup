# Read-only tail-height discriminator

Stock control 43817256321 establishes an 8-page Letter portrait without a blank
page. Candidate 43813631229 has nine pages, last page 11 CSS px of white fill;
visible final content is on page eight. Same input/guard/package/settings. No
new behavior fix is justified by those measurements alone.

The separate opt-in tail patch reads the exact observation+behavior sources,
with pinned preimage hashes. In RenderBlockFlow::handleAfterSideOfBlock it
records content height, computed height before/after bottom-margin handling,
pending collapsed margin, collapse flags, border/padding and scrollbar. At the
same final native PrintContext spooling boundary it records documentRect,
actual pageRect, RenderView/html/body/last body block quads, border-box heights,
layout and visual overflow and effective break-before/after. No DOM changes,
CSS changes, page removal, setter, layout or paint substitution is introduced.
Both record prefixes require the same real WebProcess's kernel credentials and
pidfd, exact actual private library hashes, default sandbox and normal cleanup.
The original six-role/page diagnostic and independent PDF contracts remain.

Discriminators:
- Non-white/text/image content on a final page remains real content, never trim.
- Effective forced breaks remain separately visible and must not be erased.
- A final margin addition at RenderView can be compared numerically with the
  body/last paragraph bottom, root layout overflow and documentRect.
- Visual overflow beyond layout is separately recorded; a page-count or scale
  mismatch cannot be relabelled margin collapse.
- Stable final geometry is required on every spooled page; missing/reordered
  records, a different process generation, or partial logs fail closed.

Original behavior patch remains
660f13b8e61ed2e6af4a1bec7602e08755b4deb685e4af9d6c639053286f210f.
This observation is applied only after the already-proven six-field object
restore from 43808221193 / 14199955883, then the exact behavior patch. The new
seven-field bundle 14202401300 is deliberately **not** used or coerced into the
six-field restore stage. The behavior cache identity hashes every modified
source, including the tail header and PrintContext. Actual affected TUs must
compile before an engine continuation. Existing bound: 40 minutes / 160 new
misses, no cold fallback, explicit idle/disk limits and retained object evidence.
Only this opt-in run is appropriate; no repeated stock or installation matrix.

The native matrix now records content/header failures independently and keeps
later safe cases, but identity/cleanup failure still stops it. Missing cases or
any failed case keep the final result failed. Local counterexamples exercise
blank-page failure with successful header capture and a subsequent case, and
reject missing/reordered cases. Observation-only source changes, exact original
behavior patch, record clock/identity/schema and coordinate rejection are also
checked locally. Actual compiler/runtime results are still mandatory.

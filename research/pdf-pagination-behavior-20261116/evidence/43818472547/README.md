# Tail-height cause captured — 43818472547

Run https://github.com/Auto-Plugin/milkup/actions/runs/43818472547 tested
`0af67d531094578b280763cbe1720708871258e5`; final **failure**, preserved.
All seven native cases executed in 14.202 s. Five A4 cases and Letter landscape
passed the original content/header/clipping contracts. Letter portrait remains
nine pages with its last page empty. Earlier six cases match 43813631229's
complete word boxes/page geometry exactly; read-only diagnostics did not change
them. Letter landscape (11 pages) is newly measured, not inferred from stock.

The precise Letter portrait path is now observed in the same kernel-bound
WebProcess that mapped the exact private libraries and produced the PDF:

1. Last paragraph border box ends at y=6994.8125, within page eight (end 7000).
2. Its 16px trailing margin collapses through body; body adds zero height and
   reports collapsedAfter=16.
3. HTML root cannot collapse its after margin. `handleAfterSideOfBlock` adds
   exactly 16: 6994.8125 → 7010.8125, with zero border/padding/scrollbar.
4. RenderView inherits 7010.8125, pending margin=0 and adds **zero**, correcting
   the earlier possibility that RenderView itself added the margin.
5. Snapped documentRect is [0,0,651,7011]; page height is 875. Page count becomes
   ceil(7011/875)=9. Final paragraph/body layout and visual bounds end before
   7000; effective before/after break values are auto. The prior raw PDF proves
   page nine contains only 11 CSS px of white background and zero non-white
   raster pixels, not actual text/image/overflow or an explicit forced page.

This supports a narrow document-root trailing-margin boundary correction. It
does **not** justify discarding a PDF page or globally ignoring overflow/margins.
The frozen original controls, intentional forced blank and real overflow must
remain independently tested before any behavior correction is accepted.

All seven cases passed held pidfd/generation/ancestry, exact mapped runtime
identity, UID1001/NoNewPrivs1/Seccomp2/CapEff0, normal guardian exit0 and private
cleanup. Both log prefixes have exact bytes bound to the same WebProcess.
Original package/guard identities remain unchanged (see prior stock evidence).

Build: actual changed TUs passed; full continuation 421.213 s, 3234 hits and 29
misses, within 2400s/160-miss limits. The proven six-field object artifact
14199955883 was restored with cross-process first hits. Artifact 14202401300
was not used. New object artifact 14203269746 is seven-field and **not yet
cross-job restore proven**; no runtime or keys included. It expires Nov23
06:55:49 UTC. No such large object archive was downloaded to this small local
workspace.

Unchanged raw archives are committed here:
- Native 14203578964: 15,172,952 bytes, SHA256
  5c8e9a156c08899d3d5c50ec26896f8facf474a5eed89da9216ec69f81e6a175.
- Build 14204490523: 5,348,356 bytes, SHA256
  5b71f4b963997dc6c3bfb7b4fdb972d93a431dded25dff7a70c8466746a9a204.

Both ZIP hashes and all CRCs verified. Only the disposable expanded build tree
was removed after local disk exhaustion; raw archives and selected evidence
remain. Exact inputs, PDFs, process maps, logs, source/hash/cache/compile evidence
are preserved. Unicode/URI/maintainable production delivery remain unpassed;
this research prefix is not a production runtime. No main, release, system
security, notifications or production configuration changed.

# Header registration and bounded continuation

Run [43590136844](https://github.com/Auto-Plugin/milkup/actions/runs/43590136844)
failed after 3:45:13 of compilation, with last logged progress 8898/9449.
`WebCore/DisplayListItems.h` was forwarded into the build's private framework
headers but its newly included `ScalarGlyphText.h` was not registered. WebKit's
consumer could not find it. This was a compiler error, not the earlier 150-minute
timeout. Private runtime installation/loading and PDF checks did not run.

Artifact 14118773396: 622116 bytes, SHA-256
`4640cec80b2446e5f458021d7f669ad54eff32fe81fddd00ae0ea77fa13bca1b`.
Its compiler cache reported 2782 cacheable calls, no hits, about 0.4 GB stored.
GitHub cache ID 10525664182 subsequently retained 352921317 compressed bytes.
Existence alone is not proof that a future compiler invocation will hit it.

The exact official Ubuntu source archives from that run's authenticated APT
metadata were downloaded again and hash-checked. `dpkg-source` applied the distro
patches for `2.52.6-0ubuntu0.26.04.1`, followed by research patch 0002 and the
one-line 0003 registration. Archive provenance and results are in
`header-preflight-evidence/`.

`webkit-header-preflight.py` executes the actual upstream `Headers.cmake`,
`platform/Skia.cmake` and `WEBKIT_SYMLINK_FILES` function in a small CMake/Ninja
project. It forwards the seven reviewed headers only; unrelated generated engine
headers are not claimed. The old-registration graph removes precisely the new
entry. With only the forwarded directory on the consumer's include path, the
old graph fails for the missing header and the actual corrected graph compiles
successfully. All seven symlinks resolve to their exact source bytes. In
particular, `GraphicsContextSkia.h` is already registered by `platform/Skia.cmake`.
These are build-private interfaces, not new public SDK headers to install.

Local tools: isolated CMake 4.1.3 and Ninja 1.13.0 plus the existing C++ compiler.
Initial preflight harness attempts correctly failed for a wrong tool path and
unrelated generated-header dependencies; neither ran an engine build. The final
controlled source-header graph passed. This does not compile the complete engine.

The workflow now defaults to a bounded **preflight** operation. It restores the
specific old content-checked object cache (or a newer same-input cache), configures
the exact GTK3 graph, repeats the header negative/positive checks and tests two
previously completed object targets. It rejects a plan with linking or more than
eight compilations, limits each target to 180 seconds, and requires a genuine hit
on each first invocation. No warmed second invocation can satisfy the gate.

An explicit **resume** requires a successful same-SHA preflight artifact and
repeats the cache check before full compilation. The existing limits remain:
310-minute compile/link cap, 350-minute total operation, 35-minute native acceptance
reserve, 355-minute job, 2 GiB available-memory and 4 GiB disk stop reserves,
and a 30-minute no-progress stop. Four compiler jobs match the measured host.
The new header registration and cache restore are different from the failed old
configuration. A preflight pass is not a private-library or PDF pass.

Only a private prefix may receive the research runtime. System WebKit hashes and
sandbox settings remain protected. Exact runtime loading, Chinese extraction/
search, original/radical counterexamples, fallback/wrapping/pagination and link
annotations remain separate native outcomes. No system replacement or release.

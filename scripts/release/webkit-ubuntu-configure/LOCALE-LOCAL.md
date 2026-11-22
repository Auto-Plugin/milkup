# Local-only stream and locale follow-up

Base: fce75b5e24dc7e9364cd995d9f7267775bf76f10. No workflow/request marker change or remote action is included. The old exact-parent CI launch gate is intentionally not rearmed.

The 833-package candidate preserves all 832 previous entries and adds libc-bin 2.43-2ubuntu2.7, authenticated via Ubuntu resolute-security InRelease, its Packages index and exact .deb SHA-256 c0393ea4fa3c45cefe0351db369d3a4a459edc8045856f2e3612ca17e77b2797 (701250 bytes). Its two libc6 version constraints match pinned libc6 2.43-2ubuntu2.7. No maintainer scripts execute. The package provides 12 C.utf8 files under /usr/lib/locale.

The entry now requires an actual same-SDK-root locale A/B gate before compiler/configuration. Both probes use the existing stock namespace definition, ordinary UID, readonly SDK root, no host /usr mount, no LOCPATH or LD_LIBRARY_PATH. The negative differs only by a readonly owned empty overlay at /usr/lib/locale. Positive Python/Perl locale and exact mapped locale hashes must pass; negative must reject locale without fallback. Both reports are saved before semantic validation; stage logs retain execution failures. Synthetic receipt/argv tests cannot certify this native gate.

The current executor rejects namespace admission: /usr/bin/bwrap is UID 65534 rather than required root owner. About 1.35 GiB is free, below the unchanged 24 GiB admission/12 GiB reserve. No namespace launch or security workaround was attempted. Actual same-root locale A/B, full Ubuntu configure, 48-site classified execution and exact four resources remain NOT RUN. A future run needs an independently admitted matching ordinary-user SDK environment and an explicitly reviewed exact-parent trigger; this patch does not authorize or arm it.

The previous LOCPATH-only local negative was invalid: it fell back to host locale data. Its failure remains evidence, not a passed isolation test. Debian archive byte provenance remains distinct from the rejected expired upstream detached signature.

The legacy classifier hash streams now close on success, mismatched source and digest exceptions. Against the old code, three of four handle tests fail; the repaired code passes. The embedded namespace receipt hash helper also uses a context manager. No classifier semantics or CMake evidence budgets are relaxed.

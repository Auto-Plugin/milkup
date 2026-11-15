# Actual TU gate scope review

No equivalent e4ddbe12 run existed (repository-wide SHA query returned zero).
The new preflight 43657503605/d3f13a5a stopped before compilation: unified source
includes are relative to compiler include roots. The resolver was corrected using
actual configured include-search order and tested against relative/absolute cases.

43657723234/1a974199 is green in Actions, but **is not accepted as the requested
narrow-scope gate**. Its real object results are useful and retained:

- Missing-inline variant: exit 1 after 31.034 s for the exact original error.
- Fixed PrintContext actual unified TU: exit 0, 33.340 s.
- Fixed OutlinePainter actual unified TU: exit 0, 31.441 s.
- Fixed GraphicsContextSkia actual unified TU: exit 0, 6.829 s.
- Actual configured/Ninja arguments matched, CCACHE_DISABLE=1 for these compiler
  invocations, 1939 generated-header hashes retained, source restored.

But `ninja -n -v cmake_object_order_depends_target_WebCore` printed only two
manifest-regeneration commands. The subsequent execution of that umbrella target
included **1746 object-build entries and 8 link entries** (some may be cache hits;
these counts do not assert every entry executed Clang code generation). This was
an unintended scope expansion, despite no full WebKit runtime being installed.
No geometry continuation was dispatched from this green run.

Correction: refresh the CMake manifest separately, query the complete graph with
`ninja -t commands`, select explicit header/bindings-copy targets instead of the
library object-order umbrella, and reject compiler/linker invocations, including
quoted/versioned executables. Validate actual verbose header execution as well.
The old regeneration-only plan is a negative unit test. This is a scope fix, not
warning suppression or a relaxation of the native compiler or PDF contract.

Original artifact 14138128475: 1464359 bytes,
SHA-256 ab2e387f880b3c6899b7e454039eaa2a1596609a36cced3d4ac9a2cdec1c48ef.
Failed resolver artifact 14138263761: 444733 bytes,
SHA-256 5ea8b73b46e9851c545c97e81dfe9421cf768f22aa055e5643ca821b8180a8ab.
Both are retained byte-for-byte in /workspace, with extracted original logs.

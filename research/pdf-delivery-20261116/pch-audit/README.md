# PCH prerequisite review before the next unique TU gate

Exact official 2.54.2 source stream was rehashed. The retained CMakeLists/Prefix/config/platform/compiler files are locked in source-lock.json. WebCore uses WEBKIT_ADD_PREFIX_HEADER(WebCore WebCorePrefix.h), and the configured object groups preserve this prefix.

The actual 43849878532 compile database selects two PCH producers: WebCore.dir and WebCoreStyle.dir. Their actual Ninja edges have only the generated cmake_pch.hxx.cxx as explicit input, cmake_pch.hxx as implicit input, plus the target-level order-only group. Both direct generated files are required and copied with hashes before compilation. The official source files are checked again on the runner.

The prefix directly names eleven generated WebCore headers; all eleven are present in the prior actual generated-header receipt, with hashes reproduced in actual-graph-review.json. Normal generated config and forwarded private headers were also created by the already verified generation stage. This is not a claim that every conditional transitive include has already been compiled: the actual PCH compile remains the gate.

The full FontCascade Ninja command graph includes 359 compiler commands and two link commands, largely inherited through target-wide order-only dependencies. Running that umbrella would exceed this narrow gate and compile unrelated WTF/bmalloc/LLInt work. We do not run it. Only the two explicit PCH compiler commands, checked byte-for-argument against their configured Ninja commands, then ten selected TU commands are executed. No PCH/flags/features are disabled. No old objects are used.

An ordinary compiler exit 1 with an error diagnostic is retained and independent work continues under the same deadline/resources. A failed PCH skips only dependent TUs with an explicit reason. Timeouts, unknown/killed exits or resource failures stop. Any failure or skipped unit makes the overall gate fail. No product or output behavior changes.

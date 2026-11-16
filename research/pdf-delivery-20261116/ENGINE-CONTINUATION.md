# Representative frontier and bounded normal engine continuation

This extends the actual 24+4 proof from 43864252208. It does not repeat that batch
as a throughput sample. The normal FontCascade dependency graph already contains
358 object edges, a real WebCore PCH, generated headers and two linked LLInt build
tools. The first job requests the ten actual changed WebCore translation units,
therefore exercising their complete **original Ninja prerequisite graph** and both
required PCHs, rather than invoking isolated compiler commands for those objects.

No repository `.agents/skills` directory or applicable AGENTS.md was present in
this checkout/workspace. The existing source-gate, graph, package-boundary and
355-minute manual research runner policies were read. No paid runner is added.

## Choice and execution bounds

One manual operation, two clean Ubuntu 26.04 jobs:

1. **60-minute frontier job**, 54-minute work deadline. Restore the exact 28-object
   predecessor (inner SHA `acd9c6c96cf12828654c1ab17be025dbcbd264ce6c3cc24a838595d8b43cf655`),
   with its pinned original manifest and exact source/config/tool/graph checks.
   Prove native no-op for those objects, then request ten real WebCore targets.
   The original commands include their generated-input, helper, WTF/bmalloc and
   PCH dependencies. Two compiler jobs; at most 40 minutes for this stage, further
   clipped to leave ten minutes of work time for checkpointing. This is a new
   representative dependency frontier, not another libpas-only sample.
2. **355-minute clean successor**, using the already-existing hosted runner
   allowance and a 340-minute work deadline. Load only the successful same-run
   checkpoint; validate full identities and source/host/generated inputs; rebuild
   PCHs and necessary LLInt tools with original commands and require byte equality.
   Restore objects and native dependency metadata, prove zero old compiler calls
   on the original frontier, then compile eight additional downstream WebCore TUs.
   If this succeeds and at least 30 minutes of object-build time remain, continue
   the ordinary default engine graph rather than manufacturing many tiny jobs.
   Object compilation is capped at 270 minutes with 45 minutes left for linking
   and retention. Shared linking is forbidden in the parallel object plan; the
   final upstream `all` target runs with **one job**, at most 35 minutes. No compiler
   invocation is accepted in that final link phase.

The measured source/TU prerequisites and 24+4 work do **not** predict total engine
completion or large-link peak RSS. This run measures that instead of promising it.
Compile/link descendant-tree RSS (PID plus process birth identity, including separate child groups), available memory, free storage and actual Ninja
completion progress are sampled every ten seconds. Stop below 2 GiB available RAM,
8 GiB free disk, on a stage deadline or after 30 minutes without a completed edge.
Stop and reap the owned process tree before capturing outputs. There is no cold
fallback, automatic retry, 2.52.6 cache, changed compiler flag or sandbox override.
A failed frontier prevents its successor. An incomplete long job remains failed
and retains a verified completed-object checkpoint when one can be constructed.

## General checkpoint contract

The schema is `milkup-current2542-frontier-v2`, not the old limited 24+4 schema.
The one predecessor import is explicitly pinned; its producer identity is not
silently rewritten. Subsequent checkpoint identity binds the complete source and
patch, generated ABI/configuration, original graph and compile DB, compiler/tools,
SDK inventory, base generated headers, actual generator/link executables and all
harness file hashes. A documentation-only Git SHA may differ; executable harness
content may not. Producer SHA remains recorded independently.

All completed native dependency records must be VALID and match actual output
mtimes. Every compiler input, including explicit PCH dependencies, is content-bound.
Only owned source/build timestamps may be restored; host bytes and timestamps must
already match and are never changed. The archive contains original object bytes,
depfiles, native Ninja metadata, and source-derived **generated compiler inputs**
with original output provenance. It does not contain PCH binaries, ELF executables,
shared libraries or static runtime archives. Generated script/file modes are
preserved without special/set-ID bits; symlinks may resolve only within the owned
build/source trees. Unknown or conflicting content rejects reuse.

PCHs are regenerated with the original `-fno-pch-timestamp` compiler commands and
must match both their binary hashes and depfiles. Required build tools are relinked
from restored original objects and hash-checked. Their original timestamps and
verified normal metadata are restored only after those checks. Missing phony
outputs remain missing; the harness does not invent successful targets. Final
runtime/shared links are not restored from the cache and must really execute.

Archive identity is checked before writing to the real build. Transport extraction
uses a separate owned staging tree, regular-file/path/size restrictions, exact
member sets and hashes, an 8 GiB raw limit, 256 MiB/member and 2 GiB compressed
limit. Checkpoints are kept as normal Actions artifacts for 30 days. Original
receipts/manifests/resource samples are separate from large reusable object data.
The latest successful checkpoint is retained without discarding prior stage
receipts or disguising an incomplete build as success.

## Cheap gates and remaining package boundaries

Local real Ninja/C compiler tests exercise generated headers, a genuinely rebuilt
helper, no old object compilation, new downstream work, source mismatch and corrupt
member rejection. Local Clang is absent; the real Clang-PCH version of the fixture
must pass in the SDK-equipped job before official source/configuration/large work.
The retained real WebKit graph is also checked against its actual compile DB.

Even successful default engine linking only yields a build result. Exact final
prefix installation, supported-host ABI/closure, license/SBOM completeness,
security maintenance/rebase, install/upgrade/recovery and same-package native PDF /
printing remain required. No research behavior pass or another package's results
are inherited. No system WebKit replacement, broad LD environment, formal signing
or channel configuration, notification/security change, main merge, external post
or product release is performed by this operation.

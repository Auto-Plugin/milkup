# Current-engine continuation: dispatched, no native build conclusion yet

- Source candidate: `c112490f801aaa1b6a69480ef40f2eb9e5e53060`.
- Sole manual run: https://github.com/Auto-Plugin/milkup/actions/runs/43873062633 .
- Both repository-wide running and queued lists were empty immediately before dispatch.
- Created 2026-11-16 13:09:16 UTC; frontier job started 13:09:20 UTC.
- First job hard limit 60 minutes: 14:09:20 UTC. Internal work limit 54 minutes.
- Only a successful frontier enables the same-run clean successor; its hard limit
  is 355 minutes from its own start, internal work limit 340 minutes.
- No independent retry, paid resource, existing-run cancellation, installation,
  native PDF probe, production configuration, main merge or release is scheduled.

Local checks: 36 current-workflow contracts passed; 3 additional checkpoint tests
passed. The real Clang PCH fixture is explicitly skipped locally because Clang is
absent, and is mandatory after the official SDK installation and before the costly
source/configuration/build in the runner. Python, YAML, embedded Python, multiline
shell syntax and Git whitespace checks passed. The old restore-workflow test was
scoped to its own job; it previously interpreted a later job's literal `run: |`
as a shell command. Its original restore assertions remain intact.

Planning evidence from the retained actual 43852458294 graph: the requested changed
WebCore frontier and prerequisite logs have 369 unique compiler targets including
two original PCHs, plus 5,937 distinct noncompiler commands. The full compile DB
has 2,833 entries with original `-O2 -g1`; the retained graph has 15 link edges.
These are graph counts, not completed current targets or an elapsed-time forecast.
Normal compilation uses two jobs and final ordinary links use one. Actual sampled
process-tree RSS, free memory/storage and completed-edge progress are retained.
See ENGINE-CONTINUATION.md for cache identity, archive and stopping contracts.

The temporarily omitted duplicate old evidence ZIP was restored byte-for-byte
and its Git skip-worktree flag cleared. All unique prior evidence and pre-existing
untracked files remain untouched. Current local free space is about 260 KiB;
no local engine build is attempted.

**Pending:** current real PCH fixture, old 28-object import, representative normal
WebCore dependency completion, checkpoint capture, fresh-job general restoration,
additional objects, complete engine linking, and every package/native runtime/PDF
acceptance. No successful earlier research or different-package result substitutes
for these gates. Actual result will be appended after the run reaches a boundary.

Status checked 2026-11-16T13:21:44.440386+00:00 UTC: workflow and
frontier job remain in progress at the original restore/build step. The current
workflow-contract step passed; no current native phase receipt is available yet.
The second job has not started. No duplicate run was dispatched.

## Terminal review of 43873062633 and corrected successor

Original artifact 14229498218: 13,966,510 bytes, SHA-256
`a1ac47f2630c4447295d21f708827b445d764f3e7fa4e48e28a00ccd03a0d13f`.
Downloaded into memory and checked before inspection. Compact original logs and
losslessly encoded result fields are preserved under `evidence/43873062633`.
The original ZIP remains the authoritative byte-for-byte source.

The SDK real-Clang frontier contracts passed (17.252 s). Exact 28-object import
and native no-op passed. The representative real graph completed 369 compiler
targets, including two original PCHs and ten affected WebCore TUs: 341 new compiler
executions, zero old recompiles, exit 0 in 495.144 s. Sampled peak process-tree RSS
was 3,988,848 KiB, minimum free disk 88,098,312,192 bytes, and minimum available
memory 12,257,222,656 bytes. These samples are not unsampled peaks.

The first checkpoint failed in 1.418 s with `timedOut=false`; the stopped-object
fallback failed at the same predicate. Overall 1306.796 s is not a timeout.
The old capture predicate required every `ninja -t deps` entry to be a compile DB
object. The retained actual CMake graph also gives the two generated-header helper
link rules `depfile` plus `deps=gcc`. The retained normal plan has ten C++ linker
commands with `--dependency-file`, plus five unrelated glib resource generator
commands with the same option spelling. A real local Ninja/GNU linker fixture
reproduces the exact frozen old capture assertion and succeeds with the revised
compiler/link classification. The old packer did not save the raw dependency DB,
so the exact first rejected target in that run cannot be named from the artifact.

The 114-member evidence ZIP has no object/PCH bytes, checkpoint tarball, or raw
`.ninja_deps`/`.ninja_log`. The newly compiled 341 targets are **not recoverable**
from it; an upload step completing is not checkpoint retention. The original
28-object predecessor remains the only reusable checkpoint for this successor.

Schema v3 binds dependency-tracked links to original commands/depfiles, validates
their actual input hashes and timestamps, accepts only the linker's empty phony
input rules, and still rejects unknown or stale compiler records. Helper binaries
are relinked and hash-checked; shared runtimes and PCH bytes are not archived.
Raw dependency and Ninja log text are now gzip-preserved before classification,
including a failed pack. The local real fixture proves old rejection, corrected
archive/restore/no-op, new work, changed-input and damaged-member rejection.
Cross-job v3 recovery of the real WebCore frontier remains untested.

`current-engine-normal` is a new explicit manual operation: one existing
ubuntu-26.04 job, 355-minute hard limit, 340-minute internal work limit. It restores
the exact retained 28 objects, completes/checkpoints the real frontier, then
continues the ordinary default graph in the same process/workspace. This avoids a
second SDK/configuration and PCH regeneration just to reach full compilation.
Compilation remains two jobs; final normal links one job, with 45 minutes reserved
before the object phase and a 35-minute link ceiling. Original source, final QA
prefix, flags, ABI, functionality and sandbox remain unchanged. Memory below 2 GiB,
disk below 8 GiB, 30 minutes without a completed Ninja edge, or stage deadline stop
the owned process tree and attempt bounded checkpoint retention. No cold fallback,
automatic retry, installation or native PDF test is included. Full engine linking,
final-path package closure and same-package native acceptance all remain pending.

Local checks: seven frontier contracts ran (six pass, real Clang PCH skipped
locally and mandatory after official SDK); eight #255/#94 orchestration/wiring
contracts pass. 37 current-workflow contracts pass with three local-Ninja skips
when the temporary SDK has been removed. For the full contract invocation, the
exact old `43856901779/original.zip` was read from Git into memory and SHA-checked
because its duplicate working copy is temporarily omitted under skip-worktree to
provide space; test assertions were unchanged. This memory-only substitution is
not used in CI. An initial invocation without that fixture failed, and is not
reported as a product/build failure. Local disk capacity remains a blocker to any
engine build. No unique evidence was discarded; historical watch logs were briefly
losslessly archived, then fully restored to their original paths.

### Sole corrected run (not a build conclusion)

Candidate `9dbb2062faa983185b993f8b8f7681ee769a70f6`, correct LarryZhu-dev author and
committer. Both repository-wide running and queued lists were empty immediately
before manual dispatch. The sole successor is
https://github.com/Auto-Plugin/milkup/actions/runs/43890194973 .
`current-engine-normal` job 133379004159 started 2026-11-16 14:51:39 UTC.
Hard job deadline: **2026-11-16 20:46:39 UTC** (355 minutes); internal work ceiling
340 minutes from the recorded initial clock, with per-stage link/archive reserves.
The old separate frontier/continuation jobs are skipped for this operation.
At the first status check, checkout was running; no native result existed yet.
No second run or automatic retry was scheduled.

The old duplicate `43856901779/original.zip` has now been fully restored from Git,
byte-verified (11,169,620 bytes, SHA-256
`40da8ac78420694aeee990ddf8395c7fb96ac9697c62fc6d2da6e40347f734c1`), and its
skip-worktree flag cleared. The earlier conservative free-space check blocked
restoration, but an actual write succeeded. Thus the temporary omission and
memory fixture described above are no longer present in the working tree.
Only reproducible SDK download/extraction from this task was removed; original
historical watch logs are again present unchanged, with a verified lossless
additional copy in `/tmp/milkup-historical-watch-logs-lossless-20261116.tar.gz`.
No source, unique evidence or user data was deleted.

#94 source review and explicit unexecuted ride-along row are documented in
`issue-255/ISSUE-94-BOUNDARY.md`. Current v2 has no identified supported interface
language control; the test must not manufacture a switch through storage/DOM.
#255 still awaits native installed execution. Neither daily case is run by this
engine-only job, and neither is counted toward native release acceptance.

After restoring the real ZIP, all 37 current-workflow contracts were rerun without
any fixture substitution: 34 passed, three local-Ninja cases explicitly skipped.
The exact log is `evidence/43873062633/local-corrected-current-contracts.log.gz`.
The new real-linker frontier tests had already passed before the temporary SDK
was removed (six passed, one real-Clang-only skip).

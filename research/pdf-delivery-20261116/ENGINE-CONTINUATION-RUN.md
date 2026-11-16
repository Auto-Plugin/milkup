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

# Actual new-object continuation across two clean jobs

[Run 43864252208](https://github.com/Auto-Plugin/milkup/actions/runs/43864252208)
completed successfully on **817db1398ac62d5465fbc76f3684171e4ff335ed**.
This is the first proof here of restoring a previously compiled batch **without
compiling it again first**, then making actual new-object progress. It is not a
complete engine, shared-library link, installed runtime/package or native PDF run.

## Exact execution

| Stage | Actual result |
|---|---|
| First clean job | 24 previously uncompiled libpas objects from configured bmalloc graph; 24 compiler invocations, 12.699 s |
| Second clean job, before restore | Official source/configuration/header generation; no prior selected WebCore TUs, PCH or batch objects compiled |
| Restore checks | Exact full identity and 473 depfile input records; 16 identity mismatch controls, damaged archive, damaged object and changed actual source all rejected before writes |
| Old batch after restore | Normal Ninja runs VerifyGlobs then `ninja: no work to do.`; 24 targets, **zero compiler invocations**, 0.214 s |
| Forward progress | Normal graph schedules exactly four new targets; 28 requested, **four compiler invocations**, 0.716 s |
| Independent comparison | All 48 old object/depfile size, SHA-256 and mtime records remain exactly identical after new compilation |
| Native dependency state | Exactly 24 then 28 completed output records; each VALID and matching actual output timestamps |
| Partial link | Actual `ld -r --fatal-warnings`, 0.016 s each; final ELF REL 886,664 bytes, **not a shared engine** |
| Advanced checkpoint | 28 objects, 483 inputs (307 source + 176 host), no PCH/runtime; future third-job restore not run |

The four new sources are `pas_alignment.c`, `pas_all_heaps.c`,
`pas_allocation_callbacks.c`, and `pas_allocation_result.c`. Despite the `.c`
suffix, these are configured clang++/C++23 compiler edges. Original flags and
Ninja commands were preserved, ccache disabled, and the normal manifest was used.
No 2.52.6 objects or old research runtime were loaded. Host input files and their
metadata were never changed; only content-verified owned timestamps were restored.
The original ten WebCore TUs and two PCHs were not recompiled in either job.

Source archive SHA-256:
`a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065`.
Unchanged normal-path patch:
`855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5`.
Actual Ninja graph:
`bd0054781d9ac8178b9ffee7142d05b3616faf90cff0b428dc576bccd1826181`.
The identity also binds source/patch outputs, config/ABI/options, compile DB,
compiler/tools, SDK inventory, generated headers, selected original commands and
producer harness SHA. Both jobs matched this identity exactly. GTK3/API4.1/Soup3,
non-developer release, Unix print and default bubblewrap configuration remained
unchanged. Actual runtime sandbox/process mapping is **not exercised by objects**.

## Limits and measured resources

First job: 2026-11-16 12:11:10–12:21:10 UTC (10 minutes).
Second: 12:21:12–12:28:40 UTC (7 minutes 28 seconds).
Each had a 30-minute hard limit (12:41:10 / 12:51:12 UTC respectively), a separate
1,560-second work budget and reserved evidence time. No retry or additional run
was dispatched. Both ran all 31 local/current-source contract tests first.

Sampled minimum free disk was 88,739,549,184 bytes; sampled minimum available
memory was 14,963,372 KiB on four CPUs. These are stage samples, **not peak RSS**.
The first objects range from 792 to 260,992 bytes; this small dependency subset
is not a representative full-engine throughput measurement. Most total elapsed
time was preparation/configuration/graph validation; source matching still walks
old selected-unit metadata even though those objects are never compiled.
No complete-build or giant-link completion-time promise follows from these data.

## Retention

All four original ZIPs were downloaded, checked against GitHub artifact digests,
persisted privately in Library and independently downloaded again with identical
SHA-256. Library identifiers stay in the private handoff receipt. Actions artifacts
expire on 2026-11-23 at the times recorded in [artifacts.json](artifacts.json).
The raw result/manifests and key logs are also retained here losslessly compressed;
[retained-files.json](retained-files.json) binds raw lengths/hashes and gzip hashes.
[summary.json](summary.json) is the independently checked compact outcome.

| Artifact | Original ZIP SHA-256 |
|---|---|
| [14225331631 first-job evidence](https://github.com/Auto-Plugin/milkup/actions/runs/43864252208/artifacts/14225331631) | `9007d51b8811852587f7c014bc43125d32844f4044051e36b42b2086fe66f96f` |
| [14224894567 first checkpoint](https://github.com/Auto-Plugin/milkup/actions/runs/43864252208/artifacts/14224894567) | `849e37db62a882714573ef56684fdb5acdd719a6836bb612d3d1684615617132` |
| [14226590757 resume evidence](https://github.com/Auto-Plugin/milkup/actions/runs/43864252208/artifacts/14226590757) | `0fc9fef23c6b4806fe498272f75d735f8aa29fbfb9cac634854a7dbe54f573ce` |
| [14226595695 advanced checkpoint](https://github.com/Auto-Plugin/milkup/actions/runs/43864252208/artifacts/14226595695) | `9d71b5607578175ccde41f07402497c98d4df0ad15cda6c590746145d0497d64` |

Inner first `checkpoint.tar.gz`: 434,509 bytes,
`df2c5fa650b2f78da0d85eb993fa642a96c196f9067cfbb049762d6e3a1c0462`.
Advanced inner checkpoint: 458,108 bytes,
`acd9c6c96cf12828654c1ab17be025dbcbd264ce6c3cc24a838595d8b43cf655`.
The newer checkpoint was independently checked member by member; it has not yet
been restored in a third job. The raw `selected-objects.tar.gz` receipt's generic
`crossJobRestoreProven:false` refers to that separate archive format, not the
actual identity-bound checkpoint used and verified in the second job.

## Next boundary

The implemented operation deliberately proves a fixed 24+4 batch on one exact
candidate. Extending to arbitrary graph frontiers/PCH users requires explicit
versioned checkpoint handling and original prerequisite/command verification;
do not silently accept a different harness SHA or call this proof universal.
The advanced checkpoint and full graph are retained for that next extension.
Full shared linking, final-prefix install closure/ABI/licenses/SBOM, accountable
security maintenance and same-package native PDF/printing remain mandatory and
unexecuted here. No application/source-output behavior, main, production channel,
keys, user notifications or system security policy was changed or published.

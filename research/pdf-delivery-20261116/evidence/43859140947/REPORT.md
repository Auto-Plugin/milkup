# 43859140947: clean-job selected restoration and expanded graph proof passed

Run: https://github.com/Auto-Plugin/milkup/actions/runs/43859140947
Candidate: `e5aa1cde43d7600d3158bfb14cf3917be0e99e32`.
Job: 2026-11-16 11:35:55–11:45:29 UTC, **9m34s**, below the 30-minute hard cutoff (12:05:55 UTC). Shared work budget 1,560 seconds; final resource sample at 561.471 seconds. No other build was dispatched after this terminal result.

## Exact proof

- Official 2.54.2 source `a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065`; unchanged normal behavior patch `855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5`.
- Eleven source/configuration/compiler/tool/SDK/generated-header fields match the original successful 43852458294 receipt. All eleven mismatch controls and the corrupted-object control reject before any restore write.
- Original-parameter PCH regeneration: **2**, 40.635 seconds. Actual selected TUs: **10**, 135.627 seconds. PCH hashes and all **20 object/depfile members** equal the prior run byte-for-byte; the archived prior bytes were actually restored after this independent fresh comparison.
- Selected Ninja graph: **no work to do**.
- The old manifest-only dry-run is preserved but is no longer accepted as the target plan. A real bounded manifest refresh completed. Build graph, rules, compile database, generated configuration and CMake cache hashes stayed identical. The inspection snapshot removes only the settled RERUN_CMAKE output edge; every compiler/linker/header edge and command remains unchanged, and the exact removed block/hashes are retained.
- Expanded target plan: **541 commands**, including **357 unexecuted object compilations** belonging to other dependency targets; **zero** restored selected-object/PCH recompilations. This proves selected reuse, **not** that the whole normal graph is a no-op or built.
- Actual `/usr/bin/ld -r --fatal-warnings`: **passed**, 0.164 seconds. ELF64 AMD64 REL, 20,823,824 bytes, SHA-256 `35f2efdefdfc8615fd0d482a168f46e46a1591a582265e116c2992ef2281a8d1`, equal to the prior partial-link output. It is not a shared library. Partial binary not archived.
- **3,820** input records retained: 1,833 build-tree, 997 source-tree and 990 host files, with hashes/resolved paths/mtime records. PCH byte identities are separately retained; their binaries must be regenerated, not loaded from an archive.
- Independent verifier checks all six configuration files (**90,803,362 raw bytes**), archive/member hashes, exact snapshot delta, identity controls, expanded plan and link evidence. No inherited 2.52.6 object or runtime.

`independent-verification.json` is the strict result; `verify.py /path/to/preserved.zip` rechecks the exact original ZIP. The first run's incomplete gate remains recorded under ../43856901779 rather than being rewritten.

## Evidence retention

Actions artifact **14222593610**, expires **2026-11-23T11:45:24Z**:
https://github.com/Auto-Plugin/milkup/actions/runs/43859140947/artifacts/14222593610

Original ZIP: **11,194,509 bytes**, SHA-256 **`ea1837495bda1515d94094ffab26779f2e9b5eb8f8fa8b5ff23311e7c4d17f2c`**.
The original ZIP is also saved in the owner's Library as `milkup-current-source-restore-43859140947.zip`. An independent Library materialization was read and checked for exact size, SHA-256 and file identity. The private Library identifier is provided in the internal handoff, not published in this repository. Local duplicate transfer copies were removed only after that check; the temporarily omitted prior Git ZIP working copy was restored and its sparse flag cleared.

Object bundle inside the ZIP: **4,511,950 bytes**, SHA-256 `587c51e667a31fa857a87cc72a46d65b5b5a5231e38f902e2a7649cb41fa9f62`. Same member bytes as 43852458294; tar/gzip metadata changes mean the outer bundle hash is different.

## Continuation limits

The clean-job proof conservatively recompiles the selected objects to prove byte equivalence before restoration. It is **not yet a general no-recompile full-engine cache**. A segmented full build still needs a content-bound checkpoint/restore for all completed dependencies, actual new-target progress, archive reserve, memory/storage monitoring and a measured link budget. The configured graph has 2,833 compile entries and 20 PCHs; do not extrapolate full duration from ten selected TUs. Minimum sampled free disk was 88,104,849,408 bytes and MemAvailable 14,470,188 KiB, on four CPUs; these are stage samples, not peak RSS.

Full shared engine, normal final-prefix package, installed app/helper library mapping and live sandbox, same-package native PDF matrix, supported-host ABI, complete notices/SBOM and accountable security maintenance remain **not executed/not established**. No publication, main merge, upstream submission, production configuration, notification or security change occurred.

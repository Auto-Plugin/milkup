# Normal engine completion: retained failure and bounded successor

The original [43890194973](https://github.com/Auto-Plugin/milkup/actions/runs/43890194973), job 133379004159, failed in the artificial object/link classifier, not a complete-build timeout. Its exact error was `Shared links must remain in the single-job final phase`. No complete engine or installed runtime was accepted.

## Original bytes and recoverable contents

`local-checkpoint-verification.json` records both original artifact ZIP sizes/SHA-256, inner archive digest, all 5,567 payload member hashes and 367 ELF ET_REL objects. The two PCH entries are descriptors; PCH/shared runtime binaries are absent. The native cross-job restore in the current SDK is **pending**, not implied by offline payload validation. Artifacts: checkpoint 14237571784; evidence 14236664120. Producer: `9dbb2062faa983185b993f8b8f7681ee769a70f6`.

The producer restored 28 old objects without compilation, then executed 341 compiler commands (including two PCHs) in 285.614 seconds, with sampled process-tree peak 2,932,328 KiB. Its new archive has 367 objects. The full default graph has 2,833 compiler targets, including 20 PCHs. These observations do not establish remaining build duration or final link memory.

## Actual dependency, not a conjecture

The retained command plan, graph edges and chain show:

`libjavascriptcoregtk-4.1.so.0.11.9` → its unversioned symlink → `AutomationBackendDispatchers.h` → WebKit object-order dependency → `WKImageSkia.cpp.o`.

Thus even a request for all object targets contains a legitimate shared-library prerequisite. The old unconditional `-shared` rejection prevented the normal same-job graph from running. The local real Ninja/CC fixture reproduces this rejection, then completes with the upstream `all` target; its object checkpoint excludes the generated shared library.

## Corrected execution and boundaries

- Restore only the exact pinned 367-object archive. Explicitly reviewed harness-only changes never suppress source, configuration, graph, compiler, SDK or executable-tool identity comparisons. Regenerate PCH/build helpers with original arguments and require actual native no-op of restored objects.
- Incompatible compiled identity or generated inputs detected **before build writes** may skip the optional cache and proceed with a clean original build. Damaged transport, unreviewed changes, partial restore or native reuse failure still fail closed; no silent partial reuse.
- Run original `ninja -v -d keepdepfile -k 0 -j 2 all` in one job. Preserve upstream link pool and compiler flags; global concurrency is two, not a claim that every link is serialized. Shared runtime bytes never enter the object archive.
- A failed optional object snapshot is recorded without invalidating an otherwise complete engine. Failed build output still attempts bounded object preservation.
- Only after successful normal build, with at least 25 minutes and 20 GiB free, perform actual `cmake --install --config Release` into a new DESTDIR for the already-fixed final prefix. Preserve the exact CMake manifest and hashed payload in a **separate** runtime artifact (6 GiB raw / 3 GiB compressed maximum). This is not a deb, system installation, ordinary-user mapping or native PDF acceptance. No system library is replaced.
- The follow-up to a retained runtime is the existing `a30cc640` installation entrance, with product candidate `546796b0`, not an app built from this research branch.

## Limits and local evidence

One manually dispatched `current-engine-normal` job only, Ubuntu 26.04 on the already-used hosted runner. Hard job limit 355 minutes; internal clock 340 minutes; build step 342 minutes. The normal all target gets at most 285 minutes and leaves at least 30 minutes for staging/evidence. Memory below 2 GiB, disk below 8 GiB or no completed Ninja edge for 30 minutes stops owned build processes and preserves evidence. Separate staging/archive commands are each bounded to 600 seconds. No automatic retry or child continuation.

Local full workflow contracts: **43 passed**. Frontier contracts: **6 passed, one real Clang PCH case skipped because this local environment lacks Clang**; CI checks the installed official SDK and runs it there. Actual Ninja/CC shared-prerequisite and object-only retention tests passed. Workflow YAML, all run-block shell syntax and five Python heredocs parsed; `git diff --check` passed. No product behavior patch, official source digest, configured functionality, sandbox or final prefix changed.

Full engine linking, CMake staging, exact runtime mapping, package construction, same-package native PDF/printing and daily native cases remain unverified for this successor. Research behavior from WebKit 2.52.6 is not inherited. No main merge, release, external upstream message, production key/channel, notification or security setting was changed.

## Sole successor started

[43901289344](https://github.com/Auto-Plugin/milkup/actions/runs/43901289344), exact code `abc4bda0b644d581899092fd868f42ad03231cff`, job 133418288529. Started 2026-11-16 15:53:14 UTC; hard deadline 21:48:14 UTC. No repository runs queued/in progress at the final pre-dispatch check. Other research jobs skipped. Status at handoff: in progress; no new engine/package/native acceptance. See `successor-run.json`. This recording commit changes evidence only, not the running candidate.

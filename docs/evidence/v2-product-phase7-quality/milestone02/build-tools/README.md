# M02 candidate04 production preparation

Status: prepared only. No build, tests, formatter, runtime/package installation or GUI started by this task. Wait for root's frozen-source and exclusive build/CPU signal. M01 remains read-only.

```
python3 /workspace/milkup-p7-quality-evidence/milestone02/build-tools/build-candidate.py candidate-production-04 <exact-current-HEAD>
```

The script is derived from M01's proven no-bundle builder, but writes only into a new M02 output directory. It refuses to overwrite an existing candidate directory. HEAD is checked before execution and after completion; the working tree may contain the explicitly frozen changes, and the exact filesystem input manifest is authoritative. It includes all current desktop/packages/plugins/scripts files (including new/untracked sources and ignored embedded plugin archives), package/workspace/lock/config inputs, and records every input's hash and byte length before and after the build. Target/dist/dependency directories are excluded as outputs/caches. The prior count was approximately 677; the current actual count will be recorded rather than forced to that number.

Before building, all 11 embedded archives are parsed and recorded by exact path/id/version/hash/size; duplicate IDs, filename/manifest mismatch, missing or unexpected plugin identity fail closed. One and only one version of each expected plugin is allowed. The archive contents are included in the normal before/after source hashes. Existing M01 ELF hashes are recorded and rechecked without copying or rewriting those files.

Only the existing `tauri build --no-bundle --ci` command runs, with the same cloud environment and dependency verification overrides as M01, plus `COREPACK_ENABLE_NETWORK=0` to require Corepack to reuse its installed package-manager cache without network access. Existing release cache is reused. Raw build output, exit code, input drift, HEAD, frontend asset hashes, free-space observations, candidate ELF hash/size, and unchanged-M01 checks are retained in the new directory. Any build error or input/HEAD/protected-artifact drift prevents promotion of a frozen candidate ELF. A successful build copies exactly one new candidate ELF, never an old binary or whole target cache.

The script has only been prepared, not executed or syntax-tested during the CPU-exclusive native diagnostic window. No candidate-production-04 directory is created before actual execution. No claim of native runtime acceptance follows from a successful future build.

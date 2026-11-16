# 2.54.2 actual selected TU gate: passed, no engine/package/native acceptance

- Exact candidate: `ae1f50b4640abd45e84476977b95e9d1a93f6a75`.
- Only dispatched run: https://github.com/Auto-Plugin/milkup/actions/runs/43852458294 . No queued/in-progress equivalent before dispatch; no automatic follow-up.
- Job: 2026-11-16 10:50:49–10:59:48 UTC, **8m59s**, conclusion success. Hard cutoff was 11:20:49 UTC (30 minutes); driver work limit 1,560 seconds plus retention reserve. Actual receipt elapsed 534.446 seconds. No step timeout.
- Exact original artifact: https://github.com/Auto-Plugin/milkup/actions/runs/43852458294/artifacts/14220825095 . 10,077,772 bytes; SHA-256 `0ad80c72160dbda4d6f5968a10977d9db7d0f355016d9785469a14c060e5027f`. GitHub expiry 2026-11-23 10:59:44 UTC. The complete verified ZIP is also committed here; it contains no runtime or secret.

## Required prerequisite review and unchanged identity

Before dispatch, the prior real compile DB/Ninja graph was inspected and the official source prefix/CMake/config headers retrieved under the full archive lock. Two precise PCH producers were selected. Their direct explicit/implicit input contract and the eleven directly named generated WebCore prefix headers were checked; all eleven had prior actual generation hashes. The broad target-order graph (359 compiler commands and two links) was deliberately not invoked. Only the exact selected PCH commands were executed, with original arguments and no feature/PCH/warning suppression. The actual PCH success in this run now verifies the transitive headers needed by those PCHs, beyond the prior static direct-input proof.

Official 2.54.2 archive SHA remains `a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065`; normal-path patch SHA remains `855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5`. All 22 patched file hashes match. No 2.52.6 object/cache or runtime was used.

Actual configuration: Release, non-developer, GTK3/API4.1/Soup3, GTK Unix printing present, bubblewrap sandbox enabled, fixed final QA prefix `/opt/milkup/runtime-qa/webkitgtk-2.54.2-855e58cc8ad531cc`. CMake consumed all requested settings. Generated configuration SHA is `59a70843b1ae92407c888ec17fd8f28f2325be5ce82756a4171b4d5bbc79b0bd`. Compiler binary SHA is `78e9dd2ccc9e88859b3a29109a44bfab00e3d6cb70f00f3daae063eed3d05251`. No live process sandbox or installed mapping is inferred from configure values.

## Actual compilation results

| Exact target | Seconds | Result |
| --- | ---: | --- |
| WebCore PCH | 15.056 | exit 0 |
| WebCoreStyle PCH | 25.530 | exit 0 |
| FontCascade actual unified TU | 14.748 | exit 0 |
| GraphicsContext actual unified TU | 7.232 | exit 0 |
| DisplayListItems actual unified TU | 8.183 | exit 0 |
| DisplayListRecorderImpl actual unified TU | 9.388 | exit 0 |
| FontSkia actual unified TU | 7.535 | exit 0 |
| GraphicsContextSkia actual unified TU | 7.532 | exit 0 |
| OutlinePainter actual unified TU | 17.908 | exit 0 |
| RenderBlockFlow actual unified TU | 34.099 | exit 0 |
| RenderTable actual unified TU | 17.258 | exit 0 |
| RenderTableSection actual unified TU | 21.518 | exit 0 |

All twelve compile logs contain zero warning diagnostics, all stages exit 0, no failed/skipped unit and no retention error. PCH sizes are 176,397,908 and 328,656,248 bytes; commands, generated prefix inputs and hashes are retained. PCH binaries are intentionally **not archived** and must be regenerated for future work. The successful ordinary generated-header execution has 5,746 commands plus one allowed glob check.

## Independent artifact verification and reusable evidence

`verify.py` rereads the actual ZIP, independently compares both PCH and all ten TU commands with the configured Ninja commands, checks actual unified-source hashes and PCH input hashes, reconstructs all configuration parts, and verifies the archive members. Output: `independent-verification.json`.

- Six configuration files restored with exact hashes, **90,803,362 raw bytes** in total. Large files retain ordered gzip parts with per-part and whole-file hashes/lengths; no truncation or changed graph.
- Twenty object/dependency files (ten `.o`, ten `.d`) verified, **23,264,931 raw bytes**.
- Inner `selected-objects.tar.gz`: **4,511,972 bytes**, SHA-256 `e4bd82d1e911e978c2c400e73342efc74fdd05c52963910f54779b1aecfefb3f`.
- Identity binds source, patch, compiler, generated config and compile DB SHA `d17709e8ea25829b8a2e94fc0aa7c51515c24e209acb334f6930e2e04a60c3fa`.
- **Cross-job restoration remains unproved**. These are retained precise objects, not a proven transferable complete engine cache.

The four-CPU runner's minimum sampled free disk was 88,223,666,176 bytes and minimum sampled MemAvailable 14,762,364 KiB. Samples are stage boundaries, not peak memory. Full compile DB contains 2,833 entries; selected TU timings must not be extrapolated into a guaranteed full-build duration.

31 local tests passed before dispatch, including producer/input/argument negatives and collecting an ordinary compiler error while continuing independent work. Unknown/killed exits, timeouts and resource failures still stop; any compile error or skipped dependent TU leaves overall failure. Those negative scenarios were local tests, not faults injected into this successful native run.

## Still not executed / next boundary

No full engine/link, runtime installation, application loading, actual WebProcess mappings, same-package PDF/printing 15-case matrix, installation/recovery/uninstall or final-host ABI was executed. The old private 2.52.6 results do not supply these results for the normal 2.54.2 path. No production readiness claim.

A future full-build plan must first validate reuse of the retained exact 2.54.2 objects (PCH regenerated), establish bounded continuation/time/resource/archive rules and retain link/native-test margin. It must derive actual install/ELF/resource closure and licenses/SBOM from the same configuration, prove final-path loading and default sandbox, then run the original native behavior gates with the same candidate. The separately saved configured-static-components inventory is a preliminary graph inventory only. Security maintenance owner, supported-host ABI, safe update/recovery and sustainable distribution remain open. No full-build CI was dispatched here.

No main merge, publication, upstream message, production configuration/key, personal notification or system-security change.

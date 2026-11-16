# 43856901779: selected restore/partial link proved; normal-graph proof incomplete

Run: https://github.com/Auto-Plugin/milkup/actions/runs/43856901779
Candidate: `f2f768c36c9019c9a3436b6a74dd2b09d5504dd3`.
Job: 2026-11-16 11:20:40–11:29:21 UTC, 8m41s; 30-minute hard bound / 1,560-second shared work budget.
Actions is green, but independent raw-log review **does not accept the whole incremental-readiness gate**.

Verified from original artifact 14221434924 (expires 2026-11-23T11:29:17Z):

- ZIP 11,169,620 bytes, SHA-256 `40da8ac78420694aeee990ddf8395c7fb96ac9697c62fc6d2da6e40347f734c1`; exact original retained beside this report.
- Eleven source/configuration/compiler/tool/SDK/generated-header identity fields match 43852458294. Eleven mismatch controls reject before writes; corrupt-object control rejects before writes.
- Two original-parameter PCHs and ten real TUs freshly compiled; PCH bytes and all twenty object/depfile members match the old run exactly. Those old bytes were actually restored, and the selected minimal Ninja graph reports `no work to do`.
- Actual `/usr/bin/ld -r --fatal-warnings` succeeds, ELF64/AMD64 REL, 20,823,824 bytes, SHA-256 `35f2efdefdfc8615fd0d482a168f46e46a1591a582265e116c2992ef2281a8d1`. This is **not** a completed shared library. Partial binary intentionally not archived.
- 3,820 compiler-input identities and Ninja metadata retained. New object archive 4,511,951 bytes, SHA-256 `24d97a29216c98686ccc74722a9eb07b30b8f98287edb4f2058c571cd3727086`; archive metadata differs, member bytes do not.

The normal graph dry-run contains only VerifyGlobs and `cmake --regenerate-during-build`. Ninja has not expanded the post-regeneration target plan. `normalGraphSelectedRecompiles=[]` is therefore insufficient, and the original reporter's success overstates this one gate. Do not edit the raw report to hide it. `verify.py` produces the independent strict status `partial-proof-normal-graph-not-expanded`.

A real local Ninja 1.13.2 reproducer confirms the mechanism: an always-checked, restat glob stamp causes `-n` to assume manifest regeneration, even after a real manifest refresh. This is a dry-run observation limitation, not evidence that restored compilation fails. A corrected inspection must first execute only the real manifest refresh, verify unchanged graph/configuration identity, then inspect the exact compilation graph with only the already-settled manifest-rebuild edge excluded from its inspection snapshot. No compiler edge, command, dependency, feature or product flag may change; unexpected regeneration or graph changes fail closed. Test the rejected old output and positive/dirty-header controls before another native job.

No engine build, runtime installation, package mapping, native PDF matrix or production release was performed. The unchanged normal behavior patch remains `855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5`. Earlier research-engine passes are not inherited.

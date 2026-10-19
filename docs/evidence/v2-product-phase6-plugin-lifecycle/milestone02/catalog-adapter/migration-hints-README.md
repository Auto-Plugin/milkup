# Migration hint validation protocol follow-up

Read-only review found that native migration verified safety-critical package fields but accepted manifests rejected by the shared full TypeScript schema. A bad legacy item could poison the complete returned snapshot. Parent authorized a narrow jointly implemented protocol correction instead of duplicating the entire schema in Rust.

`migrateLegacy(raw)` now preserves raw bytes and sends versioned SHA-256-bound validation hints: original row index and exact original manifest JSON, only after full shared manifest and legacy record checks. Invalid rows have no hint. Native independently verifies the hint/raw/disk identity and all installation safety checks. Hints confer no capability approval. Missing hints cannot authorize import.

`migration-hints-red.log`: 2 failures, 22 passes before adapter change. `migration-hints-green.log`: 24 passes afterward. `migration-hints-types.log`: desktop TypeScript check succeeded with no diagnostics. Tests check exact SHA/raw/index and retention of original non-normalized manifest metadata; a missing-name neighbor is excluded while the valid row remains. Actual native migration failure injection remains in the root/native proof, not claimed by these mocked-invoke adapter tests.

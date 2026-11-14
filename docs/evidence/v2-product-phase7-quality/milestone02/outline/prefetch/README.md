# Bounded prefetch regression

Production evidence motivating the experiment is in ../CANDIDATE03-DIAGNOSIS.md: sparse folded-root page reads occupied most of one slow observed operation. The change overlaps at most two existing four-page getMany calls. Promise.allSettled drains both before propagating an error; Promise.resolve().then also captures synchronous adapter throws. Cache insertion, eviction and dirty flush stay serial and in the original order. Read rejection publishes no new pages from that pair. Missing/invalid JSON may retain earlier valid cache entries, as before; tests verify retry correctness rather than claiming atomic validation.

RED command (exit1; four expected failures):

`node node_modules/vitest/vitest.mjs run --config scripts/ci/outline-tests.config.ts plugins/outline/src/outline-index.test.ts -t 'overlaps at most two bounded page reads|drains the sibling page read' --maxWorkers=1`

GREEN command (exit0;40 PASS):

`node node_modules/vitest/vitest.mjs run --config scripts/ci/outline-tests.config.ts --maxWorkers=1`

Tests use a complete18000-heading hierarchy, warm all headings, fold to20 sparse roots, and verify exact ordinals/titles/offsets. Controlled asynchronous reads prove maximum concurrency2 and at most4 keys/call with512KiB serialized response payload, no writes, and no early completion while the sibling read is pending. Rejection, missing-page and malformed-JSON branches all drain and support a complete retry. Existing independent hierarchy/oracle tests cover all labels, folds, later appends and500-row limits.

512KiB is a serialized UTF-8 payload bound, not a JavaScript heap or process RSS measurement. Native performance benefits remain unverified until candidate04 tests. All logs, including first strict test-type failures outside this folder, are retained.

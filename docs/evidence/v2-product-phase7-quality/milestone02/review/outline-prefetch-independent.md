# Independent read-only review — bounded outline page prefetch

Review scope: the `Pages.prefetch` candidate in `plugins/outline/src/outline-index.ts`, adjacent cache/visibility/session lifecycle code, public temporary-storage validation, and the author's retained RED/GREEN logs. This reviewer did not run tests, formatters, builds or GUI work and did not edit the candidate. Final source hashes are recorded separately in `outline-prefetch-independent-proof.json` after matching the author's final freeze.

## Conclusion

No blocking semantic or resource-ownership regression found in the reviewed change. It overlaps at most two four-key `getMany` calls per prefetch iteration, then applies results in original batch/key order. This is a bounded read scheduling change, not a guarantee of native latency improvement. Serialized-response limits and cache limits remain distinct from actual JavaScript heap usage.

## Error drain and publication

`Promise.resolve().then(() => store.getMany(batch))` turns a synchronous adapter throw into a rejected promise without preventing the sibling request from starting. `Promise.allSettled` observes both results before error propagation or cache insertion. Therefore a rejection cannot escape while the sibling read remains unobserved. Errors are selected in input-batch order; this does not introduce retries or suppress a failed read. An indefinitely pending adapter would delay completion, but the real public RPC retains its existing timeout/revocation limits; this patch does not remove them.

After successful read settlement, missing values or malformed JSON still throw during sequential processing. Earlier valid cache insertions can survive a later validation failure, just as the previous sequential implementation allowed. This is not atomic cache rollback. The initial comment incorrectly generalized “failed pair publishes no new pages”; the author narrowed it to “Rejected reads publish no new pages.” No behavioral change was requested to manufacture a stronger guarantee.

## Cache order and bounds

Missing keys are deduplicated and selected from the same original cache snapshot. The only loop-width change is advancing eight keys instead of four; each request still carries at most four keys. Both read responses are held only for that iteration. On the actual public path, per-response validation retains the 256 KiB UTF-8 limit, hence at most 512 KiB serialized response data per pair. This is not a claim that the UTF-16 strings plus parsed objects occupy only 512 KiB of JS heap.

Insertion still awaits `room()` per key and calls `JSON.parse`/cache set in original order. The 24-page cache and eight-page eviction remain unchanged; dirty flush and cache mutations do not overlap within prefetch. A rejected pair inserts neither response. Read success can be followed by a flush failure or JSON error, which remains explicit. No full-document directory or additional unbounded heading cache is created.

The caller path matters: outline operations run on the existing session queue, `rows` awaits each bounded row chunk, and `Visibility.selectFrom` processes child branches sequentially after its own prefetch. Thus the reviewed production path does not multiply two-request pairs via new parallel recursive branches. This is not a thread-safety guarantee for arbitrary new concurrent calls on an `OutlineIndex` instance.

## Version changes and cancellation

No lifecycle interface changes. Session retirement synchronously marks the old session inactive, cancels timers/scanning, then waits its existing queue before disposing the temporary store. `prepareRows` checks current session/request after awaited storage work before committing visible rows; the queued refresh checks request currency before UI update. A pair may finish reading/parsing into the retired instance's private cache, but cannot by itself publish rows into the replacement session. Because both requests settle before the queue operation finishes, the new parallel read does not leave an unobserved sibling behind the queue's cleanup barrier. These conclusions rely on the existing public host revocation and store behavior, which remain unchanged.

## Author's evidence, not reviewer reruns

- `../outline/prefetch/red-01.log`: four new tests fail on the old sequential implementation; the expected second read never becomes concurrent.
- `../outline/prefetch/green-01.log`: all **40 outline tests pass**, including the 11 progress-coalescing cases and four prefetch cases. This supersedes the earlier progress owner's explicitly scoped 36-pass/4-skip run for the tested combined source.
- New cases use a full 18,000-heading sparse-fold fixture, validate root ordinal/title/from order, measure a peak of two read calls and bounded response payload, retain unchanged write count, and force synchronous rejection, missing data and malformed JSON while holding the sibling read. They verify the sibling is drained before rejection and a complete retry still returns all expected rows.

The failure fixtures inject invalid data into the first response. They do not exhaustively exercise every later-slot malformed response or every host process-revocation timing; existing sequential partial-cache behavior and lifecycle checks were additionally reviewed in source. No new Windows/macOS/native performance or physical rendering claim follows from these unit results. Final independent packaging/strict test-type evidence belongs to the author's separate proof and must not be inferred from this read-only review.


## Final freeze binding

The four final source/test hashes match the author's freeze exactly; see the companion JSON proof. Final independent package verification identifies outline **1.3.3**, public SDK **0.3.7**, archive SHA `80a9ce947c4abf2998eb72c36c327d5d826f0d30fa22dad61f903ff4713ca5c6`, and zero runtime imports. Its recorded product input hashes match the reviewed `plugin.ts` and `outline-index.ts`. The final external `tests-final.log` reports **40 PASS**. This reviewer read those records rather than repeating execution.

The subsequent test-only public SDK completeness changes add throwing stubs for unexpected required host operations, complete viewport fields, and explicit heading query fields. They do not weaken behavioral assertions or change scanner cancellation semantics. The original strict-test-type failure remains at `outline/external-1.3.3/test-types.log`; the final log/proof are separate. The earlier progress proof's test hash intentionally records pre-stub bytes; this final review binds the later complete test source. Product `plugin.ts` remains hash `3fa3d659e3934a1ecd1763741979fac4a60f6b5247c4974111fa0d16152e083d`.

Final conclusion: **no blocking finding in this bounded prefetch change**. Native performance improvement and cross-platform behavior remain to be measured; this review does not close those acceptance items.

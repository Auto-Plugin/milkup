# Explicit source document-navigation completion

`SourceDocumentViewConfig.onDocumentNavigation?: (edge: 'start' | 'end') => void` is an additive, optional view-dom host callback. It is not a core or plugin SDK API. Omitting it preserves navigation without a notification. Desktop host wiring is owned by Root.

The callback runs only after an explicit Ctrl/Meta+Home/End has completed target reveal, and only when the final head and Shift anchor still match the requested selection. It does not run for arrow movement, typing, generic revealSelection, or failed navigation. A request revision invalidates earlier Home/End requests. Document generation, source identity, document ID and source version are checked before publishing; the source snapshot is captured after preceding visible edits flush, because those edits may legitimately advance the version. The existing reveal assertion checks invalidation during asynchronous reveal.

The followup review found an additional stale-error path: an old deferred read could reject after document replacement/destruction and poison the shared pending-edit error state. Both target-read and reveal failures now discard obsolete work only when its captured context is no longer current. Current read/reveal errors still propagate. Existing AbortError invalidation behavior remains.

## Evidence

- Initial RED: `red.log`, 12 failures / 6 passes. Initial GREEN: `green01.log`, 18 passes.
- Combined regression check before stale-rejection followup: `final-green.log`, six suites / 180 passes, exit 0. This includes existing source and Unicode tests, source input audit, actual-component desktop focus integration, and desktop focus tests.
- Followup RED: `stale-rejection-red.log`, 8 failures / 26 passes. Every source/live × read/reveal × replacement/destroy stale rejection failed before the catch change.
- Followup GREEN: `stale-rejection-green.log`, 34 passes, exit 0. Current read and reveal errors remain asserted rejections. This is the final modified navigation suite; the earlier combined result is not presented as a post-followup full rerun.
- Final package typecheck: `stale-rejection-typecheck.log` and `.exit`, exit 0.
- Formatting: `format.log` and `stale-rejection-format.log` record formatting of owned files.
- `final-proof.json` records final source hashes and precise result chronology. Earlier audit proofs remain historical.

Tests cover deferred reveal ordering, source/live modes, both edges, Shift anchors, different-document and same-document replacement, document A→B→A, destruction, newer Home superseding old End, preceding typed-edit version changes, current read/reveal failures, stale read/reveal failures, and absence of unrelated notifications. The optional host focus mode is documented in `../single-tab/README.md`.

No native UI, browser, or real OS IME was launched for these followups. jsdom tests verify behavior and the actual component/helper integration; native keyboard, focus appearance and actual input method acceptance remain separately coordinated by Root. No product dependency, privilege or document support scope changes.

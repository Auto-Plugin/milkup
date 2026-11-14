# Final read-only contract review

Reviewed version/activation generation checks, cancellation/disposal, render watchdog termination, navigation preconditions, and the three independent plugins. No new blocking issue was identified in the reviewed scope. This is a code review, not an additional test run or a guarantee that defects cannot remain.

- `packages/plugin/src/runtime.ts`: activation generation and late output rejection.
- `apps/desktop/src/document-presentation-service.ts`: source identity/version checks.
- `packages/plugin/src/document-broker.ts`, `apps/desktop/src/desktop-plugin-manager.ts`: bounded reads and navigation revocation.
- `packages/plugin/src/document-render-rpc.ts`: cancellation retains the running job watchdog; timeout terminates the actual Worker/process.
- `apps/desktop/src/main.ts`: navigation checks document, version, editor identity and cancellation around async location work.
- Math/diagrams/footnotes emit only validated presentation trees; footnote indexing binds documentId/version and cancels on disable.

Existing ten-plugin external verification remains 319 passing tests; it was not repeated because those sources did not change. Ongoing view focus changes were excluded from this review. The candidate01 native two-second diagram timeout remains unexplained; later successful diagnoses do not establish a fix.

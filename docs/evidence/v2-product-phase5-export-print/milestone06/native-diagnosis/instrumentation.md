# Approved bounded native instrumentation

Implemented only in `plugin_dom.rs`, `plugin_dom_process.rs`, and `plugin_dom_helper.rs` on the 53f043e8 working tree. No protocol fields, authority, deadlines, admission/cancellation policy or WebKit sandbox settings changed. Root owns compilation and UI execution.

| Phase | Meaning |
| --- | --- |
| existing `dispatch` | Owner validated and admitted a native render request; existing 2-second deadline starts immediately afterward |
| `render-request` | Same request ID/instance, fixed metadata: target screen/export, numeric version/from/to only. Recorded outside the watchdog control lock |
| `helper-dequeued` | Helper picked the render input from its bounded input queue |
| `helper-eval-submitted` | Helper is about to submit that render-input evaluation to WebKit |
| `helper-eval-callback` | That input evaluation's callback arrived. **Not renderer completion:** trusted bootstrap starts async dispatch and returns null |
| `helper-result-drained` | A subsequent poll returned a render-result envelope, parsed only for its bounded request ID |
| `helper-frame-forwarded` | Result bytes/newline flushed to the owner pipe |
| `owner-frame-received` | Owner parsed the result envelope; payload sizing and authoritative settlement checks follow |
| `owner-result-accepted` | Matching valid result passed the original deadline checks, active request cleared, control lock released; emitting the frontend event follows |

Every new event uses the existing capacity-64 `try_send` diagnostic logger and the existing monotonic clock. Logs may be dropped if that bounded queue fills. No empty-poll events are emitted. The helper diagnostic parser is active only with `MILKUP_DOM_DIAGNOSTICS=1`, borrows envelope fields and skips unknown payload fields; malformed diagnostic data only suppresses its trace and does not authorize, reject, alter or reorder the business message. Metadata is an explicit allowlist, not a cloned request. No source text, document ID, path, result payload, HTML or token is emitted.

The helper's write can wake the owner before the helper emits `helper-frame-forwarded`. Cross-process log arrival and these adjacent timestamps need not follow textual file order; correlate by instance/request ID and monotonic time. Diagnostic cost remains inside the existing measured execution deadline. No trace timestamp becomes deadline authority.

Two tests were added: `render_diagnostics_include_only_fixed_non_content_fields_without_mutating_input` checks fixed metadata, unknown/private field exclusion and unchanged input; `diagnostic_envelope_read_is_content_free_and_never_authorizes_messages` checks ID-only parsing, malformed/unrelated inputs and unchanged message bytes. Existing native cancellation/malformed/late-result deadline regressions remain unchanged and should run with Root's build.

Validation performed here: rustfmt on the three files and `git diff --check`, both successful. Per delegated scope, **no cargo compilation/test execution, native renderer execution or UI run was performed**. The tests are added, not claimed passing. Suggested root checks: `cargo test --lib plugin_dom::tests::render_diagnostics` and `cargo test --lib plugin_dom::helper::diagnostic_tests`, plus existing `plugin_dom::process::tests` under the configured Linux environment.

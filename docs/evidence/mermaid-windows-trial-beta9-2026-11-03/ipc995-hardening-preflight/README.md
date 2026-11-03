# IPC 995 hardening preflight — Windows execution pending

The failed installed run 41708284083 is preserved separately in `../attempt-41708284083`. Its standard-user PNG was captured but correctly withheld: two cancelled reads returned 995. Directory error 5 independently recovered on attempt 2 after 143 ms. The retaining process remains unidentified.

Reviewed implementation: `d1149a6a4d29c8414e36fc1af200fbc95e4b1601`, descended from source-accepted `b139a9891a086685d7e0e9e85472a29a629f7a45`. Product UI, plugin seals, official Mermaid asset, C4 correction and the bounded OS 5 retry are preserved. The new candidate has not yet passed Windows installed acceptance.

The helper now clears and verifies ordinary inheritance on exactly three distinct pipe handles before diagnostics/COM/WebView, and rechecks identity/flags before Ready. Parent pipe pairs start non-inheritable; only exact helper ends are marked for the original three-handle list. This does not eliminate the parent's generic-spawn window or deliberate handle duplication, and is not proof of the historical root cause.

A retained original helper process handle supplies zero-time observations before and just after TerminateJobObject, then is released before the original accounting check. These observations consume the existing two-second budget. Signaling is not substituted for Job accounting, pipe EOF, profile deletion or tree absence. The 50/250 ms pipe cleanup bounds and all failure gates remain intact.

Local verification: 66 native logic tests and 159 Node acceptance/packaging tests passed; locked Windows GNU test compilation passed; 12 PowerShell source/embedded steps parsed. The widest finished audit is 7772/8192 bytes; Ready is 1840/4096. The initial Linux unit invocation inherited a GUI runner requiring DISPLAY and failed before tests; its original log is retained and the plain unit invocation passed without that runner. No Windows execution is claimed by these local checks.

The next installer workflow runs the real Windows inheritance control and confined cases with a bounded `native-regression.log`, then builds one NSIS and tests both actual account kinds. Delivery still requires both complete 10-step body-rendering flows, natural closes, native and outer cleanup and exact installed bytes. No Runtime is installed, no main merge or Release is authorized.

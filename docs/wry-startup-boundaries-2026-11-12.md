# Native main-document callback boundaries

Baseline under observation: `35b1a9a06617f2afc737bb6b94a44403ee8bdfad`, source run `43163105651`, product artifact `13920639052` (ZIP SHA-256 `fb6f6a8b6c130dfd04c24889dc9014a6922dc5e8e63fc1574e1cf283b588f2d0`). Both accounts' original product and outer audit reports pass, 11/11 product steps. GUI and exact-package installation remain separate pending checks at this checkpoint.

In filtered-admin ordinary startup, first decode is 19,956.6 ms after harness spawn. Native navigation starts at 1,939 ms, the resource observer runs at 18,209 ms, and content loading follows at 18,221 ms. Its guard installation finishes in about 1 ms. The 16,270 ms gap precedes application JavaScript. However, the observer was registered **after Wry's protocol callback**, so this evidence alone does not distinguish browser delivery latency from Wry's request acquisition/preparation or handler dispatch. No `main-document-response-received` event is present; content loading and decoded PNG show that a response did arrive. Absence of that optional event is not failure or denial evidence.

This patch instruments the existing vendored Wry callback without replacing the protocol or changing requests, responses, CSP, navigation, deferrals, error handling, or permission checks. It records:

- callback entry before `args.Request()`; request and URI acquisition;
- request preparation and existing deferral acquisition;
- asynchronous protocol handler call/return and responder receipt;
- main-thread dispatch and response construction/set/deferral completion.

Diagnostics use the existing `MILKUP_MERMAID_NATIVE_AUDIT=1` opt-in. Only exact main-document URLs are classified; URI/header/body/source values are never retained or printed. Stage names are a closed enum. Limits are 16 main requests/process and 24 stages/request, with explicit overflow/truncation records. One consolidated `MILKUP_WRY_STARTUP_TIMING` JSON line is emitted when the trace's final owner drops. A process terminated before its pending response owner drops may have no completed trace: this cannot count as complete diagnostic evidence. These observations never authorize output or weaken GUI acceptance.

Verification: three standalone unit tests pass (disabled capture, strict main-document classification, cross-thread monotonic/bounded stages); emitted JSON parsed successfully and stays below 4 KiB in the stage-limit case. Those same tests are included in the desktop test target for actual Windows CI. The **actual patched Wry crate** passes `cargo check --locked --offline --target x86_64-pc-windows-msvc -p wry --lib` against the application's lockfile. Full desktop cross-check on this Linux host is blocked by the absent Microsoft `lib.exe` needed by ring; this is not a successful full desktop Windows build. Real Windows source compilation and timing reproduction are still required.

The separately queued `4fc29006ce0b2a07cd73e1b91795342538c9d548` comparison is retained; it measures the earlier startup-dispatch/empty-anchor changes. The integration branch stays at 35b so its existing installation coordinator retains exact artifact binding. No release or package redistribution is performed.

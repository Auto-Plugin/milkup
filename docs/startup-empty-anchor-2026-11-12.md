# Startup empty-anchor diagnostic and bounded correction

Base: `35b1a9a06617f2afc737bb6b94a44403ee8bdfad`. This isolated candidate does not advance the integration branch: the existing exact-35b installation coordinator still owns its build/source/install sequence. No release is authorized.

## Windows evidence before this correction

Source run `43162123202`, SHA `56a82716b6cabe634893e6b7ca654ed431cda230`, product artifact `13920305321`: ZIP 1,122,452 bytes, SHA-256 `749319ab664a91e5e993421918d4ba2188847402c54fb17b76706940ca1dc5f5`. Both original product reports are passed, 11/11, and both outer product audits passed. GUI was still running when this checkpoint was written.

First decoded observation, before additional test input:

| Account / document        | Spawn to first decode | Main HTML response wait |
| ------------------------- | --------------------: | ----------------------: |
| pure-standard / ordinary  |             5980.8 ms |                 87.3 ms |
| filtered-admin / ordinary |             3386.1 ms |                866.4 ms |
| pure-standard / C4        |            18010.0 ms |              12937.9 ms |

Pure ordinary frontend catalog read starts at 3442.9 ms and ends at 4108.7 ms. Native command starts at 4036 ms, finishes in 6.135 ms. Initial editor construction occupies 3534.9–3885.9 ms. First prepare takes 152.451 ms natively (starts 4154 ms), but its frontend completion is 4701.1 ms, following document rendering at 4156.0–4618.3 ms. Native records have explicit bounded, non-truncated stages. Clock alignment uses wall-clock milliseconds and must not be interpreted as sub-millisecond precision.

These observations separate native catalog work from frontend scheduling; they do not establish the exact cause of all remaining wait. In particular the C4 12.94-second main HTML wait predates application module execution and is not fixed here. The 35b native main-document observations remain a separate pending Windows verification.

## Correction and verification

Local Chromium traces in three fresh browser contexts show `captureScrollAnchor` forcing a layout during initial EditorView construction, before any `.milkup-line` exists. That geometry cannot produce an anchor. Return before reading root geometry when there are no source lines; retain the existing selected-line and visible-line logic otherwise. This also covers an empty virtual window with only spacers.

The two regression cases check that empty/spacer-only replacement performs no anchor geometry/layout read, retains scroll state, and installs the new rows. All view-dom tests: **1009/1009 passed**; view-dom TypeScript and changed-file formatting passed. Existing anchoring, async preview, viewport, fallback and navigation tests remain intact.

A second three-context Chromium trace confirms the empty-anchor layout stack is absent. The remaining mandatory cursor/layout work is still present; measurements vary and **do not prove a net startup or Mermaid first-preview speedup**. These Linux development-server traces are not Windows installation evidence. The exact isolated branch is added to the existing Windows source workflow allowlist; SHA, repository, reviewed ancestry, engine identity, two-account product/GUI, release and cleanup contracts remain unchanged.

Actual Windows candidate comparison and installed-package verification are still required. Do not label this change a fix for the historical 20.6-second first preview or the 56a main HTML wait.

Focused sandboxed Chromium UI regressions: **7/7 passed**, including initial editor/dirty state, dirty close confirmation, caret/undo, both issue #255 cases (delayed bracket caret and heading after image), rendered HTML/Markdown clipboard contract, and search/document switching. The clipboard result is not a Word 2016 interoperability test, and browser document switching is not an installed multi-process filesystem/export test.

## 56a final verification and startup dispatch follow-up

Run `43162123202` completed successfully. Final artifact `13920617333`, ZIP 2,341,953 bytes, SHA-256 `6242e9688e6d9c5bf76930b8b0589f9810b013cc48c553233111edae0a0ba3b1`. Re-running the frontend GUI verifier against both original encoded reports passed. Both accounts passed all eight GUI steps, including compact and scrolling 12-diagram documents, revisit, idle close and busy close. Both complete window audits resolve 106/106 SHOW records, no overflow/unresolved/visible consoles, positive controls passed. Decoded window SHA-256: pure `bd17c01fc1fe836eec498415997b6069d071a7ae66c4ae067a670c52e58b4aa6`; filtered `57013c345d230416f19861ca33e600f6b63f3220e8cf3720a02fa46972e1928f`. Functional acceptance does not erase the measured first-preview latency.

The initial path API and shared catalog/recovery invoker dynamically imported the Tauri core API before dispatch. Even when cached, this yields until synchronous module/shell work finishes. The core API module is side-effect-free with respect to native dispatch at import time: its `invoke` accesses the native bridge only when called. Make these two startup entry points use the statically loaded API, preserving their Promise results/rejections and all existing native command/approval boundaries. Browser-host startup still selects the mock service and does not invoke the native bridge. Existing unrelated lazy dialogs/services are unchanged.

New tests prove initial path dispatch occurs before the caller yields, while the result remains pending; missing-path and rejection behavior are preserved; browser startup does not dispatch. Related file/catalog/plugin-manager/output/document-transition tests: **201/201 passed**. Desktop TypeScript, production Vite build and the same seven sandboxed Chromium regressions passed. Vite reports the expected mixed static/dynamic core import chunking notice and its existing large-entry warning. The Windows timing comparison remains pending; this correction cannot affect waiting before the main HTML is served.

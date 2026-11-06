# Frontend fixed-document candidate, 2026-11-05

## Verified Windows failures

- Run 42118990857 / 6c63c26e: both product accounts reached opaque-frame hello and private-port transfer. The native read-only snapshot recorded bootstrapStarted=true, readySent=true, enginePresent=false. The old handshake dereferenced the absent engine before acknowledgement. Why the external engine asset did not execute was not established.
- Run 42121765945 / dfae0428: both product accounts failed the first image at frame-load. Fixed engine bytes were fetched/verified in the parent, but the external bootstrap did not execute: bootstrapStarted=false, readySent=false, enginePresent=false, scriptCount=1, readyState=complete. Native owned-frame navigation was allowed and completed successfully. No source was admitted. GUI accounts likewise failed their first image; later scenarios were blocked, not passed. Early product artifact 13458213926; final artifact 13459852324.
- Both latter GUI observer summaries report complete=true, overflow=false, positive control passed and zero visible-console counts. These cover only the early failed run, not the full interaction/12-diagram/idle-busy acceptance.

## Separate reproducible CSP defect

The old browser fixture omitted Tauri's main-page style nonce policy. Applying a matching parent style policy to srcdoc produced inline-style CSP refusals even when PNG dimensions were nonzero. This is a verified styling defect, not proof of the Windows external-script failure's underlying cause.

## Candidate change

Serve only an immutable, generated renderer document through a dedicated local protocol in the existing WebView. The document embeds the exact fixed bootstrap and applies a hash-only script CSP, with inline styles allowed only inside the opaque sandbox. The main-page policy is unchanged. Official engine bytes are still verified independently by parent and child and executed from a child-owned Blob with exact SRI; no network/script URL or plugin HTML is accepted. Source remains on the authenticated private channel. The native guard allows only the first exact owner-fragment document navigation and rejects subsequent cross-document navigation. Same-document fragment changes are not a hard navigation boundary ([WebView2 navigation events](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/navigation-events) do not raise NavigationStarting for them). Native IPC negative proof and frame-destroyed release remain mandatory.

Browser and production use identical generated document bytes. Vite rejects stale generated HTML. Installer verification requires those exact bytes both as a reachable asset and inside the compiled/extracted executable. The protocol serves no filesystem/user paths or arbitrary body content.

Local evidence before Windows: 21 browser tests (including 12 syntax types, two byte-tamper negatives, CSP without refusals on ordinary diagrams, message forgery, bounds/cancellation/retirement); TypeScript; production Vite build; 164 existing packaging/audit tests; 7 frontend seal/audit tests; 6 native tests and Windows-target guard type check. These are not Windows UI acceptance. Installed old-profile upgrade remains gated on a successful exact frontend source candidate. No release.

Limits unchanged: iframe removal is not proof of arbitrary JavaScript hard termination or an OS memory quota; legacy helper source remains compiled but is not the frontend render path. No claim of all Mermaid syntax or full beta.10 acceptance.

## Windows build follow-up

42123551505 / fd341e86 stopped before Rust and all product/GUI tests: the generated-document equality check rejected Windows checkout bytes. Reproduced with Git core.autocrlf=true: both bootstrap and HTML became CRLF and equality/hash failed. Explicit LF attributes now keep the two sealed inputs identical; no normalization or relaxed equality is used at runtime/build validation. The browser suite also passes 21/21 when the actual generated document is served from a different origin, with the parent style nonce policy still active.

The complete updated local corpus is recorded separately in `frontend-fixed-document-corpus.json`: 72/72 tests, 63 PNG sample records, exact candidate e991f63f and raw log SHA. This supersedes no Windows result.

## First successful Windows product stage

Run 42123865033 / e991f63f product artifact 13461160807: both account product reports and outer audits passed, 11/11 each. The same caret inside the fence yielded source/preview/live image counts 0/1/0; hot enable without restart, preview readonly/copy and Markdown marker hiding passed. Each account recorded eight separate owner lifetimes, each with unchanged main probe count after actual child native-message rejection, cancelled about:blank navigation, native destruction and zero pending requests. Pure results: 22 ready, 3 cancelled, 1 expected grammar error; filtered: 23 ready, 2 cancelled, 1 expected grammar error. Normal first-image and C4 screenshots were manually inspected and contain legible diagrams. GUI and installed acceptance were still pending at this checkpoint; do not promote the product result to full acceptance.

Packaging source-diff protection additionally includes `.gitattributes` and the fixed document generator. The accepted source receipt must still be the exact successful frontend workflow, with matching protected source bytes.

## Full run 42123865033 outcome

The run failed. Filtered-admin GUI passed all eight steps, including both 12-diagram documents with 1→12→1 revisits and real idle/busy UI closes (pending 0/1, exit 0, no forced termination, inner cleanup proven). Its complete native window evidence has 101/101 resolved SHOW records, positive control and no overflow/visible consoles. Raw compressed window bytes and SHA were independently restored and verified.

Pure-standard GUI was blocked before the first document opened. Native picker readback contained only the first 53 of the expected 121 UTF-16 units; the screenshot shows the shell suggestion popup. Original picker identity was proven; cancellation and subsequent real UI product close succeeded. This is an incomplete input-delivery prerequisite, not a new PNG failure. The reason the queued remainder failed to appear is not proven. No later pure-standard GUI operation was executed.

The harness now sends bounded 16-unit native Unicode batches (without splitting surrogate pairs), retaining the original two-second input/readback budget. Each batch requires two exact prefix reads and rechecks the owned dialog/focused Edit; no retry, text rewrite, private invoke, timeout increase or weaker final path comparison. Final readback is checked again immediately before clicking Open. Chunk receipts preserve queued counts and readback lengths/times. Local C# compilation and the added bounded/Unicode/invalid-input checks passed. The existing full observer fixture calls Win32 during synthetic lifetime diagnostics and cannot run fully on Linux; full execution remains a Windows gate.

## Exact source Windows acceptance: 42127480983 / 5ddae82e

Both product reports and outer audits passed 11/11; both independent GUI reports passed 8/8. The complete Windows observer preflight passed. The retained GUI reports were independently verified with the explicitly selected frontend contract (the offline CLI defaults to the legacy native contract and must not be used without an explicit frontend caller). File hashes, each gzip chunk and reconstructed raw-window hashes were verified. Each account has 103/103 resolved SHOW records, complete observation, successful positive control, no overflow and zero visible-console counts.

Both accounts retained natural size 3528×113 for 13 samples over more than three seconds; horizontal wheel reached scrollLeft=2578, and switching back restored fit/scrollLeft=0. Each compact and long-scroll document completed all 12 diagrams plus 1→12→1 revisits, with unchanged Markdown. Both idle/busy closes used the actual UI, exited 0 without force and proved inner cleanup. The new native picker chunk receipts all have exact prefix readback and queued-input counts; final paths match. Detailed hashes and counts are in `frontend-windows-42127480983.json`.

Installed acceptance is separate and pending: lifecycle run 42131047241 and fresh-install delivery run 42131053819 both pin exact 5ddae82e and accepted source run 42127480983. No release was published, and this does not accept the whole beta.10 scope or prove the user's existing installation repaired.

Repository-local author and committer are now LarryZhu-dev <larryzhu@foxmail.com>, verified with both Git identity queries. Published commits, including 5ddae82e, have not been rewritten.

## Installed lifecycle 42131047241: partial passes, old-restart prerequisite failures

Artifact 13464777781 contains all eight scenario directories; every retained file size/hash was verified against its manifest. NSIS build and source/payload gates passed. Installer SHA-256 is `4bb0dd47aba1dd6fd2423868d4b3ae02fa4edcbdab5205db59845c693194895b` (7,106,314 bytes); installed executable SHA-256 is `aaab4a180e24f5507e3d69446da7998fbc161babcf3d888695b0a9cf8da00730`.

Pure-standard enabled/disabled and filtered-admin disabled passed the complete lifecycle: actual beta.9 install, old UI enable/disable and restart, upgrade and same-version replacement, candidate product 11/11, real identity-verified NSIS uninstall with exit 0, program/uninstaller/registration absence and unchanged saved documents. Disabled intent remained disabled before the candidate's explicit hot-enable test. These are three specific passes, not eight-scenario acceptance.

The other five scenarios failed before candidate upgrade, at `00-restart-old-plugin-choice`: beta.9's saved enabled switch survived but its restarted image did not. All five admitted a native request before the harness's Ctrl+1 source-mode normalization; 6–141ms after that input, the request ended cancelled (not deadlineExpired), with ready-frame/stdout-protocol uncertainty, zero PNG. Job/process/IPC/profile/tree cleanup does not erase that protocol failure. Synthetic same-version/startup-failure catalog mutations were not reached.

The harness's generic startup function was injecting Ctrl+0 and source→live/caret normalization even when testing preservation across an old-profile restart. The correction observes that restart before any zoom, mode, focus or menu input: exact pinned baseline, saved live mode/caret 0/clean document, actual PNG (or deliberate disabled no-image state), then the original menu, decode, catalog, identity and close checks. A receipt records unchanged input count and rejects absent/changed observations. This does not modify beta.9 or weaken its render/cleanup acceptance; Windows must establish whether removing the unrelated input fixes the prerequisite. The historical cancellation failure remains recorded. Local product/GUI/frontend contract tests: 126/126; fresh-install run 42131053819 continues independently on 5ddae82e.

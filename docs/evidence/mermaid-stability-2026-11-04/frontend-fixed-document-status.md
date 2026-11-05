# Frontend fixed-document candidate, 2026-11-05

## Verified Windows failures

- Run 42118990857 / 6c63c26e: both product accounts reached opaque-frame hello and private-port transfer. The native read-only snapshot recorded bootstrapStarted=true, readySent=true, enginePresent=false. The old handshake dereferenced the absent engine before acknowledgement. Why the external engine asset did not execute was not established.
- Run 42121765945 / dfae0428: both product accounts failed the first image at frame-load. Fixed engine bytes were fetched/verified in the parent, but the external bootstrap did not execute: bootstrapStarted=false, readySent=false, enginePresent=false, scriptCount=1, readyState=complete. Native owned-frame navigation was allowed and completed successfully. No source was admitted. GUI accounts likewise failed their first image; later scenarios were blocked, not passed. Early product artifact 13458213926; final artifact 13459852324.
- Both latter GUI observer summaries report complete=true, overflow=false, positive control passed and zero visible-console counts. These cover only the early failed run, not the full interaction/12-diagram/idle-busy acceptance.

## Separate reproducible CSP defect

The old browser fixture omitted Tauri's main-page style nonce policy. Applying a matching parent style policy to srcdoc produced inline-style CSP refusals even when PNG dimensions were nonzero. This is a verified styling defect, not proof of the Windows external-script failure's underlying cause.

## Candidate change

Serve only an immutable, generated renderer document through a dedicated local protocol in the existing WebView. The document embeds the exact fixed bootstrap and applies a hash-only script CSP, with inline styles allowed only inside the opaque sandbox. The main-page policy is unchanged. Official engine bytes are still verified independently by parent and child and executed from a child-owned Blob with exact SRI; no network/script URL or plugin HTML is accepted. Source remains on the authenticated private channel. The native guard allows only the first exact owner-fragment document navigation and rejects subsequent navigation. Native IPC negative proof and frame-destroyed release remain mandatory.

Browser and production use identical generated document bytes. Vite rejects stale generated HTML. Installer verification requires those exact bytes both as a reachable asset and inside the compiled/extracted executable. The protocol serves no filesystem/user paths or arbitrary body content.

Local evidence before Windows: 21 browser tests (including 12 syntax types, two byte-tamper negatives, CSP without refusals on ordinary diagrams, message forgery, bounds/cancellation/retirement); TypeScript; production Vite build; 164 existing packaging/audit tests; 7 frontend seal/audit tests; 6 native tests and Windows-target guard type check. These are not Windows UI acceptance. Installed old-profile upgrade remains gated on a successful exact frontend source candidate. No release.

Limits unchanged: iframe removal is not proof of arbitrary JavaScript hard termination or an OS memory quota; legacy helper source remains compiled but is not the frontend render path. No claim of all Mermaid syntax or full beta.10 acceptance.

## Windows build follow-up

42123551505 / fd341e86 stopped before Rust and all product/GUI tests: the generated-document equality check rejected Windows checkout bytes. Reproduced with Git core.autocrlf=true: both bootstrap and HTML became CRLF and equality/hash failed. Explicit LF attributes now keep the two sealed inputs identical; no normalization or relaxed equality is used at runtime/build validation. The browser suite also passes 21/21 when the actual generated document is served from a different origin, with the parent style nonce policy still active.

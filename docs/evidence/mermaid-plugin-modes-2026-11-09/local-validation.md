# Mermaid plugin strategy correction and bounded prefetch

Base: `4c2a43aab3f97f608149df0127da774c4c682716` (`dot/mermaid-stability-20261104`).
Candidate branch: `dot/mermaid-plugin-modes-20261109`.

## Scope and cause

The prior implementation exposed document-wide source/preview/live controls while the request concerned Mermaid alone. This change removes only the newly added document mode bar and status-bar select, restores their previous layout, and keeps the original editor mode toggle and shortcuts.

Mermaid strategy now lives in the diagrams plugin's details. It is host-owned, persisted separately from document mode and the signed plugin manifest, defaults to mixed for absent/invalid historical data, and applies immediately. Source suppresses Mermaid rendering; render shows the authenticated image without making the document read-only; mixed exposes the focused Mermaid source while editing. Original whole-document source/preview behavior still applies. Ordinary Markdown and other plugin output do not receive the per-image override.

Rendering was prepared only from the currently loaded presentation window, with a 300 ms quiet-scroll delay before another request. The new host-only preparation scans a maximum 256-line nearby window starting up to 48 lines before the foreground window's end, admits at most eight previously uncached authenticated fence renders per window, and reuses the existing cache. It never runs arbitrary text/mixed providers speculatively. Cache accounting retains the existing 64 MiB encoded/decoded-cost ceiling and aggregate fragment limit. Foreground work remains prioritized, stale document/theme/activation work is revoked, and source mode pauses pending speculative work. Pure authenticated PNG views use a 16 ms scroll debounce; mixed generic providers keep their prior 300 ms scheduling policy. No unbounded whole-document rendering was introduced.

## Local validation (Linux, 2026-11-09)

Passed against the final candidate implementation:

- `pnpm typecheck`: all 14 workspace projects.
- `pnpm --filter @milkup/desktop build`: production Vite build. Existing large-bundle warning remains.
- `pnpm --filter @milkup/desktop test`: 1,029 Vitest cases plus 4 native-bootstrap Node cases.
- `pnpm --filter @milkup/view-dom test`: 1,001 cases.
- Focused Windows harness/source-receipt tests: 311 cases passed using `node --test tests/windows/mermaid-product-e2e.test.mjs tests/windows/mermaid-gui-regression.test.mjs tests/windows/mermaid-gui-startup.test.mjs scripts/ci/verify-mermaid-source-acceptance.test.mjs scripts/ci/prepare-mermaid-trial-payload.test.mjs`.
- Modified-source Prettier check, `git diff --check`, and `node scripts/check-versions.mjs` passed.

New unit coverage proves an off-window fence is prepared before a later visible request, that arrival and caret movement reuse its render, that a 10,000-fence document initially prepares only eight, that unrelated providers are not speculated, that a full 256-line foreground still prepares beyond its end, and that pause/clear releases or prevents background work. Both ordinary and windowed views test per-image source/render/mixed behavior without changing their existing editability or source text and without a second decode.

Expanded Windows helper checks had 412/413 pass. The one failure is the pre-existing `tests/windows/plugin-offline-delivery.test.mjs:135` prohibition of `alias:` in `verify-public-plugin-builds.mjs`; the unmodified base already includes the SDK alias at line 215. That gate is not claimed passed or changed by this patch.

## Required Windows acceptance, not yet run

The existing real source and installed-product workflows were extended, not replaced. The product harness uses native pointer/keyboard input for the plugin setting, verifies legacy default and persistence, and requires unchanged Markdown, Math, document version, dirty state and editor mode. Existing read-only, copy, undo, image/caret, observer, ownership, normal-close and cleanup gates remain.

The twelve-grammar syntax fixture now begins below 130 lines and has 1,000 trailing lines. Before scrolling, the renderer must finish at most eight speculative diagrams, and the cache must remain within 64 MiB. A real wheel gesture and animation-frame observations require the first visible image to use a renderer request completed before scrolling and to decode within 100 ms of first visibility. This threshold is an unexecuted acceptance criterion, not measured performance. Existing audit/report limits were not raised.

No Windows run, signed package, installer hash, or real-machine performance result is established by the local tests. Do not deliver a new installer or call this correction accepted until the exact source and subsequent installer runs pass and their original artifacts are inspected. Follow `tests/windows/README-mermaid-installer.md` for the two-phase, exact-SHA push path. No main merge or official release is requested or performed.

## Received-patch validation and first Windows evidence

The exact 89,074-byte patch was received through Library with SHA-256 `b0c5597b0aa0f92e572ebfc4fc88fc0e3ef0a2d27974afc2891f04fd7d57432f`, applied unchanged to the stated base in a separate worktree and committed as `7d889b4a1b9b1306213ae7ed1aaae584375a9360` (tree `d0a5082958f713cd3923cede49e4a7a683bcfdd6`). Original worktrees were preserved. Independent local checks reproduced desktop 1,029, view-dom 1,001, bootstrap 4 and related Node 311 passes, plus desktop TypeScript and production Vite build. Missing local dependency links initially prevented test collection; existing dependencies were linked only inside this isolated worktree, without lock/source changes.

Windows source run 42553871741 captured that exact commit. Early product artifact 13647270950 ZIP SHA `b9d929efb11d658f225972e3ee63dbe56cb0b7b536508617432230c15ec5dc56` was checked before extraction. Both accounts passed the initial default preview, then failed `02-enable-and-exact-bytes` with `Timed out: Source fallback without image` at the mixed-strategy check. Both had already recorded successful source and preview strategy transitions with unchanged document mode/version/dirty state, Markdown and Math, and correct persisted strategy. The failing snapshots have cursor 38, editor mode live, **editorFocused=false**, and a decoded visible image. The final real input closed plugin settings; it did not resume editing. Mixed mode's documented behavior intentionally shows the image while editor focus is elsewhere. This failure did not reach the offscreen/prefetch measurements or later product steps. Independent GUI was still running when these early reports were examined.

The harness correction first captures and asserts unchanged editor mode/version/dirty state immediately after the setting change, then uses existing real pointer/keyboard positioning to resume editing inside the fence. It requires editor focus and records the pre-normalization mode so normalization cannot conceal a plugin mode leak. Regression cases reject missing focus and changed pre-normalization mode. Both ordinary and windowed DOM tests now explicitly move focus to a settings button and back, proving mixed mode shows/hides the same image without a new decode. Focused checks: 90 harness and 30 DOM tests passed. No application behavior or acceptance threshold was changed for this correction; a new exact-candidate Windows run is required.

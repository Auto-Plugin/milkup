# Milkup Footnotes

Independent Worker plugin using only public `@milkup/plugin-sdk` 0.3.6. No private Markdown implementation, DOM, HTML execution, network access, or document-write permission.

## Syntax and behavior

References use `[^id]`; definitions occupy a standalone line `[^id]: body` with at most three leading spaces. Four-space or one-tab continuations are collected across pages. A blank line continues a definition only when followed by an indented continuation.

Labels are trimmed, NFC-normalized and **case-sensitive**. Labels contain 1–128 UTF-16 units and cannot contain whitespace, controls, brackets or backslashes. Original source offsets remain unchanged. Numbering follows first reference order; repeated references share a number. First definition wins. Duplicate and missing definitions have accessible diagnostics. A partial scan never claims a definition is missing.

Reference buttons navigate to definitions; definition markers offer up to eight return buttons and announce larger counts. Navigation is document/version bound and changes neither Markdown nor undo history.

Only a definition's `[^id]:` marker is presented. Its body retains the editor's existing emphasis/code rendering and source mapping. Indented continuation lines remain source; this plugin does not bypass protected code ranges or replace the whole definition with a card. Reference accessible descriptions include a bounded plain-text definition summary.

Active reference/definition source remains visible while editing. Unknown context, fenced/inline code, HTML, escapes, link/image syntax and uncertain nested containers fall back to source. Complex nested containers are unsupported; a container fence with unproved extent stops further indexing with partial status.

## Bounds and lifecycle

Rendering returns immediately. While the current document/version index is still preparing, known-context results include `pending: true` with `complete: false`, allowing the host to wait within its preparation budget. Finished, permanently partial, cancelled, disposed and unknown-context results do not advertise pending. This requires public SDK/host support for 0.3.6; the plugin does not extend isolated rendering deadlines. An 80 ms debounce starts paged `host.document.readWindow` indexing from the document start. No full-document string is assembled. Each read requests at most 256 complete lines, capped by the host at 128 Ki UTF-16. Limits: 8 Mi UTF-16 read text, 200,000 lines, 4,096 combined definitions/references, 8 Ki UTF-16 per definition summary, and 128 presentation fragments. The scan can stop below its character cap when another maximum-sized page would exceed it. Excess results stay source.

Document/version changes abort the previous scan and clear its index. Disposal cancels timers and reads. Background progress calls owner/version-bound presentation invalidation, limited to four updates per second by the host. Oversized, interrupted and unsupported scans preserve source and partial state. No settings, files or document content are changed.

## Standalone verification

Run `pnpm install`, `pnpm test`, and `pnpm run build`. For a public SDK archive, run:

```
node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.6.tgz /absolute/outside-checkout-directory
```

The verifier installs only the supplied public SDK archive and development tools in the external directory, with its store and cache there. It disables package-manager auto-installation on every invocation. Set `MILKUP_PNPM_CLI` to an existing pnpm JavaScript CLI when using a pinned toolchain. The verification report derives the output archive name from `plugin.json`, and records SDK/archive SHA256 values.

The build guard rejects private Milkup dependencies and runtime imports. Output: `dist/milkup.footnotes-1.0.1.milkup-plugin`. Manifest renderer id: `footnotes`; contexts: `text`; permission: `document:read`. The parent integration owns bundled-plugin registration.

The renderer returns selection-independent fragments. The host preserves literal source for the active selection and restores cached previews when the caret leaves; definition bodies and continuation lines always retain editor source mapping.

Background indexing invalidates previews only when references, definitions, stored continuation summaries, truncation diagnostics, or completion/partial status change. Scanning ordinary text, blank lines, or excluded code does not produce periodic refreshes. Notifications remain at least 250 ms apart, including the final pending update; cancellation discards a pending final notification. A document without footnotes sends only its completion update.

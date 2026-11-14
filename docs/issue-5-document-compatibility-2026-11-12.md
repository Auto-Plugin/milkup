# Issue #5 original document compatibility

## Candidate and scope

Historical [issue #5](https://github.com/Auto-Plugin/milkup/issues/5) reported that an HTML-containing Markdown document with over 4,000 characters opened with only 39 characters. It was closed in July 2025; that history alone neither proves a current defect nor current coverage.

This check used integration `82a689b800ee53f719835c49e0af6175fe1d4a86`, branch `dot/release-quality-integration-20261112`. Its application, packages, plugins, vendor and dependency manifests have no differences from accepted application candidate `b877746f5dfd236dfc13f718ed23d837b8e4f89d`. Only test/config/documentation changes accompany this check. No new application fix, installer or Release was produced.

No existing exact-attachment regression was found. Added `tests/e2e/desktop-document-compatibility.spec.ts`, explicitly opt-in with `MILKUP_ISSUE5_SAMPLE`. Without the attachment it is skipped, not counted as passed. The anthology is not copied into the repository.

## Original input

- Attachment: https://github.com/user-attachments/files/21402940/default.md
- Filename shown by the reporter: `名侦探柯南.md`.
- UTF-8, CRLF, 9,717 bytes, 4,342 UTF-16 units, 293 lines including final empty line.
- SHA-256: `6889961c1dbcce2a235bb219d4dd218b0371e1b1a09b7b36a05e6ccf8458d197`.
- Includes Chinese/Japanese text, headings, thematic break, quotations and literal `<p align="right">` markup.

The download was size-bounded at 1 MB and decoded strictly. The test pins the exact byte length and SHA, opens a temporary copy, writes only a new Save As destination, and rechecks both original and input copy unchanged. It does not execute raw HTML or change the renderer's HTML policy.

## Actual result

Chromium 154.0.8037.57, Linux headless, production desktop UI through Vite:

- Live view contains beginning and ending text; real Ctrl+End exposes the final line in the viewport. Literal HTML remains visible rather than becoming executable/aligned HTML.
- Source mode: **all 293 lines exactly equal** the original after splitting its CRLF line boundaries. No historical 39-character truncation reproduced in this path.
- Real menu **Save As** command invokes the browser file-service adapter once. The captured application payload is written to a new disk file. Saved file and both original/copy are byte-equal, SHA above unchanged. This checks application serialization and command plumbing, not native OS saving.
- The production `renderStaticMarkdownDocument` function used by `output-service` retains every nonblank text payload. The Markdown thematic break becomes one `<hr>`; it is checked structurally, rather than incorrectly requiring literal `***` text.
- Static HTML SHA-256: `641580fb69baf5e07a01464c21c0c57b2f172e3abc5da5b100b0472748447322`.
- **Export fidelity remains limited:** 30 `unsupported-nesting` warnings; nested quotations fall back to escaped source. No `p[align="right"]` is created. Content retention is verified; raw HTML alignment/full formatting fidelity is not claimed.

The first test iteration reached and passed source/save comparisons, then failed the test's literal `***` export expectation. Correcting that expectation to require an actual thematic-break element produced a passing run; no application behavior was changed to obtain the pass.

Local evidence: `/workspace/milkup-issue5-browser-evidence/` contains `evidence.json`, screenshots, original temporary copy, saved copy and static HTML. These are test artifacts, not a distributed package. The external sample must remain available separately for reproduction.

## Reproduction

Obtain the public attachment into a temporary file, enforce the size/hash above, then run:

```sh
MILKUP_BROWSER_EXECUTABLE=/usr/bin/chromium \
MILKUP_ISSUE5_SAMPLE=/absolute/path/to/original.md \
pnpm exec playwright test tests/e2e/desktop-document-compatibility.spec.ts \
  --project=desktop-msedge --workers=1 --reporter=line
```

Existing ports 1420/1422 were occupied during this run. A disposable Playwright config started only the desktop server on an unused loopback port; existing services were left alone. The disposable config was removed afterward.

## Boundaries

- Browser file IO is a named test adapter; no installed Windows native picker, Tauri atomic writer, permissions/resource relocation or reopen-from-native-file test was run for this attachment.
- Static serializer was exercised directly; installed export plugin UI, Windows PDF and Linux WebKit PDF were not exercised for this sample.
- Earlier installed A/B document identity/export/dirty-close acceptance did not contain this attachment and does not fill these gaps.
- This check proves source accessibility and unchanged saved bytes in the stated browser path, not full HTML rendering compatibility or a cross-platform guarantee.

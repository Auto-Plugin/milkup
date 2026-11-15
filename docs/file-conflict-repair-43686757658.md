# Installed file-conflict rescue repair: scoped native acceptance

Final run: https://github.com/Auto-Plugin/milkup/actions/runs/43686757658

**14/14 steps passed**, independently checked against the raw JSON and retained
file bytes. This closes the observed blocked-rescue-chooser and hidden-initial-
conflict-notice defects for the tested Linux candidate. It does not certify all
conflict UX, Windows behavior, large-file rescue, or crash recovery.

## Candidate and package identity

- Pure product fix: `0e4e8c580353710db9b7f0ec4820522d305ec9fc`, directly on
  integration `8f7fefdfcdf88f0179721c98215b1e0c9afe8452`.
- Actual built source: `58c78973101acb0a22ca0cb5d24ef24bd9edc199`.
  Its only differences from the product fix are four isolated QA/workflow files.
- Final QA source: `d81818e9fd3731ce02589a9bd3c49a7e3311d2d4`.
  Its only differences from the built source are the QA workflow and menu-close
  wait. The workflow verifies that exact allowed file set before installation.
- Package: `milkup-2.0.0-beta.10-linux-deb-58c78973101a.deb`, **9,854,742 bytes**,
  SHA-256 `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`.
- Installed executable SHA-256:
  `42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`.
- Package artifact `14149947936`, created in run `43685991943`, ZIP SHA-256
  `b22943b501b9bfb0202dfb2507b7e7c5fe5aeda7c8fea8b2f0d0534182d5c89a`.
  Expires 2026-11-22 06:40:29 UTC.

Only **one new Linux package was built**. Final acceptance downloaded, validated
and installed those same bytes; no Windows/offline/installation matrix rebuild.
The pure product commit was fast-forwarded into the existing integration branch
after native evidence verification. QA scripts/workflows remain isolated.

## Preserved failures and actual correction

1. Old package run `43684875848` proved ordinary save preserves external bytes,
   but Save As was blocked before the GTK chooser by `getSaveSafety`. The initial
   watcher message existed in DOM but was hidden. Original artifact `14150195731`
   and independent report remain preserved; synthetic Markdown only.
2. Build/native run `43685991943` built the repaired package. Initial warning was
   now visible and ordinary save remained blocked. Its test then redundantly
   clicked the menu-close control while the command had already started the
   180 ms closing animation and made controls inert. The exact assertion was
   `Visible enabled native pointer target [data-menu-close]`. Save As was not
   reached; fallback cleanup was not counted as normal exit. Artifact
   `14150012702`, ZIP SHA-256
   `a5ecba7eeb613e5e26a15a2f3f83f7a4dc2fb906810516ac1f68aee2884f3692`,
   remains retained.
3. Final run `43686757658` changes only QA: wait for the automatically closing
   menu to be `hidden`, `data-phase=closed` and `aria-hidden=true`; do not click
   its inert control. Official Noto CJK fonts were added to this isolated runner
   so Chinese text is visibly readable. No product input/contract was weakened.

## Native results

Ubuntu 26.04 ordinary UID 1001, fresh owned profile, actual installed production
assets, default WebKit sandbox preflight passed. All Markdown was newly generated
with unique run markers; no user files. Native keys/pointers and real GTK choosers
drive the application, while DOM observations do not inject document state.

- Committed local unsaved edit and matching completed checkpoint observed.
- A genuine external file write creates conflict. First warning is visible
  before Save, and the retained screenshot shows readable Chinese text.
- Ordinary Save refuses to overwrite; memory still contains BASE + LOCAL_UNSAVED,
  disk still contains EXTERNAL_DISK.
- Dirty reload is refused; both versions remain intact.
- Native window close prompts; Cancel keeps the same process generation and both
  versions.
- Actual Save As chooser opens; Escape cancels without creating the rescue or
  changing the original/local content.
- Save As to a new non-original path writes exact local bytes, clears dirty and
  switches the document path. Original external bytes remain unchanged.
- Normal UI close, reopen original: external content visible, local rescue intact.
- A second deliberate external write while clean is detected. Explicit reload
  shows the new external content without changing the rescue.
- Normal close, reopen rescue: local content visible and both disk files match.
- Final normal close succeeds.

Three exact process generations (PID/birth) were checked:
`5646/14274`, `6178/15357`, `6313/15646`. Each received a real
`WM_DELETE_WINDOW`, then was observed gone, with `forced=false` and no fallback
cleanup. This proves the tested normal-close path; OS process exit codes were
not collected and are not asserted as zero. The run's own installed package was
removed successfully. AT-SPI bus and headless DRI3 warnings remain in logs;
this is not a screen-reader or warning-free-runtime claim.

Independent retained-byte checks:
- Local rescue/checkpoint SHA-256:
  `fb24881d8b5dcebfb2f7c5a3a43a8fc7a575320740e8df685609c835e335d730`.
- Initial external content, preserved through rescue and first reopen:
  `e7ef75b8f63b91c1e55446f9ac688137445fc1594969489055fbe34105305d5b`.
- Final original after the test's deliberate second external update:
  `3ebb5df754a3e7971916b0b4fa5308c6d94c640032da57c48809b13b259aade9`.

## Local safety regressions

41 tests and desktop TypeScript passed before build. Another 13 tests verified
old-path watcher reconciliation after Save As and resource save coordination.
Four cheap Rust tests compiled the exact product file-write function bodies and
ran against owned real files: stale original, canonical and symlink aliases;
deleted-original rescue; readonly destination; external modification during
staging. All passed locally and in the build run. The extraction records function
hashes; only post-write resource notifications are stubbed. This is a Unix disk-
guard test, not a claim of local GTK/IPC or Windows filesystem verification.
Readonly front-end sessions remain blocked; original path/hash and native guards
are not cleared to enable rescue.

## Remaining boundaries

- Dirty reload is safely refused, but its separate rejection notice still has
  `noticeVisible=false` in this run. This residual feedback issue is recorded;
  the initial conflict notice and ordinary-save refusal are visible. Do not
  claim every conflict message is fixed.
- Checkpoint presence is not crash restoration. No deliberate crash injection,
  power-loss, disk failure, or current-candidate recovery-on-restart test ran.
- No Windows counterpart or full large-file/media relocation matrix was rerun.
- No main merge, release, formal channel/signing configuration, personal
  notification, system library or sandbox/security setting change.

Final evidence artifact `14150912640`, 28,413 bytes, ZIP SHA-256
`e2f50c12eeaaf7acd78c0ce8d52e90deb7cb83653f7aa41307997d043ceb4b26`,
expires **2026-11-22 06:45:44 UTC**. ZIP length/hash/CRC, package manifest,
installed binary identity, all 14 step results, three closes and both file byte
streams were independently verified. Local raw ZIPs/extractions, package and
independent reports are under `/workspace/milkup-file-conflict-evidence/`.
Local workspace retention is temporary; private Library text retention excludes
browser screenshots and carries original byte/hash inventories.

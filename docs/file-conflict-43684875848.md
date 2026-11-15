# Installed external-conflict verification: real UI defect found

Run: https://github.com/Auto-Plugin/milkup/actions/runs/43684875848

The single bounded run failed. Do not rerun this unchanged package expecting
rescue Save As to work. No product rebuild or crash injection occurred.

## Exact candidates and environment

- QA commit `2eaae5d11c61d6eeb5d6be52adc18895dd528df7`.
- Existing application source `383c0712f21071467f2549d73a022b03db4b69aa`.
- Existing deb `milkup-2.0.0-beta.10-linux-deb-383c0712f210.deb`,
  SHA-256 `8cd091ac83ffea06e2bac6c34ce3a9353047722fc0dbf7d64b1491341acfc860`.
- Installed executable SHA-256
  `00b8bb61eb53cf252e22bc1836a5eda07a6462f216a600861d9961004fa5c2e1`.
- Ubuntu 26.04 ordinary account, temporary profile/synthetic Markdown, default
  WebKit sandbox preflight passed. The package was installed and removed by this
  run. No user data, production configuration or system security changes.
- Integration `8f7fefdf` has the same file service, watcher/session/save-safety
  and recovery implementation; main's Save As guards are also unchanged. This
  is not a claim that all installed and integration bytes are equivalent.

## What actually ran

Six steps passed: exact installed launch; native local edit plus completed
recovery checkpoint; actual outside disk write; ordinary-save refusal;
dirty-reload refusal; real native window-close prompt followed by Cancel.
At each conflict boundary the editor retained BASE and LOCAL_UNSAVED while the
original disk file retained EXTERNAL_DISK. No external version silently replaced
the editor or vice versa.

The watcher reached `conflict`, but the initial notice's `noticeVisible` was
false. After ordinary Save, the refusal became visible. The default hides
developer status notices, and the watcher did not set `importantNotice`.

The seventh step, Save As cancellation, timed out after 30,060 ms waiting for a
real GTK chooser. The observed notice was the external-conflict save refusal;
no chooser or rescue file was created. Both `saveDocumentAsOnce` and
`saveMemorySourceDocumentAs` call `getSaveSafety(session)`, which rejects every
non-`none` external state before selecting a destination. Thus the UI tells the
user to use Save As while blocking that path. This is a product defect, not an
observed GTK dialog naming error.

The final normal-close assertion deliberately rejected the still-dirty
document. `forcedFailureCleanup=true` records fallback harness cleanup; do not
count it as normal application exit or successful crash recovery. Rescue save,
Save As cancel, clean reload, reopen-original/reopen-rescue and subsequent clean
exits were **not executed**. Exact checkpoint/local and disk/external byte
comparisons passed after failure; the original was not overwritten.

## Minimal prepared correction, not yet installed verification

Product commit `0e4e8c580353710db9b7f0ec4820522d305ec9fc`, branch
`dot/file-notice-fix-20261115`, isolated from integration and QA:

- Allow opening the Save As chooser for external-change conflicts in both
  in-memory editing paths. Readonly remains blocked. Do not clear the session,
  external state, original path or opened snapshot hash.
- Keep native same-path/canonical-alias snapshot checks, atomic staging checks
  and permissions unchanged. Choosing a destination is not write permission.
- Make actual external-change notices visible and actionable in the existing
  status region. Own-save echoes do not replace the success notice.
- Correct the save-refusal text: dirty reload is not advertised as an available
  discard operation.

Local verification: 41 tests in eight files passed, covering both safety gates,
readonly, own-save echo, delete/conflict notices, source-hash propagation through
Save As/selected-path calls, chooser cancellation, watcher/session regression,
recovery and large-file conflicts. Desktop TypeScript and diff checks passed;
new/helper/service-test formatting checked against the repository configuration.
Native Rust was not changed or newly run. Existing native source tests cover
new-path rescue, stale original, canonical/symlink alias, permissions and staging
races; those do not substitute for a repaired installed UI test.

Next gate requires one new exact repair candidate package, then the existing
bounded flow (plus visible initial warning and same-source Save As refusal).
Do not rebuild/retest the unrelated Windows/Linux installation matrix. Do not
mark the defect resolved before the repaired installed UI reaches rescue,
reopen and normal exit.

## Recovery scope

Observed completed checkpoint: version 25, 42 bytes, SHA-256
`04f8ec3f62298f78d0a37c4faa7442b5abcb32d0a4ed02f181d3abe93300e4f1`,
exactly matching the local unsaved text. The original disk SHA-256 remained
`3d5a4289e576dd20e163ff5ba067d308a917412517414840d1858ce390c2324e`.
This proves a checkpoint existed, **not** restoration after a deliberate crash.
Historical phase20 SIGKILL/recovery evidence uses an older candidate. See the
companion plan for debounce, quotas, restore-to-copy and untested fault limits.

## Raw evidence

Artifact `14150195731`, 30,730 bytes, ZIP SHA-256
`756f536e733b664cd426f69dc414895a3ca369d9eec02556207d061d58c3a811`,
expires **2026-11-22 06:21:20 UTC**. Length, hash, ZIP CRC and safe entries were
independently verified. Contains JSON observations, native logs/screenshots,
all synthetic expected versions, original disk file and observed checkpoint.

Workspace retained original ZIP/extraction and independent review:
`/workspace/milkup-file-conflict-evidence/43684875848/`.
Local test output: `/workspace/milkup-file-conflict-evidence/product-targeted-tests.txt`.
Workspace is temporary, not indefinite archival storage. No Release was made.

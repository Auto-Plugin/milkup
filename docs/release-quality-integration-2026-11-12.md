# Release quality integration — 2026-11-12

This is candidate evidence, not a release approval. Integration branch:
`dot/release-quality-integration-20261112`, based on
`ef221deb1bde9b56b6bc5faf09105d5bcbd059d7`. No Release, tag or main merge.
Original worktrees are preserved. Commit author and committer are
LarryZhu-dev <larryzhu@foxmail.com>.

## Integrated work

- Editor quality: original `8f02ff66`, `8f07fc00`; integrated as `a0b152f4`, `aca9defe`.
- Distribution: `84d9e6a5` → `8d1431d3`; signed manual recovery preparation → `cad6b0cf`.
- Windows PDF/print: `742d0637` → `69fa85d3`, `8107bc5b` → `9c9eafd9`,
  `c49fe3fc` → `7f10b28d`; review fixes → `7afd13c2`; native fixtures → `66256214`.
- Mermaid retained image history and Outline 1.3.4: `7def1399`, `31c27aed`.
- Integration fixes preserve preview image ownership across focus/viewport changes
  (`fdcf3e6c`), and prevent already-observed scroll/resize events dismissing a
  freshly opened context menu (`18711cfd`). Real geometry changes still dismiss it.
- The original editor source/live control is retained. Mermaid's source/rendered/
  mixed policy is a separate plugin setting, not a global three-mode editor control.

## Windows PDF and print: exact tested candidate

[Run 43141132432](https://github.com/Auto-Plugin/milkup/actions/runs/43141132432)
passed at `0ccc4c4cafc7e69acfd2d551bec230075ab925d0`:

- 20 output contracts passed; four opt-in tests were ignored by that first invocation.
- A separate opt-in test actually rendered all four PDFs using installed WebView2.
- A separate real print-dialog test guarded Printer Properties and cancelled the
  controlled dialog without submitting a job. This is not positive queue or physical printing.
- Original artifact `13909458608`, ZIP SHA-256
  `48935663333ee88eb19bd8b608de52359be86eba39458b833897ac47c69ad94a`.
  Retained until 2026-11-19. Its `summary.json` records `releaseReady: false`.

Independent `pdfinfo` examination:

| PDF              | Dimensions (points) | Rotation |
| ---------------- | ------------------- | -------- |
| A4 portrait      | 594.96 × 841.92     | 0        |
| A4 landscape     | 841.92 × 594.96     | 0        |
| Letter portrait  | 612 × 792           | 0        |
| Letter landscape | 792 × 612           | 0        |

All samples are one page. Text extraction from A4 retained Chinese, emoji,
typographic quotes and the sample combining character. This is limited sample
evidence, not complete multilingual, multipage or visual fidelity acceptance.

### Failures retained and actual fixes

The earlier landscape fixture forced A4 portrait CSS while asking the API for
Letter landscape. The fixture now matches the real serializer's paper/direction
CSS; a deliberately contradictory portrait case remains a negative control.

Earlier real network tests detected an iframe TCP connection even with CSP and
awaited CDP offline setup. A reset connection is still a connection and was a
failure. `0247439d` adds an HTML-token validation boundary before launching the
output helper and inside it: browsing contexts, preconnect links, base changes,
refresh directives and malformed input are rejected. `0ccc4c4c` also rejects
comments to avoid raw-text parser ambiguity. This validator accepts the controlled
static serializer; it is not an arbitrary-HTML sanitizer. Escaped code samples remain accepted.

On the passing real run, all five image/script/frame/style/preconnect listeners
for all four paper cases reported `WouldBlock` with no connection. The disallowed
frame/preconnect/refresh samples are rejected before navigation; the allowed
static output still runs through the browser's network restrictions.

Run 43140477351 at `0247439d` passed three papers but failed the fourth while
removing the private profile: Win32 sharing violation 32. `0ccc4c4c` retries only
sharing/lock errors 32/33 within the existing two-second cleanup deadline;
other errors fail immediately and successful return requires actual removal.
Tests cover delayed release and a handle held beyond the deadline. The later
passing run did not bypass this cleanup requirement.

## Performance and public plugin packaging

All eleven public plugins were rebuilt and verified, including export-print 1.0.1
and Outline 1.3.4. Historical manual-trial gates pinned to Outline 1.3.3 are not
evidence for these packages.

A paired 18,000-heading CPU/index benchmark against `ef221deb` measured medians
94.014 ms before and 82.374 ms after, a 12.38% reduction. It excludes native scan,
storage, IPC, input and paint; it is not a native cold-start or UI p95 claim.
The Mermaid cache change retains the shared 64 MiB/128-image limits and bounded
prefetch; current Windows long-scroll acceptance is tracked separately below.

## Current platform gates

| Gate                        | Exact run/candidate                                      | Status at this checkpoint                                                                                                                               |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dual-account source         | 43141649677 / `bf8a2d50`                                 | Failed before product/GUI execution: wrapper exact-ref whitelist omitted the integration branch. Rust checks passed.                                    |
| Dual-account retry          | 43143354426 / `988a0f735a7e10b5cd66c1848eeb482cbfa8efe3` | Both product accounts passed initial preview and plugin strategy observations, then timed out at the stale global-preview assertion. GUI still running. |
| Earlier three-package build | 43139149455 / `66c6fe3c`                                 | Offline Windows and Linux deb built; standard NSIS built but failed the older network gate. Whole run failed; no installation acceptance.               |
| Three-package build         | 43141877202 / `bf8a2d50`                                 | In progress. This candidate does not contain `18711cfd`'s menu fix.                                                                                     |
| Latest three-package build  | 43143356894 / `988a0f735a7e10b5cd66c1848eeb482cbfa8efe3` | Pending behind the running build.                                                                                                                       |

The installation workflow downloads the original artifacts from a successful,
exact-SHA distribution run and checks receipt, size and SHA-256 before execution.
It does not rebuild the tested package. Windows smoke checks install, owned native
window, normal close, actual NSIS uninstall and unchanged fixture; Linux smoke
checks dpkg installation/removal. These are narrower than full installed GUI,
old-profile migration, absent-Runtime provisioning or recovery acceptance.

## Browser checkpoint

The complete integrated Linux Chromium run finished with 293/294 passing, including
production-CSP positive and negative controls. One formatting context-menu case
remained disabled after close/reopen under changed selection. Its cause is still
under investigation; successful targeted reruns are not treated as a fix.

Windows product tests are being aligned with the user-requested plugin boundary:
the original document button switches source/live, while Mermaid has three
strategies. The old test incorrectly required a third global preview state. The
replacement keeps exact caret, decoded PNG, hot enable, source preservation and
trusted native copy checks, and requires the editor to remain editable.

## Historical issues and remaining verification

- [#255](https://github.com/Auto-Plugin/milkup/issues/255): current browser cases type
  English/digits inside parentheses, wait 2.5 seconds, verify the caret and type
  another character; another case checks single-space headings after an image.
  They passed in the integrated browser suite. They are not yet rerun in this
  exact installed Windows candidate.
- [#252](https://github.com/Auto-Plugin/milkup/issues/252): the current browser test
  reads actual clipboard HTML with editable table structure and exact plain-text
  Markdown; source mode offers plain text. It passed. No Word 2016 executable is
  available in this Linux environment, so actual Word paste/editability is open.
- The July Windows IME report is useful historical evidence, not acceptance for
  this candidate. Synthetic composition tests cannot replace a real candidate
  window, candidate selection, commit, cancel and undo through the system IME.
- Linux WebKit PDF text/fidelity remains open. No complete matching WebKit
  2.52.6/2.54.2 source or configured build tree exists in this environment.
- Fresh signed recovery preparation has contract tests, but actual installation,
  restart health and old-profile recovery remain unverified. Recovery is manual;
  automatic application rollback has not been implemented.
- Formal signing, release channels, physical printing, printer-job cancellation,
  native DPI and full current installed Windows/Linux GUI remain separate gates.

No package in this checkpoint is declared a completed formal release.

# Non-release composite candidate smoke

The product candidate is `46c754b8ca1012a42cf1ed6a7b72ad9cfc772b4f`;
`d8d2860b0319efdc3a2a4e466a3b064bdd04cb2e` adds only its evidence/documentation.
Their application, packages, plugins, vendor, release configuration, scripts,
tests and dependency inputs compare byte-identically. No same-SHA run or artifact
was present when checked. The following QA-only changes select a new actual
checkout SHA; its product and official build-script inputs remain identical to
that candidate. Actual artifacts must name the selected full checkout SHA, not
pretend to have been built at either earlier SHA.

Use the existing manual `distribution-candidate.yml`, with `expected_sha` equal
to its exact current commit, `integration_smoke=true`, and `upload_candidates=true`.
There is no push trigger. Exactly two sequential native jobs are selected:
Windows 2025 standard NSIS and Ubuntu 26.04 Linux deb, each bounded to 120 minutes.
The ordinary default three-package flow is preserved. An offline package requires
another Windows build job, so it is intentionally excluded from this minimal run.
No Runtime is removed, no signing credentials or production endpoint configured.

The official locked `build-candidate.mjs` is unchanged. Its manifests, package
length/hash, source identity and build-only status remain authoritative. Packages
are retained for seven days even if subsequent native smoke fails; that retention
does not turn a failed acceptance into success. Separate evidence records results.

Windows scope:

- Compile the real candidate `update_pe.rs` through a small locked native test
  crate. Four strict resource/bounds tests plus the new actual installer test run;
  exact beta.10 passes while stale, newer and stripped-prerelease versions fail.
  The actual-installer test is ignored locally without an artifact, but CI uses
  `--include-ignored` and requires its input. No update server or full upgrade run.
- Reuse the held-Job/token-verified ordinary-user installation coordinator with
  an explicit `InstallOnly` option. Require same SID/source, one normal exit 0,
  successful actual uninstall, unchanged document and no forced cleanup. The
  existing repair-health branch still requires its complete health evidence.
- Existing WebView2 is required before installation. This does not test missing
  Runtime/offline deployment, Windows IME, editing health, upgrade or rollback.

Linux scope:

- Reuse seven native IME/preflight/close files byte-for-byte from accepted harness
  `ef6bdaa41c2d1621b07a54193872c665172a3174`; three shared native helper files also
  match. Use normal-user default sandbox and temporary IBus/XDG profile only.
- Verify installed versus extracted executable bytes and package receipt, then
  run only GTK scale 1: physical Pinyin, one commit then deliberate identical
  repeat, punctuation, cancelled preedit, exact saved bytes, normal close/reopen.
  Source and live modes retain existing event and Unicode assertions. Remove only
  this run's package. No second-scale/full IME matrix or PDF experiment is repeated.

Local preflight: 23 Node contract tests passed; four PE tests passed with one
actual-new-installer test explicitly ignored; PowerShell AST parsing passed and
the real install-only verifier rejected 12 invalid-evidence cases while accepting
two valid modes. Shell/Node syntax and workflow YAML/format checks passed.
PowerShell initially could not create its default cache under the read-only home;
setting only its test process's XDG directories to owned `/tmp` paths allowed the
check. No system/home permissions changed.

The private WebKit build `43614932570` remains independently monitored; no new
dispatch or runtime patch is part of this smoke. Record the actual new run and
artifact hashes after dispatch/completion; at this document's creation neither
new package nor native result exists. Do not report completion from this plan.

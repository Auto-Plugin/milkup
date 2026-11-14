# First Windows trial-installer attempt: failed before installation

[Run 41665301060](https://github.com/Auto-Plugin/milkup/actions/runs/41665301060),
attempt 1, candidate `d525c6a51d2d6a47615ff3a950a8852a2dde48ae`, failed on
2026-11-03 at the strict source gate. **No installer was executed, no new standard
account was created, no installed product was launched, and no delivery ZIP was
uploaded.** This is not installed-release acceptance.

The release build produced beta.8 x64 EXE (23882240 bytes) and NSIS installer
(5856150 bytes). Its extracted EXE matched the exact unique Tauri UNK-to-NSS
three-byte transformation; production manifest, staged plugin and preparation
checks passed. The original packaging record still says
`installerExecuted:false` / `installedProductAccepted:false`. Prepared output
never crossed the installed-verification/delivery gate.

The first failed check printed only
` M apps/desktop/src-tauri/Cargo.toml`. The always-run final gate retained the
same status. Its `git diff HEAD` emitted no content diff, only the warning that
LF would be replaced by CRLF on the next Git operation. `core.autocrlf=true` was
recorded. The original source snapshots recorded raw bytes only for the two
schema JSON files, **not Cargo.toml**, so its original runner bytes/hashes cannot
be recovered or asserted here. No restore, index refresh, ignored-dirty exception
or successful outcome was substituted.

Only artifact `13245912797` (`mermaid-installer-inspection-41665301060-1`) exists:
14511-byte ZIP SHA-256
`bf4f253a34f5d6246e3abf38ea3beb0f55d03a1148476f25ae5a97146d918b90`.
Its digest matches GitHub metadata. All 11 manifest-listed files and the manifest
were safely extracted and verified by size and SHA-256. There are no PNGs,
installed-product evidence artifact or delivery artifact. Original [ZIP](inspection.zip),
[log](raw.log), [run metadata](run-metadata.json), [inspection](inspection/manifest.json),
[independent verification](artifact-verification.json) and [analysis](analysis.json)
are retained without editing the original records.

## Source investigation and bounded local reproduction

Pinned upstream [Tauri CLI 2.11.4 manifest code](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/interface/rust/manifest.rs)
reads Cargo.toml, parses it through `toml_edit::DocumentMut`, serializes it and
writes it when the serialized string differs. The upstream lockfile pins
`toml_edit 0.25.4+spec-1.1.0`. Original upstream files/tag metadata are retained
alongside the exact candidate Cargo input.

A separate local Linux experiment uses that exact dependency version and the
original CLI serialization function. All 16 dependency versions/checksums match
the upstream lockfile. In a fresh temporary Git repository with `autocrlf=true`,
a forced new checkout first establishes a **clean CRLF baseline**: 1522 bytes,
46 CRLF, SHA `4fe09b27d97cf73070bd7a9bfda238f953195c91fab65c459d7810165eb4394c`.
Serialization produces only LF: 1476 bytes, 46 LF, SHA
`ebb76a0dd76a88c3edd91c2bd2a5ef372844c6392d33fbdfd2158c17ee0c4f95`.
Normalized content remains equal, while raw status becomes `M Cargo.toml` and
diff stays empty with the same warning. The separate `text eol=lf` control
starts clean and stays clean through two serializations.

[Model JSON](local-toml-eol-reproduction.json), the execution script, exact Rust
source/Cargo manifest/lock and both before/after byte samples are retained.
The script records its original temporary build root; to reconstruct elsewhere,
copy `local-eol-Cargo.toml.txt`, `local-eol-Cargo.lock.txt`, and
`local-eol-main.rs.txt` to a new Cargo project, build with `--locked`, and point
`local-eol-experiment-root.txt` to that project. This models parse/serialization,
not Tauri's separate feature injection, and **cannot replace missing raw evidence
from the original Windows runner**.

Commit `5d951de8` expands each real source snapshot to include Cargo.toml's
HEAD/index/worktree bytes, newline counts, hashes, attributes and stat details.
Three focused regressions passed, including clean CRLF -> raw-status-only LF
rewrite and unchanged index bytes. An initial test fixture failed because
checkout-index reused an already stat-matching LF file; its original failure log
is retained. The corrected temporary fixture removes only its own Cargo file
before checkout and asserts the clean CRLF baseline. The production gate remains
strict. A subsequent real build must establish the LF fix with those snapshots.

Earlier run41653312849 cleanup uncertainty and run41642093459's unconfirmed old
profile deletion remain separate unresolved historical facts.

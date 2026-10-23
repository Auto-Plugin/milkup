# Five Windows PNGs verified; prototype reliability remains blocked

[Run 39939237277](https://github.com/Auto-Plugin/milkup/actions/runs/39939237277)
tested **`5da5f27499286606ab644c8b699133b8942f3e7b`** and remains **failed**.
The canary and first five positive cases passed. The sixth positive, `gitGraph`,
rendered but failed native private-tree deletion with Windows error 5. Its PNG
was discarded and dispatch stopped; 44 positive cases were not reached.

Five original PNGs, totaling **30,169 bytes**, were recovered through the
explicit `partial-failed` path after successful outer cleanup. The consumer
verified exact source/run/native baseline, frame and chunk order, counts,
CRC/complete PNG framing, Pillow decode, dimensions, SHA256, nonuniform pixels
and each exported case's native cleanup. The default consumer correctly refused
the failed CI run; only explicit `--allow-partial-failed` accepted this prefix.
No failure was converted into a successful CI result. The artifact API confirms
**zero Actions artifacts**.

Before pushing the evidence, a Git-blob byte check caught the prototype's broad
text/EOL attribute normalizing PNG bytes. A prototype-local `*.png -text` rule
corrected the unpushed archive; all five committed blobs and the unchanged
consumer manifest were then checked against the original bytes. No corrupted
PNG archive was pushed.

Both root and the prototype agent actually inspected all five original PNGs
with `view_image`. Labels, nodes and connecting lines are visible, with no
obvious clipping or missing letters in these fixtures. Fixed 1280-pixel width
leaves large white areas around the four compact diagrams; C4's secondary labels
are small. This is assistant pixel inspection of a prototype, not end-user
Windows GUI acceptance or Milkup integration.

| Fixture                                                                          | Actual PNG | Bytes  |
| -------------------------------------------------------------------------------- | ---------- | ------ |
| [C4](evidence/windows-visual-2026-10-23/run-39939237277/c4.png)                  | 1280 × 437 | 12,996 |
| [Flowchart](evidence/windows-visual-2026-10-23/run-39939237277/flowchart-v2.png) | 1280 × 74  | 2,216  |
| [Agentflow](evidence/windows-visual-2026-10-23/run-39939237277/agentflow.png)    | 1280 × 149 | 3,845  |
| [Swimlane](evidence/windows-visual-2026-10-23/run-39939237277/swimlane.png)      | 1280 × 426 | 6,215  |
| [ER](evidence/windows-visual-2026-10-23/run-39939237277/er.png)                  | 1280 × 289 | 4,897  |

The [50-fixture index](evidence/windows-visual-2026-10-23/run-39939237277/INDEX.md)
marks all five retained, one failed and 44 unreached cases. The original
[consumer manifest](evidence/windows-visual-2026-10-23/run-39939237277/manifest.json)
is unchanged; a separate
[visual inspection record](evidence/windows-visual-2026-10-23/run-39939237277/human-review.json)
binds the later observations to each original hash. The other **45 fixed cases
have no retained, visually reviewed Windows PNG**. Earlier run `39918541123`
did render all 50, but removed its PNGs during cleanup. Those two facts must not
be combined into a claim of 50-case pixel acceptance.

## Actual failure and new observation

The failed `gitGraph` case reported successful rendering metadata for a
1280 × 178, 6,856-byte output before its cleanup failure. That image was not
exported or viewed. The original native OS5 attempt remains nonretryable;
native Job zero and AppContainer profile removal were confirmed, but the private
tree remained at the native result boundary.

The new observation ran on that same launcher thread after the failed removal:

- `OpenThreadToken` returned `ERROR_NO_TOKEN` (1008); the process token was the
  expected temporary user and was not an AppContainer token.
- DELETE access-open succeeded for the owned root, code directory, copied EXE
  and state directory. FILE_LIST_DIRECTORY access-open succeeded for all three
  directories. All seven explicitly opened handles closed successfully.
- Observation took 931 microseconds and was not truncated. It did not set a
  deletion disposition, enumerate contents, read files, change ACLs/tokens or
  retry deletion.

These are later access observations. They do not identify the failed child
operation, demonstrate deletion-disposition success, exclude a transient state
or identify a lock holder. They do not establish an impersonation leak or prove
that antivirus/mapped images caused the failure. The original error remains.

Independent review found no evidence sufficient for a specific repair. The
remaining diagnostic gap is the **first failing relative child path, API stage
and original error/available NTSTATUS inside the single `remove_dir_all` call**;
the current standard-library interface returns only the final I/O error. More
later metadata or unchanged 50-case runs would not fill that gap. If a subsequent
diagnostic is chosen, bound it to one self-authored failing fixture after the
existing canary gate, and first review exact equivalence to the pinned Windows
deletion flow: relative-handle/reparse protections, access/share/disposition
flags, retry and return semantics. Such isolated instrumentation is not an
approved product replacement deletion implementation. This checkpoint adds no
such implementation, sleep/OS5 retry, ACL adjustment or further CI run.

Both outer Jobs were empty; the temporary account, actual Windows profile and
entire stage were removed with no outer cleanup errors. A later cleanup by the
different supervising token does not turn native cleanup into success. See the
[sanitized failure and observation record](evidence/windows-visual-2026-10-23/run-39939237277/failure-summary.json).
The normalized full job log SHA256 is
`cc5c62197bec5363e2e74150a49feb84de4400b564fa7d904d84ae069725b0a4`.

## Validation and environment limits

All **12 Windows Rust tests actually passed**, including three access-observation
observation tests and the fixed-phase formatter test. Windows PowerShell
preflight passed source/phase allowlist agreement, all 19 phase projections,
unknown-content omission and size/count/malformed-field checks, alongside the
existing complete/partial PNG transport checks. Fourteen local reader tests and
offline Windows-target type checking also passed. The negative rendering corpus
was not repeated; its earlier four assertions belong only to the earlier run.

The canary's preparation wait was 4,201 ms; the positive cases that ran were
between 581 and 778 ms. All seven cases reached the fixed-page ready phase.
This does not explain or erase the previous run's pre-ready 10-second timeout.
Neither the 10-second preparation limit nor the 2-second render limit changed.

The selected installed Runtime's directory, actual EXE `FileVersion` and
`ProductVersion` were independently recorded as **155.0.4283.62**. No Runtime
was installed or updated. The compiler was rustc **1.99.1**, commit
`58cf8f9c35b355199727627d07ae34a4e2846d67`, LLVM **23.1.1**. The original successful
run and prior timeout used the same recorded runner-image identifier and Runtime
directory version, while one earlier OS5 run used an older image/directory.
Historical file versions and compiler versions were not all logged; these
comparisons cannot attribute the failures to a version change.

Native source is pinned to reviewed commit
`7aa222e85859d217c33eedcb244e89ca1089ebbb`, including the observer and fixed phase
markers. Official JavaScript/assets, fixture inputs, Cargo inputs and C#
supervisor remain byte-identical to `82fb49e9`. The current native source is
explicitly not byte-identical to that earlier source. Permissions, token gates,
IPC and cleanup decisions remain unchanged.

## Integration decision

**Do not integrate or distribute this prototype as the product solution yet.**
The existing authorization covers prototype tests and their self-authored
evidence. Product integration of this new trust boundary and delivery of a
package containing it require explicit approval covering that scope; the current
prototype authorization and this report grant neither.

The current recommendation supersedes the earlier beta.6 proposal for a public
SDK `renderMermaid12` method: use a **host-private fixed official rendering
service and private adapter**, returning a validated PNG lease to the existing
ordinary/windowed presentation paths. Bind every result to document identity,
version, block hash, theme and plugin epoch. Decode before hiding source; cancel
by stopping the owned Job, discard late results and release leases on disable.
Reusing that same validated lease for export is also unimplemented.

The minimum remaining engineering and acceptance requirements are:

- A reliable short-lived coordinator under the same logged-in user, with bounded
  cancellation and cleanup. The CI's different-SID cleanup supervisor is not a
  product deployment design. Repeated OS5 and the preparation timeout remain
  unresolved; the current launcher also lacks an external cancellation interface.
- A reviewed account-compatibility policy. The current gate rejects any
  Administrators SID, including deny-only membership, and rejects limited UAC
  tokens. Such filtered administrators are **not elevated**; this prototype
  supports only its strictly tested Users-only account context.
- Actual remaining Windows pixels, width/theme/DPI behavior, and real Milkup
  enable/edit/disable/late-result integration. These five PNGs do not establish
  them. The 50 fixtures cover 37 built-in registrations and selected combinations,
  not every grammar combination; optional ZenUML/tidy-tree and external icon
  assets remain separate fixed-version coverage gaps.
- A deliberate decision about the disclosed browser-vulnerability/UDP residual.
  Ordinary request controls and zero-capability token observations do not prove
  OS-wide network denial. Fixed official code is a different boundary from
  executing third-party plugin code; the latter is still excluded.
- A versioned migration above worker 1.2.0 and a reviewed bundled-receipt
  allowlist, keeping old DOM 1.1.1 disabled. Actual hot lifecycle and source
  fallback need product acceptance after any authorized integration.

The official script is 5,494,801 bytes; this debug prototype EXE is 7,752,192
bytes, SHA256 `156370e8e956493ee789f85d6b38ba5f3837d1ffb8e0938fb6fc7494e2a524af`.
Neither is a compressed installer delta. That requires a future matched release
and NSIS comparison against beta.7's 4,417,540-byte installer. No further run,
product integration, installer execution or Release follows this checkpoint.

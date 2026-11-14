# Windows Mermaid beta.8 test-installer delivery

This delivery extends accepted implementation
`03e62ba936aafc33a3828f734c0cbba58465ab7b` on the independent branch
`dot/mermaid-rebuild-20261103`. Version metadata is now `2.0.0-beta.8`;
the reviewed Diagrams plugin remains `1.3.0`, official embedded Mermaid is
`12.2.0`, and the host SDK remains `0.3.8`. The version increment distinguishes
this trial from the previously delivered beta.7; it does not publish a Release
or configure an update channel.

## Verified delivery

[Windows run 41668620695](https://github.com/Auto-Plugin/milkup/actions/runs/41668620695)
completed successfully for exact candidate
`a5431693a4ea1e1a282c16b9cc9651e17b67f9ea`. Its strict source gate remained clean;
the three source snapshots include Cargo.toml as well as the two schemas. The
current-user NSIS installer executed under a fresh pure standard account with
matching SID/session/held-process image and Job, returned exit 0, and installed
the exact expected 23,882,240-byte executable. All ten real editor operations
passed, seven native diagram PNGs and ten window PNGs were retained, and all four
windows closed normally. The fresh profile, account, installed directory and
staging directory were removed with no cleanup errors.

The runtime was the already installed Evergreen `156.0.4314.50`. Actual PE
imports contain Windows system/API-set DLLs, no external VC redistributable DLL
and no separate WebView2Loader DLL. Node/pnpm are build/test tools, not application
runtime prerequisites. The complete fixed official Mermaid 12.2.0 and bootstrap
bytes, ten decoded embedded plugin archives, exact Diagrams 1.3.0 seals, product
version and icon resource all passed the packaging checks. All ten plugins were
observed disabled at first launch with their expected versions.

| Identity | Bytes | SHA-256 |
| --- | ---: | --- |
| Delivered ZIP | 6,083,119 | `0ffb9793b1ab3c025b6d9d97497260ac3ad8526735bc4f1384343830702da089` |
| NSIS installer | 5,850,857 | `af95f585e5b1143293a28226cbce54b7ba619f81665b543f32de8d325afbc2c7` |
| Compiled application | 23,882,240 | `52b201b7960cea92fb6f5146b1a206ba64d73cc45d78cfc5e39aaa735c15ea71` |
| Extracted and actually installed application | 23,882,240 | `5e84d2aefacbed31df509418223df9a3f92edbede1585b6f4333816ba0d2b1f0` |

[Download the verified Actions artifact](https://github.com/Auto-Plugin/milkup/actions/runs/41668620695/artifacts/13247537890)
requires a GitHub login. Actual API expiry is **2026-11-10 16:06:47 UTC**;
artifact ID `13247537890`, not an estimated seven-day date. The exact same ZIP
was also saved to the user's Library as
`Milkup-2.0.0-beta.8-Mermaid-Windows-x64.zip`. Library retention is separate from
the Actions expiry; no permanent/public download promise is inferred. The ZIP
has 25 files: installer, ten optional plugin archives, instructions, feedback,
four sample documents, license, manifest/checksums and four original reports.
Plugins are also embedded, so standalone archives are optional. After installation,
enable Diagrams in plugin management to use the existing-runtime native path.

[Independent download verification](delivery/download-verification.json) checked
the actual API ZIP digest/size, all entry paths and checksums, plugin and report
identity binding, installed-image identity, 10/10 steps, four normal closes and
all cleanup flags before extracting. No binary or plugin was executed on the
Linux verification host. [API metadata](delivery/artifact-api.json) and
[root visual observations](delivery/root-visual-review.json) are retained.
The original product-only report keeps `installationAccepted:false`: installation
was performed and accepted by its surrounding controller, whose separate
`installation-result.json`, byte comparison and standard-user audit are preserved.
No original report was rewritten to change that scope field.

The wide launch retains `unexpectedUnsavedConfirmation:true`. Its saved fixture
bytes are identical, both the step and pre-close observation show `dirty=false`,
and it exits normally without a save/discard click or forced termination. The
raw confirmation-probe response was not retained. The harness's null-response
unwrapping can produce a truthy object, so this record cannot distinguish a real
visible prompt from that probe behavior. This is an unresolved diagnostic
observation, not evidence of lost edits or a claimed null-response diagnosis.

The original historical cleanup failures remain unresolved as described below;
this new runner only proves its own cleanup. C4 retains the roughly one-pixel
outline overlap, and real IME, broad DPI, upgrade and rollback remain outside
this acceptance. This unsigned trial did not create a Release or merge main.

## Delivery gates

The new workflow builds release NSIS with current-user installation and explicit
WebView2 `skip` mode. An already installed Evergreen runtime is required. No old
Fixed Runtime, runtime installer, original offline instance, main merge or
official release is involved. Full native Mermaid still requires a pure
standard-user account; an administrator account with deny-only Administrators
membership does not satisfy that existing boundary.

Only `prepare-bundled-plugins.mjs` supplies the ten embedded and separately
delivered plugin archives. The older independently minified plugin build is not
interchangeable with the reviewed native package seals. Preparation checks exact
manifest/content seals, the reachable production JavaScript's decoded archive
string bytes, the full official engine/bootstrap byte sequences inside the
compiled and extracted executables, and the single Tauri NSIS `UNK` to `NSS`
three-byte transformation. The built, extracted, and installed hashes are
separately recorded.

Installation runs only inside a new pure-standard-user child, within its newly
owned directory. The process handle provides SID/session/image/Job identity.
The installed executable's exact bytes, x64 machine type, beta.8 product version
and icon resource are checked before launching it. Existing ten-step editor
acceptance then checks real diagrams, editing, undo/redo, disable/re-enable,
wide/C4/invalid cases, and normal window close. Initial DOM observation checks
all ten actual plugin IDs, versions and disabled switches. Native completion,
profile/account/stage cleanup, and retained PNG evidence remain required.

Preparation leaves `deliveryReady=false`. Finalization requires the real
installed-product reports before producing a downloadable accepted package.
The package includes the NSIS installer, identical optional plugin archives,
Chinese instructions/feedback, four example documents, Mermaid's license,
four original acceptance reports, and SHA256SUMS. Upload is configured for seven
days; actual `expires_at`, artifact ID and digest must be checked after upload.

## Preparation evidence

Local checks passed for the PowerShell installer admission path, real bounded
process helper, exact installed-image transformation, evidence whitelist,
optional plugin inventory, and payload verifier. These are local helper tests,
not proof of Windows installation. Retained original outputs and hashes are in
`local-preflight/`. The unchanged Diagrams compiler/renderer passed 56 tests and
the package identity checks passed four. Full build, installation and delivery
outcomes are now recorded above from the actual Windows run.

The earlier implementation acceptance and unresolved historical issues remain
in [the rebuild status](../mermaid-rebuild-2026-11-03/CURRENT-STATUS.md). In
particular, an ended runner's failed profile deletion is still uncertain, another
native cleanup failure was not diagnosed, C4 retains a minor outline overlap,
and installation/IME/DPI/upgrade coverage must not be inferred from earlier
debug-binary acceptance.

## First packaging run: 41665301060

Candidate `d525c6a51d2d6a47615ff3a950a8852a2dde48ae` successfully compiled the
release application, built NSIS, extracted the exact packaged image, and passed
full official-engine/bootstrap and ten-plugin archive checks. The compiled EXE
hash was `2c39f12222b4b64623e00e42d71ce3b8cbee15dad9a09bc198d60e6f44507fb1`;
the extracted NSS image hash was
`57d4402e40a8eead28e6b21b06153bee3a36780ef785fcb20954a1d4a9467408`.
Preparation correctly remained `deliveryReady=false`.

The run then **failed** the unchanged strict source gate: only
`apps/desktop/src-tauri/Cargo.toml` had raw ` M` status. The retained text diff
was empty, with an LF-to-CRLF warning. That run's snapshots covered only the two
schemas, so its original Cargo.toml raw bytes were not captured and cannot be
retroactively claimed. No account, installer execution, product launch, installed
UI acceptance or delivery upload occurred. The small inspection artifact retains
build evidence only.

The locked Tauri CLI 2.11.4 manifest rewriter parses and serializes Cargo.toml,
then writes it if original and serialized strings differ. A separate isolated
Git model using the CLI's exact toml_edit 0.25.4+spec-1.1.0 reproduces clean CRLF
checkout becoming LF-only dirty status with empty normalized diff. The explicit
`text eol=lf` control remains clean across repeated serialization. The fix is
limited to that one manifest's checkout attribute. No source reset, index refresh
or dirty-file exception is introduced. All three source files now have raw,
HEAD and index byte evidence in each phase; the next real build must verify the
correction.

The required retry also adds read-only inspection of the extracted PE's actual
import table. Unexpected external VC redistributable or WebView2Loader DLL imports
fail preparation; the full table and its byte hash enter the delivery manifest.
This complements the [locked build-policy evidence](dependency-build-policy.json)
and does not substitute for installed-product execution.

# Windows Mermaid beta.8 test-installer delivery

This delivery extends accepted implementation
`03e62ba936aafc33a3828f734c0cbba58465ab7b` on the independent branch
`dot/mermaid-rebuild-20261103`. Version metadata is now `2.0.0-beta.8`;
the reviewed Diagrams plugin remains `1.3.0`, official embedded Mermaid is
`12.2.0`, and the host SDK remains `0.3.8`. The version increment distinguishes
this trial from the previously delivered beta.7; it does not publish a Release
or configure an update channel.

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
outcomes will be recorded from the actual Windows run.

The earlier implementation acceptance and unresolved historical issues remain
in [the rebuild status](../mermaid-rebuild-2026-11-03/CURRENT-STATUS.md). In
particular, an ended runner's failed profile deletion is still uncertain, another
native cleanup failure was not diagnosed, C4 retains a minor outline overlap,
and installation/IME/DPI/upgrade coverage must not be inferred from earlier
debug-binary acceptance.

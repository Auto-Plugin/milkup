# Version-only upgrade and manual recovery: native evidence

Run https://github.com/Auto-Plugin/milkup/actions/runs/43606281903 passed on
Windows 2025 under a newly owned pure-standard account. Tested harness:
`a28e729948c3c801f41c0de348da8f9b52253ca3`, branch
`dot/gap-native-capabilities-20261114`. The raw contract was independently rerun
against the downloaded evidence, not inferred only from the Actions result.

## Exact unchanged package inputs

| Input | Application source | Package SHA-256 |
| --- | --- | --- |
| beta.10, 7,251,942 bytes | `b877746f5dfd236dfc13f718ed23d837b8e4f89d` | `c9c5b8bf8e8c75607d3288fc105553dce9cd22bf625fa84d86b45cbd32c7a648` |
| test-only beta.11, 7,255,023 bytes | `5fd33f2b63de2755268af6d669b0f4b3b1f21b96` | `e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75` |

Files: `milkup-2.0.0-beta.10-windows-standard-b877746f5dfd.exe` from 43574228722,
and `milkup-2.0.0-beta.11-windows-standard-5fd33f2b63de.exe` from 43590520662.
Both existing artifacts were reused; no package was rebuilt for acceptance.
The beta.10 input is the previously documented rebuild, not the separately
preserved original b877 installer. The beta.11 fixture only synchronizes app
version metadata: implementation, SDK, plugins and dependency inputs remain
unchanged. It is **not a beta.11 release candidate** or a future schema migration.

## What actually ran

1. Install beta.10, open the fixture, edit/save with actual input, disable
   Diagrams by UI, then normal app exit 0.
2. Authenticate the exact beta.11 package with an ephemeral in-memory test key
   and inspect real PE version resources. Execute NSIS upgrade into the same
   directory/account. Binary and unique HKCU uninstall version both become
   `2.0.0-beta.11`; the original document and explicit disabled setting survive.
   Re-enable, decode a diagram, edit/save, disable again, and normal app exit 0.
3. Copy and hash-verify 208 owned document/config/browser-profile files totaling
   7,979,750 bytes before the fault. Remove only the installed test beta.11
   executable, retaining its backup/hash. This is a missing-image fault, not
   simulated power loss, an interrupted installer or arbitrary database damage.
4. Prepare the real older-version recovery kit with a separate signed
   `manual-reinstall` declaration for this exact version-only pair. Altered bytes,
   wrong authority and expired metadata are rejected. Execute the prepared
   beta.10 installer copy. Restore the exact original executable SHA-256
   `2faf01f73b0a161ae6bb5cb107a74dc5b11fdff39ebf4f2587d5dc0cb1bee854`;
   binary and uninstall entry both report beta.10 again. The beta.11 executable
   had SHA-256 `b129fd49f988eb700db8e606990c7c1f00be92b3fab0d99b4f1bf7070a6c82f6`.
5. Reopen with the newer saved document and disabled Diagrams setting intact;
   re-enable/render, edit/save, normal app exit 0. Actual uninstall exits 0,
   removes the app and its matching uninstall entry, and leaves the final
   document plus all 41 observed application configuration files byte-identical.

All four installer/uninstaller executions returned 0. All three application
launches closed normally; `forcedCleanup=false`, outer pre-cleanup active count
0, cleanup errors empty, and the owned account/profile/staging root were removed.
The token had medium integrity, no Administrators membership and no debug
privilege. The copied data backup was **not restored over newer user data**.

Final saved document: 160 bytes, SHA-256
`e085f3e90b1dd368deddfff6da6b04ceec962654c99bf9679724436f65b92a31`.
Both retained public signatures were independently checked against the actual
two package byte arrays at their signed issuance times. No private key was
persisted. The empty production update configuration remained byte-identical
(accounting for the Windows checkout's CRLF).

## Failure evidence and limits

43605633839 failed before upgrade: the harness compared a quoted NSIS
`InstallLocation` as a bare path. Locked Tauri CLI 2.11.4's installer template
writes that quote pair; the next run confirmed the actual raw registry value.
797f3061 adds strict balanced-quote/absolute-path parsing, retaining raw and
normalized identity. Four valid paths and seven rejection cases passed natively.

43605920764 passed the actual upgrade/health/close but stopped before the fault:
PowerShell unwrapped a singleton backup collection. a28e7299 preserves the array
and adds the post-uninstall configuration comparison. Neither earlier failure
is relabeled as a complete recovery pass.

This verifies a **test-authority version-only upgrade and manual older-version
reinstall**, not the application's automatic updater download/install path,
production signing/channel availability, automatic rollback, general backward
data compatibility, missing Runtime/offline deployment, Windows IME/DPI or
completion of all five release gaps. No main merge or Release occurred.

Final artifact 14117479722: ZIP 130,092 bytes, SHA-256
`67afc89a8b5b818534133681dab3fb192a10aa58367ffbe25805fb3b951e2436`.
Earlier artifacts: 14118475291 (45,808 bytes,
`e5b0ed5ae5ae7cc2637eded55a905417c25f6133e91b09b837a3e72e88bb376b`),
14117529140 (83,202 bytes,
`59faa6f9506a0295bb4b75caea3ddcb8ac756791f8d62cdd49f260d20719879e`).
ZIP SHA/CRC/path safety were checked. Local copies are under
`/workspace/milkup-gap-artifacts/<artifact-id>/`; independent checks are under
`/workspace/milkup-cross-version-evidence-20261114/`. Workspace storage is not
guaranteed permanent; CI artifact retention remains seven days.

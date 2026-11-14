# Isolated application updater acceptance

This supplements, and does not repeat or relabel, the manual installer/recovery
acceptance in `cross-version-native-acceptance-20261114.md`.

## Source and package boundary

The production update channel remains `{channel:"beta",endpoints:[],publicKey:null}`.
The existing beta.10 package cannot check a test endpoint without changing its
embedded authority. A **non-default `ci-update-fixture` feature binary** was built
from `dea1f2a437e43303f185d47ad2014156038d8514` in run
https://github.com/Auto-Plugin/milkup/actions/runs/43607417256. It is not the
previously accepted old executable or a distributable candidate.

Compared with b877746f, application changes are limited to Cargo's optional
reqwest dependency, the feature declaration and updater fixture configuration.
Frontend, packages and production channel bytes are unchanged. The test branch
uses the actual About controller, IPC handlers, manifest/artifact signature,
freshness/replay/version gates, protected save, native install and NSIS restart.
No test UI directly invokes the updater or edits application state.

The feature accepts only a bounded, short-lived public fixture in a Windows
GitHub-hosted test context, an exact loopback HTTPS manifest URL and client-local
certificate trust. Both checking and installation use one immutable authority.
No OS trust store, firewall, sandbox or production endpoint is changed. The
signing key stays in memory; the TLS key is passed in-memory to the existing
PowerShell/.NET certificate tool and is never saved as a key file.

The exact original beta.10 installer provides the temporary installed layout;
only its executable is replaced with the recorded feature binary before launch.
The target is the **unchanged** beta.11 version-only test package already built
in 43590520662. No target rebuild or new beta.11 release is involved.

| Input | SHA-256 |
| --- | --- |
| beta.10 installer from 43574228722 | `c9c5b8bf8e8c75607d3288fc105553dce9cd22bf625fa84d86b45cbd32c7a648` |
| instrumented beta.10 executable, 25,484,288 bytes | `f1bde4b7ee672168e225c4722c6204249391cebaeb247cb7ac9334cc76c75d74` |
| beta.11 target installer | `e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75` |
| expected installed beta.11 executable | `b129fd49f988eb700db8e606990c7c1f00be92b3fab0d99b4f1bf7070a6c82f6` |

Feature build artifact 14119620598 is 25,485,167 bytes, ZIP SHA-256
`5a4e9be4d9ec03b6d55efbfbdc1b883b205b1c77238a6abc9140432b7d61cd59`.
Downloaded ZIP SHA/CRC/path safety and the internal executable hash were checked.
Its CI expiry is 2026-11-21 15:05:18 UTC. Local workspace copies are under
`/workspace/milkup-gap-artifacts/`; workspace retention is not guaranteed.

## Executed checks and preserved failures

Local endpoint/evidence tests cover scoped TLS trust, wrong manifest authority,
HTTP 503 download failure, corrupt artifact signature, exact valid bytes and
absence of persisted private keys. The evidence contract rejects manual relaunch,
wrong process generation, elevated restart, data/config loss, wrong package,
forced cleanup and invented rollback. Combined with prior cross-version contract
tests, 29 tests passed. The .NET certificate path was additionally exercised with
the official hash-verified PowerShell 7.7.0 tool in an isolated Linux directory;
this is not Windows application evidence. Four PowerShell scripts parsed cleanly.

Native run 43608479168 (`b83582d9`) passed Windows endpoint tests and installed the
old layout, but failed **before launching the app**: the ordinary account could
not resolve `Get-Command pwsh`. No in-app update was tested. Commit 157be654 uses
the current held/observed PowerShell process's absolute image instead, without
changing PATH or privileges. Account/profile/stage cleanup completed, with zero
active processes before outer cleanup; this does not turn the failed run green.
Failure artifact 14118599660: 18,575 bytes, SHA-256
`5e8d7a1e335cef9d64553ce8e7b2a66c90ea03ac63b67ff6d54ec52cd084e8cc`.

Run 43608808744 (`157be654`) reached the real application and HTTPS manifest,
but its initial health read failed between two DOM observations: presence passed,
then strict decoding found zero accepted image owners. No update button was
executed. Artifact 14118503675 is 46,284 bytes, SHA-256
`964ffbe11d83b7144d832bba415b3e608b4c7996a8badee26d93ade6dff3a404`.
a07ec88f begins the complete strict PNG decode in the same DOM task as readiness,
within the original 30-second budget. Duplicate owners, invalid PNGs, revoked
Blobs and WebDriver failures are still errors; only absent/incomplete images wait.
Run 43609311825 (`a07ec88f`) passed initial decode/edit/save/plugin persistence
and normal close. The real About UI then showed `The signature verification failed`
for the wrong-authority HTTPS manifest. Its observer returned an `error` property,
which the generic driver wrapper mistook for a protocol error, before completing
the negative-case edit. cf70050b renames that observed field to `updateError` and
records exact string-valued process births tied to held native FILETIME identity.
Artifact 14119449253: 53,070 bytes, SHA-256
`2c5bfff92e80fd69adb419f5d3872d6394bf49ee0f571463488e87bbb6f98d8f`.
Run 43609625368 (`cf70050b`) completed all three native rejection cases, each
followed by real edit/save and the exact old executable unchanged. The correctly
signed, exact target then failed the product's PE parser: its original NSIS
VERSIONINFO has `dwStrucVersion=0`, whereas the reader required `0x10000`.
No installation or restart occurred. Artifact 14119930188: 54,500 bytes, SHA-256
`b9dd63d831370a134dca2a00aec289278247cc7a2dbe00b7783f6aa933106a56`.

The pinned [NSIS 3.11 source](https://github.com/NSIS-Dev/nsis/blob/v311/Source/ResourceVersionInfo.cpp)
zero-initializes this 52-byte structure without assigning dwStrucVersion.
[Microsoft defines this field as a structure revision](https://learn.microsoft.com/en-us/windows/win32/api/verrsrc/ns-verrsrc-vs_fixedfileinfo),
not the application's file/product version. The compatibility fix permits only
known revisions 0 and 1.0; all bounds, resource ambiguity, exact numeric and full
prerelease string checks remain. Signature/freshness/replay checks are unchanged.
The actual 488-byte non-executable resource leaf is retained as a hex fixture
(offset 56024 in the target; leaf SHA-256
`3730cfe0d79ff3f603a332dfb480052e3f597591ed64e681f0ea80328a3bff8d`).
Both full original installers passed the corrected local Rust reader; incorrect
versions still failed. Two resource tests reject unknown revisions, all truncated
prefixes, forged numeric versions and extra bytes. Native rebuilt acceptance is
pending; no complete in-app update pass is claimed yet. Production channels/signing and arbitrary data migration are not covered. Automatic
rollback is not implemented, so it is not labeled as a pending acceptance test.
Completion of all five release gaps is not claimed.
No main merge or Release was performed.

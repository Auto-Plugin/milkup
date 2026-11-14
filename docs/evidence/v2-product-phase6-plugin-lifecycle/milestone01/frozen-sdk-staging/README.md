# Frozen SDK staging correction

Date: 2026-10-19. Scope: shared public-plugin build contract, its staging/external-verifier consumers and focused Node CI tests. No install, Mermaid product source/profile/lock/SDK artifact change, runtime download or UI test was performed by this correction.

## Result

The frozen plugin's installed SDK is now authenticated against its own reviewed vendor tarball rather than the current checkout SDK. The common reader verifies the profile SHA first, parses the SDK archive in memory without extracting files, derives its version and fixed public exports, and compares all four installed public files byte-for-byte against the archive. The local node_modules realpath boundary remains required.

The reader accepts only the four expected ordinary npm-pack members. It rejects duplicate/unknown/path-traversal members, symlinks/hardlinks/PAX extensions, malformed/checksum-invalid/truncated archives and invalid end padding. Bounds: 4 MiB compressed archive, 8 MiB decompressed tar, 2 MiB per member. Invalid numeric bytes cannot be normalized into ASCII octal. A future SDK package format expansion requires an explicit verifier change; it does not silently admit extra files.

`prepare-bundled-plugins.mjs` aliases frozen builds to the verified local SDK entry and reports both per-plugin sdkVersion and hostSdkVersion. Legacy builds retain current-host SDK source behavior. `verify-public-plugin-builds.mjs` copies each frozen plugin's original reviewed vendor tarball, leaving its lock/profile untouched; it no longer substitutes the newly packed host SDK. The full external-verifier installation workflow was not rerun because no installs were authorized for this correction; its shared artifact selection/copy contract is covered by fixtures.

## Red / green evidence

| File | Meaning |
| --- | --- |
| `../checks/bundled-stage.log` | Original full staging failure: installed frozen SDK 0.3.4 did not equal current host SDK 0.3.6. |
| `baseline-0.3.5-red.log` | Direct old-resolver reproduction using baseline host SDK 0.3.5: 0.3.4 !== 0.3.5. Baseline source also has the same coupling. |
| `red.log` | Initial test-fixture syntax mistake (legacy octal escape); preserved, not counted as a contract regression. |
| `red-contract.log` | Corrected new fixture suite against old resolver, before implementation; failing acceptance cases show the new contract is absent. |
| `green-initial.log` | Initial 22 tests passed across three CI files. |
| `green.log` | Final 23 tests passed, including independent reviewed vendor copying, archive bounds and checksum rejection. |
| `stage-green.log` | Second full staging failure: all build/closure checks finished, but stale generated diagrams 1.1.0 was unexpected relative to source 1.1.1. Validate-before-write rejected before any staged package write. Filename is not a success claim. |
| `stage-final.log` | Full prepare command exit 0 after parent archived/removed stale cache. All 10 package provenance records emitted. |
| `ten-bundles.json` | Each of the 10 staged files reread and verified against emitted byte count/SHA and manifest version/permissions. |
| `real-artifact-final.log` | Final strict reader confirms the actual reviewed diagrams SDK 0.3.4 and hash after the numeric decoder hardening. |
| `format.log` | Scoped formatting check exit 0; scoped git diff check also passed. |

Parent retained old cache files under `../bundled-cache-before/` and documented diagrams removal in `../checks/bundled-diagrams-cache-change.json`. No directory was silently cleaned by the staging script. The final SDK numeric decoder hardening affects malformed non-ASCII tar fields only; it was verified by tests and by rereading the real artifact after staging. It did not modify or rewrite any staged bytes.

## Final staged packages

All ten entries appear in `ten-bundles.json` with full hashes. In particular:

- diagrams **1.1.1**: SDK **0.3.4**, reviewed tar SHA `1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f`; package 5,728,276 bytes, SHA `2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19`.
- footnotes **1.0.1**: SDK **0.3.6** under legacy staging; package 16,006 bytes, SHA `73441fb8bfa6f963f6f4333b73705533bb62ae2c3048510f52b1f9720c6e0901`.
- outline **1.3.1**: SDK **0.3.6** under legacy staging; package 40,624 bytes, SHA `77ee29ce64aaba56f2085190f4a9da3b27e1949677d152b9795140419d8837fb`.
- formatting/images/math/preferences/shortcuts/updates/workspace remain **1.0.0**, under their existing legacy policy with host SDK **0.3.6**.

The independently built outline and footnotes packages may differ from legacy staged packages due to the build configuration/path comments; do not substitute their hashes or call them byte-identical. This correction retains the existing legacy policy and does not retroactively claim frozen closure proof for those packages.

## Commands

```sh
node --test tests/ci/public-plugin-sdk-artifact.test.mjs tests/ci/public-plugin-dom-build.test.mjs tests/ci/public-plugin-build-contract.test.mjs
node scripts/ci/prepare-bundled-plugins.mjs
```

Only the following source files were changed for this correction:

- scripts/ci/public-plugin-build-contract.mjs
- scripts/ci/prepare-bundled-plugins.mjs
- scripts/ci/verify-public-plugin-builds.mjs
- tests/ci/public-plugin-sdk-artifact.test.mjs (new)

Runtime manifest engine checks remain authoritative for whether a plugin can run on a host. Building a frozen SDK independently does not bypass compatibility, permission approval or isolation checks. Native production build and installation acceptance are separate parent-thread work.

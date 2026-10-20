# Frozen public SDK 0.3.4 input

`vendor/plugin-sdk.tgz` is the existing public `@milkup/plugin-sdk` 0.3.4 archive used by this plugin's reviewed Mermaid closure. P8 retains these original bytes in Git so a fresh checkout can build that closure. It does not regenerate the archive from the current host SDK, change dependencies, or change the reviewed lock/profile hashes.

- Archive size: **22,524 bytes**.
- Archive SHA-256: `1717c0114aa165fa3e48a1bfa7687ffd0d9b2e5392d33e99d8b2dc59a1f3ad4f`.
- Lock SHA-256: `eece5b86a0955df5204de2dc0cd69b1907a31a83de7d6fad39fa442c11ca7f01`.
- Profile SHA-256: `286fc4ff7359ecca44941bad046b88e2b185150ae8cb01280c94b67830e10c10`.

The pre-existing [P4 checkpoint15 standalone verification](../../docs/evidence/v2-product-phase4-mermaid-engine/checkpoint15/raw/diagrams-gate07/standalone/verification.json.txt) and [P4 checkpoint28 standalone verification](../../docs/evidence/v2-product-phase4-mermaid-engine/checkpoint28/raw/research/renderer-exact-memo-product-integration-01/external-first/verification.json.txt) record this exact archive hash. These are historical build records, not new P8 or Windows build results.

The archive contains only the following four regular files. Its JavaScript, declarations and README match the public SDK source bytes at Git commit `2c3ff12bf3caa50520c8b6d49601e2f33a5f7da0`, under `packages/plugin-sdk/`. The package metadata has the same public name, version, exports, files, scripts and other fields, with the packed development dependency `@milkup/core` resolved from `workspace:*` to the historical workspace version `2.0.0-beta.1`; JSON field ordering also differs. It is not byte-identical to the source `package.json`.

| Archive member           |  Bytes | SHA-256                                                            |
| ------------------------ | -----: | ------------------------------------------------------------------ |
| `package/package.json`   |    556 | `a10b511618230e3c88beb24c0a7f39470247727a30958525aae774f100d7ac6b` |
| `package/src/index.js`   |  3,553 | `08c69a21ee6cf0de394bef80f52d01a906ceeb9ba09ab09cf46c01f4b3a0d7cb` |
| `package/src/index.d.ts` | 39,508 | `f5ad0a499ed19aa10d27acef222a465f8e3df9e8b399d358213fc48f558315ac` |
| `package/README.md`      | 32,676 | `8062ff5ca9c0d87bf408d3bc66c6ccb7ab1473047e21468ef647354718d6d929` |

`readPublicPluginSdkArtifact` validates the archive hash, bounded gzip/tar structure, exact member allowlist, metadata and public exports. `resolvePublicPluginSdkEntry` additionally requires installed SDK files to match those archive members. The checkout regression exercises Git with `core.autocrlf=true`, verifies the SDK archive remains exact, and ensures other vendor archives remain ignored. No hash normalization or current-SDK substitution is permitted.

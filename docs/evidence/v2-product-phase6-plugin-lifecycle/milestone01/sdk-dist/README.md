# Public SDK 0.3.6 tarball

- File: `milkup-plugin-sdk-0.3.6.tgz`
- Bytes: 24,377
- SHA-256: `2043b0586c73579c06821c76a20eb0d7a852ffd7c7e8181ea555433a0c506cec`
- Contents: package.json, src/index.js, src/index.d.ts, README.md only.

Produced from `/workspace/milkup/packages/plugin-sdk` using:

```sh
npm pack --ignore-scripts --cache /tmp/milkup-p6-sdk-npm-cache --offline --pack-destination /workspace/milkup-plugin-lifecycle-evidence/milestone01/sdk-dist
```

`pack-cache.log` records success (exit 0). `pack.log` preserves the first failure caused by the absent default `/home/agent/.npm/_cacache`; no dependency installation was requested. The successful offline pack downloaded no runtime or package. No root lock change. No publish/upload.

The SDK adds the optional explicit pending presentation marker; tests and compatibility limits are in `../presentation-pending/README.md`. Packing does not by itself prove a plugin consumed the tarball independently.

## Separate host package export

`@milkup/plugin` now re-exports `validatePluginCompatibility(manifest, compatibility)` from registry.ts so trusted installation code can perform the identical engines check before any package writes. The parsed-manifest requirement, return value/error wording, missing-engines/target behavior and SemVer implementation are unchanged. Registry install and restore call the same renamed function.

This function is a **host package export**, not a public plugin SDK method or permission. It grants no approval, file access, lifecycle mutation or broker capability. It does not parse or authenticate an untrusted archive itself; the host must first parse/validate the manifest and bind the result to the candidate being installed.

`../registry-preflight-tests.log`: 49 passed, including the existing range matrix compared to direct preflight, no mutation of manifest or registry, fresh result arrays, and omitted target/engines behavior. `../registry-preflight-typecheck.log`: exit 0. No manager, native loader, shared lock or product install flow was modified by this subtask.

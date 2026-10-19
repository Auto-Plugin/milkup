# P6-01 package validation

Baseline: `1388f646703ba19c4ed501b0450d123e70388f9a`. Product edits limited to `packages/plugin/src/package.ts` and new `package-validation.test.ts`.

- RED: `red.log`, exit 1, 38 failed / 21 passed. Existing Worker/DOM archive tests remained green.
- GREEN: `green.log`, exit 0, 59 passed (51 new validation cases plus 8 existing archive cases).
- Typecheck: direct installed `tsc -p packages/plugin/tsconfig.json --noEmit`, exit 0; empty `typecheck.log` is expected.
- Formatting: direct installed Prettier, exit 0, `format.log`.
- Real existing archive compatibility: `official-compatibility.json` records each path, SHA256 and baseline/current result. All 10 currently bundled archives and 9 accepted old dist archives pass. One obsolete dist `milkup.export-print-1.0.0` is rejected by both baseline and current manifest validation because its command IDs/actions are invalid; it is not a regression. Both 5,726,838-byte Mermaid 1.1.0 and 5,728,276-byte Mermaid 1.1.1 archives pass. No package-size cap was introduced.

## Format rules

Installable archive entry points must resolve to package-contained files (Worker and sidecar included); standalone development manifest loading is unchanged. File/resource paths reject absolute, UNC, drive/ADS, NUL/control characters, Windows-invalid characters, trailing dot/space and device components. Existing `./`, internal redundant separators and relative backslash normalization remain supported. Paths are checked for case-insensitive duplicate aliases and file/directory conflicts in either order. Root `plugin.json` and its descendants are reserved for the host-generated manifest; nested ordinary `nested/plugin.json` remains legal.

Binary content must be canonical padded RFC 4648 standard base64, with zero unused padding bits. Empty content is valid. Unpadded strings, whitespace, URL-safe alphabet and nonzero padding bits are now rejected before installation. Validation scans encoded text without allocating a decoded binary copy. These are package-format constraints checked on Linux; this is not Windows runtime evidence and not an OS sandbox claim.

No native transaction, permissions, registry or lifecycle code changed. Rejection of invalid complete archives occurs before the existing desktop installer is called, but native write failures and upgrade rollback still require the separate transaction work.

## Commands and retained unsuccessful tooling attempts

```sh
node_modules/.bin/vitest run --config packages/plugin/vitest.config.ts packages/plugin/src/package-validation.test.ts packages/plugin/src/package.test.ts packages/plugin/src/package-dom.test.ts --maxWorkers=1 --no-file-parallelism
node_modules/.bin/tsc -p packages/plugin/tsconfig.json --noEmit
node /workspace/milkup-plugin-lifecycle-evidence/milestone01/package-validation/check-official.mjs
```

The initial RED used the same Vitest arguments through `pnpm exec`. A later `pnpm exec` noticed concurrent workspace manifest changes and attempted its automatic install; it failed before tests at `/home/agent/.local/share/pnpm` ENOENT. Those two not-executed logs are retained. Subsequent commands directly used installed binaries; no dependency or lockfile change was made by this work.

The first archive script stopped at the preexisting invalid obsolete archive; its failure log is retained. The next run compared baseline/current but Vite also emitted a dependency-scan warning. The final script disables dependency discovery and checks all 20 existing archive files successfully. Archive contents are parsed as data, never executed; the baseline package parser is copied from git with only its manifest import changed to an absolute source path. No UI or Cargo ran.

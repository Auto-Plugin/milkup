# P7 browser fixture startup diagnosis

The failed first browser suite is retained by root at `milestone01/validation/browser-e2e-01.log` and its original Playwright error-context artifacts; root interrupted its owned run with SIGINT/exit130 after repeated startup failures. This audit did not launch a browser, native UI or Vite server. Only the existing product registry parser and a TypeScript AST fixture scan were executed locally.

## Cause and baseline comparison

`PluginRegistry.validateRegistrySnapshot` requires nonempty manifestPath/rootPath/sourcePath/**dataRoot/storageRoot** for every restored record. Six manually seeded record constructors omitted the last two fields. Validation rejects the complete snapshot before replacing registry state. Desktop manager catches the restore error and reports that the legacy registry is corrupt; no Workers are started and the plugin-card list remains empty.

The actual parser reproduces `Invalid plugin registry snapshot: dataRoot`; adding only dataRoot then fails with `storageRoot`; supplying both per-plugin roots accepts the same manifest/state/approvals. See `before.json`. Production `packages/plugin/src/registry.ts` is byte-identical to baseline `fa530b399a5ebbd020f9bfa7ca039378604c8282`, SHA256 `45a52f998dcc3bec457635baf8e1fb68f0023a4d3df34106d99f234d33a52a1a`. The P7 focus/cache changes did not introduce this stricter requirement; the browser fixtures were not updated with the P6 validator.

This is not an 11-bundled-plugin or outline-version collision: browser main does not create a native catalog, and its bundled-package provider returns [] outside Tauri. Formatting's error snapshot has no plugin cards, only catalogue diagnostics. Markdown helper waits for both an enabled record and a successful enable audit; neither can arise from a rejected registry. Its timeout occurs before seedMarkdownExtensions, explaining the empty document without claiming content loss.

## Scoped adaptation

Five fixture files, twelve added lines, no product changes:

- tests/helpers/formatting-plugin.ts: one record.
- tests/helpers/markdown-extension-plugins.ts: the record factory for math, controlled test-image provider/native-unavailable placeholder, and footnotes.
- tests/e2e/desktop-shortcuts.spec.ts: initial plugin record plus shadowed-keymap record factory.
- tests/e2e/desktop-updates.spec.ts: one record.
- tests/e2e/desktop-workspace.spec.ts: one record.

Each adds deterministic per-plugin `milkup://plugin-data/${manifest.id}` and `milkup://plugin-storage/${manifest.id}`, matching normal registry scopes for these valid fixture IDs. Existing cards/shell record constructors already have roots and were left untouched; registry serialization via actual PluginRegistry also remains unchanged. Empty-record isolation snapshots are valid and unchanged. No permissions, trust, state, enable audit requirement, retry, timeout, native catalog or receipt logic was changed. A common helper was not introduced because these objects live inside serialized page init/evaluate closures; two explicit scope fields avoid introducing an injected helper dependency.

`validate-seeds.cjs` scans all TypeScript files in tests/helpers and tests/e2e, finding ten direct objects with manifestPath/rootPath/sourcePath. Before: six omit required roots; after: none omit roots. This structural scan is scoped to directly constructed records, not a claim that arbitrary dynamic JavaScript is statically validated. `after.json` and `source-proof.json` freeze the check and edited-file hashes; `fixture-only.patch` is the exact bounded diff.

## Remaining validation

The parser/schema obstacle is reproduced and corrected. Real Worker activation, contribution rendering and complete browser suites still require root's targeted rerun after the native CPU quiet window. No browser success is claimed from schema acceptance alone; any later failure must remain separate evidence rather than being hidden by this diagnosis.

# Milkup Outline

An independently packaged, read-only Worker plugin. The host knows only its normal
manifest contributions and the public `@milkup/plugin-sdk` contract; it contains no
outline registration or outline-specific document access.

## Features and limits

- H1–H6 hierarchy, per-heading collapse/expand, and collapse/expand all controls.
- Click a heading to navigate without changing document text.
- Current-heading highlighting and a visible collapsed ancestor when appropriate.
- Document identity/version, active line and source/live mode come from public UI
  lifecycle snapshots. Edits and document switches invalidate stale scans.
- Explicit empty, loading and failure states.
- Builds a complete heading index in the background for each document/version,
  scanning consecutive 4,096-line ranges, including ATX and Setext headings.
- Persists heading records in eight-record pages and visible ordinal mappings in
  256-record pages through the public temporary-store API. Each page cache has
  eight entries. The 500-row limit applies only to DOM rendering; there is no
  16,384-line index limit and no all-heading array in memory.
- Collapse state and ancestors work across page boundaries; collapse all also
  applies to headings indexed later. A cancelled scan leaves the indexed portion
  navigable with an incomplete status. Retry starts a new indexing session.
- Rapid edits debounce indexing startup; an obsolete store is disposed before a
  new one is created. Actions from earlier document versions/sessions are rejected.
- Indexing progress and incomplete/cancelled/failed states remain explicit. A
  storage quota failure never masquerades as a complete outline. The host enforces
  a 256 MiB charged limit per temporary store and a shared 512 MiB limit. Pages are
  temporary indexes, not recovery copies; interrupted-session pages still count
  against the shared quota, without deleting another possibly active owner.
- Requires only `document:read`. No private host imports, internal store access,
  DOM access, filesystem permission or network permission.

## Independent build

Copy this entire directory to any location outside the Milkup checkout. Keep
`package.json`, `tsconfig.json`, `plugin.json`, `src/plugin.ts` and `scripts/build.mjs`.
Tests are development-only and are not needed to build the package.

The SDK is distributed as a local archive at this stage, not published to npm:

```sh
# Run once in the host checkout to produce the public SDK distribution.
pnpm --dir packages/plugin-sdk pack --pack-destination /absolute/sdk-output

# Run in the copied standalone plugin directory. This installs the public SDK
# archive and the declared TypeScript/esbuild tools; no workspace links are needed.
npm install --no-save --package-lock=false /absolute/sdk-output/milkup-plugin-sdk-0.1.1.tgz
npm run build
```

The plugin owns its TypeScript configuration; it does not extend the host's config.
The build checks that imports come only from local plugin source or the public SDK,
then rejects any residual imports in the ESM output. Outputs:

- `dist/plugin.js`: one self-contained ESM module with its default plugin export.
- `dist/milkup.outline-1.1.0.milkup-plugin`: JSON archive containing the manifest and
  UTF-8 module, using the host's standard `milkup-plugin` version 1 archive format.
- `dist/build-meta.json`: esbuild input/output inventory for auditing dependencies.

No new repository, registry publication or host source modification is needed.

## Install, enable, disable, uninstall

1. In Milkup choose `菜单 > 插件 > 安装本地插件`.
2. Select `dist/milkup.outline-1.1.0.milkup-plugin`.
3. Review the manifest and enable `Milkup Outline`.
4. Open a Markdown document and use the sidebar panel.
5. Disable the plugin in the same manager to remove its UI and stop its Worker.
6. Uninstall it through the manager to remove the installed copy. Documents and
   ordinary host editing remain usable without the plugin.

The package can be installed under a different manifest identity without changing
host code. The host resolves the declared UI and commands through its generic
plugin registry. Keep command IDs local to the package; the manager provides the
plugin namespace.

## Public API and trust

The source imports only `@milkup/plugin-sdk`. See that package's README for lifecycle,
controlled rendering, virtual list attributes, bounded scan events and capability
contracts. `definePlugin` performs typing without registration; activation receives
only the brokered host APIs. Pending work is cancelled during lifecycle cleanup.

Install only locally reviewed, trusted code. Worker separation and controlled UI do
not provide a complete malicious-code sandbox. This plugin does not require
additional credentials, security exceptions or persistent permissions.

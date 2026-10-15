# Milkup Updates

An independent Worker plugin owning all update presentation, version metadata,
download progress, polling, cancellation, retries and install requests. It imports
only the public `@milkup/plugin-sdk` 0.2.0 API. The host retains trusted release
sources, signature checks, staging, installation confirmation and document-save
protection. The plugin never receives a release URL, key, signature or file path.

Install `dist/milkup.updates-1.0.0.milkup-plugin` from the generic plugin manager,
review and approve `app:updates`, then enable it. Open **软件更新** from the plugin's
detail page using its ordinary UI contribution entry. Installation does not enable
the plugin automatically. There is no host-specific update menu or registration.

Check for a release, read its plain-text notes, then download it. Closing the modal
leaves a download running so editing can continue. Reopening shows its current
state. Installing requests a trusted host confirmation and save guard; cancelling
that confirmation leaves the staged release ready. Disabling or unloading the
plugin stops its polling and requests cancellation without waiting for any pending
installation confirmation. Installing remains in progress until the host exits.

## Independent build and tests

This folder contains its own manifest, source, TypeScript configuration, tests and
build scripts. It is intentionally outside the pnpm workspace. Produce the public
SDK archive in the host repository, then pass its path to the verification script:

```sh
pnpm --dir packages/plugin-sdk pack --pack-destination /tmp/milkup-sdk
node plugins/updates/scripts/verify-external.mjs /tmp/milkup-sdk/milkup-plugin-sdk-0.2.0.tgz
```

The script copies only this directory to
`/workspace/milkup-plugin-architecture-evidence/updater-external`, installs the SDK
tarball plus TypeScript/esbuild/Vitest, and runs `pnpm run build` and `pnpm test`
there. An optional second argument selects another directory outside the checkout.
It writes build/test logs and `verification.json` alongside the copied project.
To build manually, copy this directory out of the checkout, set the SDK development
dependency to `file:/absolute/path/milkup-plugin-sdk-0.2.0.tgz`, run `pnpm install`,
then `pnpm run build` and `pnpm test`.

The build rejects private dependencies and residual ESM imports. Outputs are
`dist/plugin.js`, `dist/build-meta.json`, and
`dist/milkup.updates-1.0.0.milkup-plugin`. The archive has no external resources.
No signing key, publication, upload or repository creation is required.

The manifest ID is `milkup.updates`, the view ID is `updates-modal`, and command
IDs are `updates.check`, `updates.download`, `updates.cancel`, `updates.install`.
Command handlers acknowledge immediately while asynchronous operations refresh
the visible view through `host.ui.requestUpdate`. Status polls are sequential at
500 ms intervals, stop at terminal states, and cannot revive a disposed session.

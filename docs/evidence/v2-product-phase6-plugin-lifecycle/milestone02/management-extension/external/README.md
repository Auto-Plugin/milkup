# Milkup Plugin Management 1.0.0

Independent Worker extension using only public `@milkup/plugin-sdk` 0.3.7.
The sensitive `app:plugins` permission provides read-only catalog information
and trusted-command requests to open host detail/settings pages. The extension
cannot approve permissions, commit installations, enable/uninstall plugins,
write settings or remove data. Preinstallation does not approve this capability.

The ordinary list shows a title-initial logo, title and description. Details show
compatibility requirements, declared/approved capability and origin differences,
catalog entry revision, optional candidate fingerprint, diagnostic messages and
declared setting constraints/defaults. Stored user settings and native paths are
not exposed. Candidate fingerprints are informational, not approval tokens.
The extension explains unavailable/incompatible/failed states and links back to
trusted host UI. The host's basic plugin management and recovery shell must remain
available when this extension is disabled, unapproved or crashed.

SDK declarations are validated and bounded by the host. Reads are cancelled on
close/dispose; late responses cannot replace a newer selection. Host navigation
is invoked synchronously from the command handler so the host can consume the
trusted gesture, and stale catalog revisions require a fresh user action.
Only the SDK's inert UI nodes and documented shared style vocabulary are used.

## Independent build and installation

Copy this directory outside the checkout and supply the reviewed public SDK
tarball. `verify:external` records an external dependency lock and build/test
logs; it does not change the source package manifest or a workspace lock.

```sh
PNPM_CLI=/absolute/pnpm.cjs node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.7.tgz /new/external/build
```

The external build installs only development tools and the public SDK tarball.
For offline installs, set `PNPM_STORE_DIR` and `PNPM_CACHE_DIR` to a populated
cache. The script records the SDK hash, copied-input hashes, exact resolved
versions, metadata and package hash. This source package does not claim a frozen
dependency profile; its exact direct tool versions and the external derived lock
are preserved in evidence.

Install `dist/milkup.management-1.0.0.milkup-plugin` through the host's standard
local-package picker. Review `app:plugins` in trusted host UI and enable it. Open
its “插件说明” modal contribution. Disable/uninstall in the host manager; doing
so must not hide or disable the host's independent recovery controls.

No runtime/engine download, registry publication, custom host registration, private
import or plugin ID special case is required. A successful build is not evidence
of native installation or recovery; those require separate host acceptance tests.

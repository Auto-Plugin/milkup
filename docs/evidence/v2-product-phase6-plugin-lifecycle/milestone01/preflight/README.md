# P6 compatibility preflight and host renderer generation

Product ownership: only `apps/desktop/src/desktop-plugin-manager.ts` and its test file. This work uses the separately exported registry `validatePluginCompatibility`; no duplicated SemVer logic, registry/permission/Worker/native changes or UI/Cargo execution.

## Evidence

- `red.log`: direct installed Vitest, exit 1, 5 failed / 31 passed. Existing installation returned a failed record instead of rejecting before side effects.
- `red-overwrite.log`: refined upgrade assertions, exit 1, 5 failed / 31 passed. Both unsupported Milkup and unsupported SDK candidates actually changed the mock installer file contents from `1.0.0` to `2.0.0` before rejection checks; the original log contains expected/received values. This is an injected production-interface test, not native filesystem execution.
- `green.log`: direct installed Vitest, exit 0; manager 27, DOM manager 10, bundled 18 = 55 passed.
- `typecheck.log`: direct installed `tsc -p apps/desktop/tsconfig.json --noEmit`, exit 0 (empty successful output).
- `format.log`: direct installed Prettier for the two owned files, exit 0.
- `source-hashes.json`: exact owned source hashes at handoff.

```sh
node_modules/.bin/vitest run apps/desktop/src/desktop-plugin-manager.test.ts apps/desktop/src/desktop-plugin-manager-dom.test.ts apps/desktop/src/bundled-plugins.test.ts --maxWorkers=1 --no-file-parallelism
node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit
```

## Behavior and limits

`installManifestPath` parses the manifest, checks the fixed allowed host set and calls the registry's shared compatibility validator before `installPackage`, `ensureDataDirectories` or registry mutation. The compatibility target is a frozen manager field shared with the registry. Rejection remains visible in the existing install-failure UI rather than creating a new failed installation record.

Upgrade regressions preserve the exact old enabled record/contributions/persisted registry, live command object and runnable command result, plugin setting schema and stored setting value; neither native installation spy nor data-directory spy runs, and the old module is not disposed. New incompatible archive and raw manifest attempts create no installed record or directory/file call.

No `await ready` was added inside `installManifestPath`: it is also used by constructor-owned bundled installation, so awaiting its own ready chain would risk deadlock. Existing public picker readiness behavior remains unchanged.

This is early rejection only. A compatible package can still fail during write or activation, and native transaction/rollback remains pending. Existing `reload` tears down before calling `installManifestPath`; this patch does not claim to preserve an enabled old instance after that separate reload path fails. Filesystem and persistence failures still require the planned transaction work.

## Read-only collector identity finding and getter

The pending collector previously checked only `(pluginId, rendererId)` activity. Disable and re-enable of the same ID entirely within a retry interval is an ABA case: the new instance could otherwise inherit an old preparation request. A stable document version alone does not distinguish instances.

Added host-only `documentRendererGeneration(pluginId): number`, returning the existing activation epoch or zero. It does not increment or change lifecycle ordering and grants no plugin capability. The test verifies install/enable/disable/re-enable generation changes, plus repeated getter and state calls remaining read-only. Root owns collector/service/main wiring: capture this generation once for each provider preparation and require it before retries and after awaited results. This prevents same-ID new instances accepting old pending work; generation zero alone is not proof a provider is enabled, so existing active-declaration checks must remain.

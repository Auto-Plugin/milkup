# Isolated cross-version installation fixture

This branch is **not a beta.11 release candidate**. It changes only the synchronized
application version metadata from 2.0.0-beta.10 to 2.0.0-beta.11 to produce a real
second PE/NSIS version for isolated upgrade and manual recovery acceptance.
Application implementation, SDK, plugins and dependency versions remain those of
the tested b877746f application. Harness fixes are inherited from 2f71c57a.

No production endpoint, public key, signing credential, release tag or published
Release is configured. The test package must remain labeled as a fixture and must
not replace the user's beta.10 package. The preserved beta.10 input is the exact
new build from run 43574228722, SHA-256
`c9c5b8bf8e8c75607d3288fc105553dce9cd22bf625fa84d86b45cbd32c7a648`.

Required later acceptance: ordinary-user install and edit/save; exact second
version upgrade and startup with retained document/plugin settings; separately
authorized test-signed older-version recovery with backup and health checks;
actual uninstall and ownership cleanup. A version-only fixture cannot establish
compatibility of a future data-schema migration or production automatic updates.
It is not evidence that any of those native steps have already run.

Local preparation: version synchronization/check, version negative tests,
distribution and signed recovery contracts: 27 tests passed. Native build and
cross-version installation remain pending.

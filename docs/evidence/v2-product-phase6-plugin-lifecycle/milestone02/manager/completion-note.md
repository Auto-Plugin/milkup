# P6 manager implementation checkpoint

Frozen for Root integration and production02. No native UI, Cargo, production build, commit, or package upload was run by this agent in this checkpoint.

- Native catalog authority, per-ID lifecycle queue, reviewed revision/fingerprint approval, pending/active separation, restricted prepare → native commit → runtime publication.
- Active and pending generations recheck current host/SDK compatibility before execution. First-install publication failure marks the committed generation failed and disabled when no rollback generation exists.
- Exact owner disposal is shared with runtime cleanup. Failed retirement operations retain their closures and explicit owner retry API; no new activation proceeds until cleanup succeeds. Callback errors remain diagnostic when the trusted owner confirms retirement. Initialization failures and late loaded owners retain their cleanup handles.
- Sealed package file scope is read-only; plugin-data is a distinct read/write/delete scope, still subject to permissions and precommit activation gate.
- Public management diagnostics use safe categories rather than raw native paths; metadata projection supports 512 entries within the broker budget. Detailed permission/origin differences remain exact; oversized details fail unavailable.
- Strict native DOM document renderer profile is permitted; broader DOM profiles and sidecar trial are refused.
- Trusted manager list/details UI keeps candidate approval independent; errors remain in details, cleanup tombstones expose retry, and data is retained.

Validation: manager-final-02.log: 110 tests in 5 files passed (catalog 19, manager 30, registry 55, output 4, editing 2). type-final-02.log: desktop TypeScript exit 0. Owned files formatted by Prettier.

Regression evidence: retirement-red.log records three original failures, retirement-green.log their initial fix; compatibility-red.log records two actual unsafe execution failures before fixes. sealed-red.log is a harness syntax failure; sealed-red-02.log includes a fixture-permission setup failure and the first-install publication failure, so it must not be cited as a valid package-scope security RED. Final package read/write/delete/data-scope and candidate-write checks pass in manager-final-02.log. manager-final.log contains an asynchronous test rejection discovered after the activation-gate API changed; the test now awaits and catches the forbidden promise, with no unhandled error in manager-final-02.log.

Native p6-catalog-raw-01 remains preserved as the original product failure. Production02 and native cleanup/recovery confirmation belong to Root; these unit tests do not substitute for native process evidence.

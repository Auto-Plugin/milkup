# 43835601782: original-support integrity preflight stopped before restore

Run: https://github.com/Auto-Plugin/milkup/actions/runs/43835601782

Tested SHA `86e094027a64171b3714b67e0cd6ee9606c3f57e`, explicit dispatch after
checking no queued/running equivalent. The run failed in step 3, **Pin preflight
scope before any restore or build**. There was no cache restoration, engine
compilation, package installation, private runtime loading or native PDF. All
fifteen current-candidate cases remain unexecuted. No automatic successor.

The real failure is `NativeContracts.test_original_support_integrity_except_exact_manifest_hook`:

- actual audit script after the URI representation correction:
  `b826c8e9b18f92d15dc96591f651b14fac04b1e6346bc883708e7a0d6cd68e90`
- original immutable receipt:
  `c1f6a2006521b3503c88869cec679bbad4d53489d4320e2021a90c380234a486`

The integrity check correctly rejected the unaccounted-for script delta.
The preceding 12 actual-command/header contracts and 10 cache contracts passed;
the native contract suite had 9 passes and this one failure. The smaller local
pre-dispatch selection had missed this full workflow entry point. This is a
harness integration omission, not a native PDF or product behavior result.

No artifact was produced because the evidence directory does not exist before
this step. The original completed job log is retained unchanged as
`job-original.log`, 28,471 bytes, SHA-256
`8591bab4f5d44042d7aebda7b1ec06708f29ab072dcb7a5e7e59b318c1309e1f`.
Run/jobs/artifacts API records establish the skipped boundary.

## Corrected local integrity proof

The original support receipt is **not updated**. The only permitted reporting
delta is `support-uri-serialization.patch`, SHA-256
`122a527f4835e89569eb6f0ee89c11f8c1599ffec86923b7853b9b24d2e8f752`.
`support_integrity.verify_audit` checks the exact current bytes, exact delta,
and original receipt; in a temporary tree it reverses that delta and requires
the reconstructed original file's exact original hash. The original launch
helper and the separately reviewed library-manifest hook remain checked.

New negatives reject altered clipping/page thresholds, appended bytes, an
updated original receipt and a modified delta. The real original PDF regression
still runs after explicit official reader prerequisites and before expensive
compilation. No actual PDF, engine behavior, fixture, threshold or safety
policy changes in this correction.

All actual early workflow commands were then executed locally in order:
12 preflight + 10 cache + 11 native contracts + 15 mechanism + 22 behavior
tests, followed by 3 real-PDF URI-report + 8 combined/auditor tests: **81 pass**.
This closes the observed local wiring failure; it does not claim a new CI or
native pass. The combined patch remains
`21eef8e16614a44cfe0be023812617b17865cbd29fce66b172905bef7b052008`.

Any next explicitly authorized native run keeps the exact proven six-field
restore, 2400-second/160-miss engine bound and 550-second native batch. No
seven-field archive was put through the old restore, no cold rebuild occurred.
The previous raw first-PDF result remains separate from this empty native run.

The local source-based package review is in ../../PACKAGE-BOUNDARY-DESIGN.md;
it identifies temporary-prefix/libexec/injected-bundle boundaries and required
security-maintenance evidence without creating a distributable runtime.
No main/release, formal configuration, notification, upstream or system safety
change occurred. #255 remains queued, not tested by this failed preflight.

# Regression Policy

This policy turns bug fixes into durable regression coverage.

## Rule

Every bug fix must add or update one of these entries before the fix is considered complete:

- A unit, integration, browser, native, or `tests/regressions` test that fails without the fix.
- A manual regression entry in `docs/coding-plan.md` or a linked audit document when the behavior cannot be automated in the current environment.
- A documented exception explaining why no regression is useful, for example a pure comment change or build metadata correction.

## Preferred Locations

- V1 high-risk behavior belongs in `tests/regressions/v1`.
- Cross-package contracts belong near the owning package, with a link from the relevant audit document when needed.
- Browser-only behavior belongs in `tests/e2e`.
- Native-only behavior belongs in `tests/native` or in the manual matrix when an OS dialog, IME, or cross-platform interaction cannot be automated.

## Required Metadata

Each v1 regression test file must declare a `v1Issue(...)` metadata object with:

- `area`: the behavioral area.
- `lesson`: the invariant learned from the old failure.
- `risk`: the user-visible failure mode the test prevents.
- `source`: the issue, audit, or local note when available.

The `@milkup/regressions` policy test checks this metadata so new v1 regression files cannot silently skip it.

## Completion Checklist

When fixing a bug:

- Reproduce the failure or describe the observed failure path.
- Add or update regression coverage in the preferred location.
- Run the focused test command and the relevant package typecheck.
- Update `docs/coding-plan.md` if the fix changes milestone status, acceptance evidence, or manual follow-ups.

# P6 milestone01 evidence

Baseline: `1388f646703ba19c4ed501b0450d123e70388f9a`. Branch: `dot/milkup-v2-product-phase6-plugin-lifecycle`.

This is the first P6 checkpoint, not full P6 acceptance. The final checkpoint report is `docs/v2-product-phase6-plugin-lifecycle-2026-10-19.md`; the checklist was created before implementation. All RED runs and harness failures are retained. Historical/intermediate reports describe the evidence available when written; their `pending` labels do not override subsequent independent reviews and control exit records.

- `package-validation/`, `preflight/`: deterministic pre-change failures and corrected package/compatibility validation.
- `readiness/`, `presentation-pending/`, `footnotes/`: explicit pending protocol, retry/timeout/cancellation/version/provider-generation tests, including review-discovered RED failures.
- `sdk-dist/`, `footnotes-external/`, `outline-external/`, `frozen-sdk-staging/`: public SDK and independent consumer build evidence. External build indexes describe full local outputs; executable/archive artifacts are intentionally excluded from this Git evidence copy, not silently claimed present.
- `production-accepted/proof.json`: actual release binary and changed-input fingerprints. Two earlier builds in `production/` and `production-final/` are superseded and were not final native acceptance binaries.
- `native-ui/runs/`: immutable native screenshots, source bytes, real HTML/PDF/page rasters, observations and completion records. `runs/control/*-p6-command.json` records actual harness exit codes. `native-ui/control/` tracks driver PID/birth and owned teardown separately.
- `native-ui/review/`: independent reviews. Raw `completion.json` fields such as `visualReview: pending` are not rewritten; subsequent reviews supply visual conclusions and limitations.
- `native-preflight*/`, `native-approval-guard03/`, `native-html-marker04/`: harness preflight and correction evidence. Preflight against historical binary is not P6 native proof. The first HTML run counted an aria-label summary as duplicate body text; the original failure and artifact remain. The corrected check counts body text and still rejects real duplicated text.
- `checks/`: intermediate and final checks, source/binary comparison, build-staging cache changes. Early workspace checks precede final provider publication changes; use `final-checks.json` for the final workspace run.
- `architecture-handoff.md`, `transaction-options.md`, `native-audit.md`: unresolved lifecycle/transaction work and parent architecture decision. Package preflight is not rollback, permission-delta approval, crash recovery or a complete sandbox.

No runtime downloaded; no Windows/macOS or physical-printer acceptance. Native WebKit application zoom is not system DPI testing. The product retains WebKit; external HTML inspection is only a viewer, not a replacement PDF engine. P5 PDF Unicode/pagination and historical native Print04 timeout remain open.

The archive inventory `final-index.json` and `verify-index.py` validate exact bytes, including nested indexes. `excluded-local-artifacts.json` records locally retained ELF/SDK/plugin artifacts by path, size and SHA-256; none are uploaded by this evidence archive. A successful inventory check does not convert a recorded failed run into a pass. Absolute executor paths in raw logs are provenance, not portable download URLs.

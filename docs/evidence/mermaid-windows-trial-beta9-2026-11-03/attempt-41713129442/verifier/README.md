# Offline beta.9 installed-product verification

This external verifier preserves the original artifacts and does not execute the
Windows installer, application, or plugins. The frozen candidate's pure Node
validation exports are used to replay native and close evidence. The explicitly
provided, separately hash-checked Linux 7zz reads the exact NSIS application
member for static validation.

The sole acceptance entry point is `verify_installed_dual.py`. Supply the API
metadata and ZIP bytes of all three artifacts from the same run: installed
evidence, packaging inspection, and delivery. The output path must not exist.
The complete result must have `overallAccepted: true` and no errors. Individual
CI status fields or successful request admission do not establish acceptance.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 verify_installed_dual.py \
  --candidate a5556beea5cdd1570361c528b2326bc0ad8ba0c4 \
  --version 2.0.0-beta.9 --run 41713129442 --attempt 1 \
  --repo /workspace/milkup-mermaid-rebuild \
  --harness /workspace/mermaid-rebuild-evidence/windows-installed-41713129442/candidate-mermaid-product-e2e.mjs \
  --harness-provenance /workspace/mermaid-rebuild-evidence/windows-installed-41713129442/harness-exact-windows-checkout-provenance.json \
  --sevenzip /workspace/mermaid-rebuild-evidence/tools/official-7zip-linux-q7qsaqkh/7zz \
  --installed-api INSTALLED_API_JSON --installed-zip INSTALLED_ZIP \
  --inspection-api INSPECTION_API_JSON --inspection-zip INSPECTION_ZIP \
  --delivery-api DELIVERY_API_JSON --delivery-zip ROOT_DOWNLOADED_DELIVERY_ZIP \
  --output NEW_RESULT_JSON
```

The 41 archive, 19 package and 10 protocol-log tests are synthetic component checks, not Windows
acceptance. The actual three-artifact invocation is required. The standalone
`cleanup_observations.py --self-test` references a module not included here; it is
not a supported entry point in this directory and the main CLI does not use it.

Compiled EXE and dist modules are not uploaded. Their original Windows full-byte
transform and AST inspection reports are bound to the exact package, but are not
independently recomputed locally. Static inspection independently verifies the
delivered NSIS application bytes and complete fixed engine/bootstrap sources.
No new Windows execution, upgrade/rollback, full IME/DPI matrix, or human visual
acceptance is inferred. The historical IPC error 995 remains unexplained.

For the new candidate, the closed inspection set also requires
`native-regression.log` (16 reports plus manifest, still 2 MiB per report and
32 MiB total). The verifier reads both actual bounded
`MILKUP_PROTOCOL_INHERITANCE` JSON controls, including the fixed libtest first-line
prefix: unconfined stdout/stderr error 995 versus confined EOF on both streams,
with the separate holder alive at each pipe result and both owned Jobs empty and
held processes signaled afterward. The log must finish successfully after the
two controls. `historicalHolderIdentified` must remain false. This establishes
only the generic-child mechanism, not the historical holder or actual product
acceptance. The exact new candidate's frozen harness separately requires
`helperProtocolHandlesNonInheritable=true` after verified Ready, while retaining
the earlier pre-Ready-null contract. Old failed-run archives and their frozen
verifiers are not modified or reinterpreted by this live verifier update.

The old beta.8 verifier and delivered package remain separate and unchanged.

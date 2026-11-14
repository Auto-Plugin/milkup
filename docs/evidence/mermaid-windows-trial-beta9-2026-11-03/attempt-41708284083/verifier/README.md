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
  --candidate 0811b899ea4c4f98294046f66524d4503307d279 \
  --version 2.0.0-beta.9 --run 41708284083 --attempt 1 \
  --repo /workspace/milkup-mermaid-rebuild \
  --harness /workspace/mermaid-rebuild-evidence/windows-installed-41708284083/candidate-mermaid-product-e2e.mjs \
  --harness-provenance /workspace/mermaid-rebuild-evidence/windows-installed-41708284083/harness-exact-windows-checkout-provenance.json \
  --sevenzip /workspace/mermaid-rebuild-evidence/tools/official-7zip-linux-q7qsaqkh/7zz \
  --installed-api INSTALLED_API_JSON --installed-zip INSTALLED_ZIP \
  --inspection-api INSPECTION_API_JSON --inspection-zip INSPECTION_ZIP \
  --delivery-api DELIVERY_API_JSON --delivery-zip ROOT_DOWNLOADED_DELIVERY_ZIP \
  --output NEW_RESULT_JSON
```

The 41 archive and 19 package tests are synthetic component checks, not Windows
acceptance. The actual three-artifact invocation is required. The standalone
`cleanup_observations.py --self-test` references a module not included here; it is
not a supported entry point in this directory and the main CLI does not use it.

Compiled EXE and dist modules are not uploaded. Their original Windows full-byte
transform and AST inspection reports are bound to the exact package, but are not
independently recomputed locally. Static inspection independently verifies the
delivered NSIS application bytes and complete fixed engine/bootstrap sources.
No new Windows execution, upgrade/rollback, full IME/DPI matrix, or human visual
acceptance is inferred. The historical IPC error 995 remains unexplained.

The old beta.8 verifier and delivered package remain separate and unchanged.

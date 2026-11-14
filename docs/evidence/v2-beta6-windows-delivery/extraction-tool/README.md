# beta.6 Windows embedded frontend verification

This tool directory is separate from the product repository. It adapts the reviewed
beta.5 extractor for candidate `6b3eeebad7ec433c6420bf5bbfadcf6a6710d20f`, version
`2.0.0-beta.6`, and baseline `7cc4edc6747abf5fbc31b60cccf4bd73174af6f8`.
It neither downloads artifacts nor executes Windows programs.

The parent must first verify the downloaded ZIP, exact checksums, plugin archives,
and manifest and produce a passed `download-verification.json`. The extractor
requires the same field structure as `/tmp/milkup-beta5-evidence/download-verification.json`,
including `formattingReview`. The original Formatting archive and entry hash
allowlists remain unchanged; a new archive hash requires an independent review,
not automatic acceptance by this tool.

Run after those checks, substituting the actual paths and exact run ID:

```sh
python3 /tmp/milkup-beta6-ui-evidence-tools/extract-embedded.py \
  /path/to/deliverable/manifest.json \
  /path/to/new-embedded-output-directory \
  --verification /path/to/download-verification.json \
  --expected-commit 6b3eeebad7ec433c6420bf5bbfadcf6a6710d20f \
  --expected-run ACTUAL_RUN_ID
```

The output directory must not exist. Only after every check passes does the script
write the extracted application, embedded frontend, and `embedded-frontend-proof.json`.
The application is written as evidence and never launched.

Retained checks include exact source/run/manifest identity, installer and application
size/hash, the unique three-byte NSIS NSS-to-UNK reversal, all NSIS/PE/Brotli bounds,
and the entry script resolved from embedded `index.html`. All seven old stable UI
markers remain required. Added required markers are `data-editor-context-menu`,
`hostContextCommand`, and `floating-document-toolbar`, plus the updated version.
Beta.5, beta.4, and beta.3 version markers must be absent from the entry module.
Marker presence proves embedded bytes, not functioning UI or Windows acceptance.

`extract-embedded.beta5.py.txt` preserves the original bytes; `adaptation.diff.txt`
records the narrow change. Reproduce the syntax/AST preservation check with:

```sh
python3 /tmp/milkup-beta6-ui-evidence-tools/validate-adaptation.py
```

`static-validation.json` records that check. It does not verify any beta.6 artifact.
No extraction primitives, resource bounds, Formatting pins, or original image checks
were removed or relaxed. The script retains its existing Linux/system Brotli-library
requirement; no dependency installation is performed.

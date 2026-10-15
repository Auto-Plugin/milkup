# Public SDK 0.3.3 external compatibility and P5 boundary audit

All ten plugins were installed, type-checked, built, and tested outside the Milkup checkout using the frozen public SDK tarball. The old seven were rebuilt by this task; the three new plugin owners reran their own external proofs against the same final archive. No product source, dist, Windows workflow, upload, release, or deployment was changed by this verification task.

SDK SHA256: `b9a163f32556a77c4ae0f5c5a8cbd8a3eaf1e102e9d3e83f9e76e539a3d89e9f` (18,703 bytes). Full source/resource/archive hashes are in `verification.json`; scripts are retained here for reproduction.

| Plugin             | Tests | Typecheck/build | Source and resources |
| ------------------ | ----: | --------------- | -------------------- |
| milkup.diagrams    |    55 | passed          | exact match          |
| milkup.footnotes   |    14 | passed          | exact match          |
| milkup.formatting  |    44 | passed          | exact match          |
| milkup.images      |    49 | passed          | exact match          |
| milkup.math        |    56 | passed          | exact match          |
| milkup.outline     |    24 | passed          | exact match          |
| milkup.preferences |    28 | passed          | exact match          |
| milkup.shortcuts   |     8 | passed          | exact match          |
| milkup.updates     |    17 | passed          | exact match          |
| milkup.workspace   |    24 | passed          | exact match          |

Total: **319 passing tests** across ten external builds. Installed SDK files match the frozen tarball, each plugin's sole Milkup dependency is the public SDK, no private `@milkup/*` imports occur in copied source/build inputs, archive manifests match current source, and every declared resource is present with identical bytes. Existing seven engine ranges and permissions were preserved. Archive hashes can differ from in-repo bundled builds because esbuild includes module-location comments; do not equate byte differences with business-code changes without member-level comparison.

## Aggregate failure behavior

`copyDocumentPresentationAggregate` validates all fragments in one pass with one combined 4096-node / 256-KiB output budget, the 128-fragment limit, sorting/non-overlap rules, and host-owned declarations. Individual provider validation does not bypass the combined limit. The audit test constructs two individually valid 2200-leaf provider outputs; the desktop service rejects their aggregate with `invalid-output`, and the source/version remain unchanged.

Source inspection of `DocumentPresentationController.sync` confirms that a new job restores the previous original DOM before awaiting the provider; failed aggregate validation reaches the catch path, sets the fallback status, and does not cache the invalid response. This audit verifies the service rejection with an executable test; it does not claim a new browser run for the controller fallback. The view owner's independent browser/view evidence covers UI behavior.

## P5 limitations (not implemented export features)

- The serializer escapes text and accepts only the validated inert tree. It emits no plugin-provided HTML/XML/CSS/script, event handler or arbitrary URL.
- References currently serialize to an inert `span` containing `data-source-from` / `data-source-to` and the escaped label. There is no exported clickable definition/back-reference graph. Document identity/version are checked when the optional request is supplied to validation but are not encoded in this HTML fragment. P5 must require an exact document snapshot and map source locations to stable export anchors before producing navigation links.
- Vector theme tokens currently serialize as `currentColor`. This preserves safe markup but does not preserve foreground/background/accent contrast. P5 needs a trusted export palette mapping and accessibility validation; the existing function is not proof of visually faithful SVG export.
- Accessible text belongs to the surrounding presentation fragment, not `serializeDocumentPresentationNode` alone. P5 must serialize that description and treat error/incomplete fragments as source fallback.
- P5 must batch a version-bound document into bounded requests and handle global plugin indexes explicitly; the P4 screen service is not a complete document exporter. No DOM scraping or plugin script execution in exported files is needed or authorized.

Three focused executable audit tests passed; see `presentation-boundaries.log` and `presentation-boundaries.test.ts`.

## Final footnotes review replacement

The final matrix uses `footnotes/external-format-final`, including the regression that providers must not omit fragments merely because the initial selection intersects them. Footnotes now has 14 passing tests. Archive SHA256: `eedf438cb39518795e29c118acb6da837badcde890be0e41a8db4d1cee4def15`; Worker SHA256: `d82f881f3c432f1e63e1a4492f9ca48b906ff9981be40984a2996403a39b0c36`. The ten-plugin current-source/resource audit passed again after this replacement; SDK tarball hash is unchanged.

Host cache recommendation: the frozen public SDK permits providers to inspect selection and does not require selection-independent output. Official providers return all eligible source fragments and let the view hide edited ranges, but generic third-party correctness still requires selection in cache/job identity and late-result validation. See `../contract.md` for the integration clarification. No SDK tarball was rebuilt for this explanation.

Final formatting verification: footnotes/plugin.json was formatted without changing its parsed manifest. The fresh `external-format-final` build passed all 14 footnotes tests and matches current source bytes; archive and Worker hashes remain unchanged. `audit-ten.py` was actually rerun successfully for all ten plugins; see `final-format-audit.log`. The previous `root-final-audit.log` failure remains preserved as historical evidence. Total remains 319 tests; no product, SDK tarball, or dist file was changed by this audit update.

Math CRLF correction: current matrix now uses `math/external-crlf-final` (56 tests); archive 547925 bytes SHA256 `93c62f43c20c1efd3c20e6038d2c50cf5bc2082fe571c531d5f17a742940c226`. The complete ten-plugin current-source audit passed again (`final-crlf-audit.log`); previous matrix retained as `verification-candidate01.json`. SDK unchanged; total remains 319 tests.

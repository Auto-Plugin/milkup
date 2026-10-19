# Browser fixture sealed-package transport migration

After the registry-root schema repair, the actual browser formatting fixture still failed. `diagnostic.json` records a failed/disabled formatting record and denied enable audit with `Plugin Worker entry must belong to its sealed package`. The diagnostic used a separate installed Chromium context, reused the existing Vite server, and closed its own browser. The old first diagnostic launch had a Node package-resolution error; that harness failure is retained separately.

The fixture encoded its executable directly into `manifest.main = data:text/javascript,...`. Current browser prepareModule deliberately rejects external/absolute Worker entries and reads a relative entry from a sealed archive. `baseline-proof.json` compares the entire prepareModule section with baseline fa530b399a5ebbd020f9bfa7ca039378604c8282: byte-identical. This proves the rejection predicate already existed on the baseline; no complete baseline browser build was launched. The initial registry schema failure had hidden this second obsolete-fixture layer.

`tests/helpers/sealed-plugin-fixture.ts` now uses the real createPluginPackageArchive validator to construct a test-owned archive with a relative dist/plugin.js and the manifest's actual declared resource bytes. A Playwright route supplies only the browser package-catalog data module. Actual main.prepareModule, archive parsing, closed-bundle validation, Worker startup, runtime, permissions, approvals and UI remain in use. Approval and enabled-state seeds are unchanged. This is test data transport, not a native installation or native filesystem acceptance claim.

Affected fixtures: formatting, markdown extensions, workspace, updates, shortcuts (including shadow plugins and restart), shell Worker/outline, and plugin cards' actual approve/enable case. The shared native outline fixture file is unchanged; browser consumers normalize its serialized test seed. The official DOM Mermaid unavailable-in-browser case remains explicit and unchanged in scope.

No product source or permission restriction was relaxed. SourceDocumentView remains frozen at the independently recorded hash.

Validation so far:
- `formatting-green01.log` / `.exit`: server startup failed, exit 1, no tests executed. The brief overlap with workspace03 is accurately recorded in `startup-overlap.json`; this is not a green result despite the attempt filename.
- `formatting-green02.log` / `.exit`: actual 21 formatting tests passed, exit 0.
- `helper-typecheck.log` / `.exit`: helper and its imported types checked, exit 0.
- Formatting logs preserve the modified fixture formatting checks.
- Focused transport/restart tests and complete browser suite results will be appended after execution.

Full earlier failure evidence remains in milestone01/validation/browser-e2e-02*; no baseline logs or failures were overwritten.

## Further observed fixture-contract migrations

Focused01 completed with 7 passes and two failures, both retained with original artifacts. The official DOM unavailable test received the earlier P6 native-catalog-generation rejection; its exact expected message was updated while preserving zero module requests, no rendered diagram and original source assertions. The outline snapshot contained the correct two headings as accessible treeitems under the P7 controlled tree behavior; heading locators now use treeitem while retaining click, caret focus and rename checks. No navigation expectation or timeout was weakened.

An additional inventory found the standalone preferences/images browser scripts also emitted old data URLs and omitted storage/data roots. Browser E2E consumers now use the centralized test installer with the same enable/approval/session-marker semantics and real standalone build. Shared plugin scripts and native consumers are unchanged. Declared resources remain in the archive.

Focused02 completed with 11 passes, exit 0, covering real math/footnotes, native DOM rejection, cards approval/enable/disable, preferences preview, image chooser failure/retry, outline rename/navigation, shortcuts restart/shadow, updates and workspace. `fixture-proof.json` records fixture hashes and the unchanged SourceDocumentView hash. The full 197-test suite is running separately under milestone01/validation/browser-e2e-03*.

## Full browser run 03

The actual full run completed: **196 passes, 1 failure, exit 1** (7.6 minutes). The original log and artifact directory are `../../validation/browser-e2e-03.log` and `../../validation/browser-e2e-03-artifacts`. The one failure is the old phase16 F6 test expecting menu Escape to focus the editor, whereas the authorized P7 behavior restores the actual menu invoker. The followup asserts that invoker, then uses F6 to reach the editor while retaining the unchanged text, label and table-navigation checks. This is a test-contract correction, not a product edit. A related three-case menu/focus rerun is being recorded separately; no single-run 197-pass result is claimed.

Final menu followup completed: **3 passes, exit 0** (15.6 seconds), including the former F6 failure, modal focus containment, and the small-viewport confirmation case. See `../../validation/browser-e2e-03-menu-followup.log` and its separate artifacts. The final shell test checks menu-invoker focus after Escape, then F6 reaches the editor, preserving exact document text and accessible editor attributes. Format checks and helper typecheck passed.

All owned browser/runner processes ended; ports 1420 and 5174 had no listeners on release. Root was explicitly notified before native work resumed. Product source remained frozen. The final hashes and exact validation chronology are in `fixture-proof.json`. No real operating-system IME or native platform result is inferred from these browser tests.

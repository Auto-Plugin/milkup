# Windows-first release plan

> Active plan as of 2026-07-07. This document supersedes `docs/coding-plan.md` as the day-to-day completion gate for the v2 Windows release.

## 0. Plan reset

The original long-form plan is now frozen as historical evidence:

- Active historical baseline: `docs/coding-plan.md`
- Frozen copy: `docs/archive/coding-plan-frozen-2026-07-07.md`
- Completion audit baseline: `docs/completion-audit-2026-07-06.md`

Do not continue treating macOS/Linux manual verification as a blocker for the first Windows release. Keep the old plan and audit intact so their evidence remains traceable, but use this file for current release decisions.

## 1. Current target

Ship a Windows-usable v2 build first.

The Windows release is considered 100% complete when:

- The app can be built as a distributable Windows desktop artifact.
- Product identity, version metadata, icons, and installer settings are intentional rather than placeholders.
- Windows core editing, file workflow, shortcuts, IME, watcher/conflict, paste/assets, export, plugin isolation, CLI/MCP, and large-file claims all have current passing evidence.
- A Windows release smoke run has been executed against the distributable artifact, not only the debug binary.
- Known limitations are documented honestly, especially the 1 GiB large-file wording.
- macOS/Linux code paths are kept buildable where practical, but manual validation is not required for the Windows release gate.

## 2. Scope decision

### In scope for Windows 100%

- Windows x64 desktop build.
- Native open/save/save-as/reload/reveal behavior.
- Dirty-state, close protection, external modification, external delete, and conflict handling.
- Ctrl shortcuts and action registry routing.
- Windows Chinese IME behavior.
- Source/live/preview mode switching.
- Paste pipeline, local image assets, and Markdown preservation.
- Export pipeline baseline.
- Plugin runtime sandbox, filesystem/network brokers, worker isolation, and sidecar host path.
- CLI/MCP action access where already implemented.
- Documented 1 GiB native working-temp behavior with careful wording.
- Installer or portable bundle readiness.

### Deferred from the Windows release gate

- macOS Chinese IME manual evidence.
- Linux IME manual evidence.
- macOS Cmd shortcut manual evidence.
- macOS file watcher manual evidence.
- macOS/Linux packaging polish beyond blind development/build hygiene.

These deferred items remain important, but they belong to a later cross-platform release gate.

## 3. Evidence already accepted

The following are accepted as already closed for Windows unless a later code change invalidates them:

- M0-M12 implementation milestones are complete in `docs/coding-plan.md`.
- Windows native file dialogs and OS Save As are closed by `docs/manual-verification-windows-os-dialog-user-2026-07-07.md`.
- Windows watcher and same-file external conflict are closed by `docs/manual-verification-windows-native-watcher-conflict-2026-07-07.md`.
- Windows Ctrl shortcuts are closed by `docs/manual-verification-windows-ctrl-shortcuts-native-2026-07-07.md`.
- Windows Chinese IME is closed by `docs/manual-verification-windows-ime-computer-use-2026-07-07.md`.
- Native desktop smoke has covered deterministic open/save/save-as, watcher/conflict, plugins, sidecar, Ctrl shortcuts, and synthetic composition paths.
- Large-file behavior has current desktop and native working-temp reports in `docs/desktop-editor-interaction-benchmark-175kb-10mib-2026-07-09.json`, `docs/desktop-editor-interaction-benchmark-100mib-2026-07-09.json`, `docs/native-large-file-benchmark-working-temp-256mib-2026-07-09.json`, and `docs/native-large-file-benchmark-working-temp-1gib-2026-07-09.json`. The retained reports are summarized in `docs/large-file-editor-phase9-evidence-2026-07-08.md`.

Large-file wording constraint: public material may claim measured current native working-temp command-path behavior through 1 GiB on the documented Windows machine, but must include the measured latency caveats and must not imply perfect rich live rendering, full-document AST/plugin transforms, or unlimited large-file edit operations.

## 4. Remaining Windows release work

### W0 - Plan handoff

- [x] Freeze the previous plan as `docs/archive/coding-plan-frozen-2026-07-07.md`.
- [x] Create this Windows-first active plan.
- [ ] Add a short pointer from future work notes to this file instead of extending the old plan.

### W1 - Product identity and metadata

- [ ] Choose the first Windows v2 release version.
- [ ] Update root and app package versions from `0.0.0`.
- [ ] Update `apps/desktop/src-tauri/tauri.conf.json` version to match.
- [ ] Confirm final Windows app identifier.
- [ ] Confirm product name casing.
- [ ] Confirm Windows icon resources are final enough for release.
- [ ] Confirm About/version UI reads from release metadata or is intentionally static for v2 preview.

### W2 - Windows distributable build

- [ ] Enable Tauri bundling for Windows.
- [ ] Choose first artifact type: installer, portable executable, or both.
- [ ] Decide whether the first Windows build is signed or explicitly unsigned.
- [ ] Build the Windows distributable artifact from a clean checkout.
- [ ] Record artifact path, size, hash, and build command in a dated release-readiness report.
- [ ] Confirm install/uninstall or portable launch behavior.

### W3 - Release-artifact smoke

- [ ] Run the app from the distributable artifact, not only `target/.../debug`.
- [ ] Open an existing Markdown file.
- [ ] Save edits.
- [ ] Save As to a new path.
- [ ] Create a new unsaved document and verify close protection.
- [ ] Trigger external clean modification and reload.
- [ ] Trigger dirty external conflict and confirm silent overwrite is blocked.
- [ ] Exercise Ctrl shortcuts for file actions, mode switching, undo/redo, selection, copy/paste/cut.
- [ ] Exercise Windows Chinese IME in source and live modes.
- [ ] Paste a local image and confirm asset write/path behavior.
- [ ] Export a representative Markdown document.
- [ ] Record results in a dated Windows release smoke report.

### W4 - Automated verification refresh

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:e2e`
- [ ] `pnpm --filter @milkup/desktop build`
- [ ] `pnpm --filter @milkup/desktop test`
- [ ] `pnpm --filter @milkup/desktop typecheck`
- [ ] `pnpm test:native:desktop`
- [ ] Windows Tauri release or debug bundle build command, depending on chosen artifact path.
- [ ] `pnpm lint`

If one command is skipped, record why and what narrower evidence replaces it.

### W5 - User-facing readiness

- [ ] Add or restore a v2 README or release note for Windows users.
- [ ] Document system requirements.
- [ ] Document supported Windows artifact type and install/launch steps.
- [ ] Document known limitations and non-goals for this first Windows release.
- [ ] Document large-file wording accurately.
- [ ] Document how users should report bugs and include logs/reproduction files.

### W6 - Windows quality pass

- [ ] Review first-run empty state.
- [ ] Review unsaved-change dialog copy.
- [ ] Review file conflict dialog copy.
- [ ] Review export failure and success feedback.
- [ ] Review plugin failure isolation feedback.
- [ ] Review large-file degradation messaging.
- [ ] Review keyboard focus after dialogs.
- [ ] Review high-DPI behavior on Windows.
- [ ] Review dark/light theme baseline, if theme UI is present in the current v2 shell.

### W7 - Cross-platform blind development parking lot

These items may be developed before Windows release if cheap, but they do not block Windows 100%:

- [ ] Keep macOS/Linux source paths compiling when touched.
- [ ] Keep platform abstractions explicit in file watcher, shortcut, IME, and dialog code.
- [ ] Keep `pnpm manual:cross-platform -- --platform macos` and `--platform linux` report generation usable.
- [ ] Do not apply macOS/Linux manual pass checkboxes without real platform evidence.
- [ ] Create a later `cross-platform-release-plan.md` when Windows is shipped or frozen.

## 5. Definition of Windows 100%

Windows v2 is complete when W1-W6 are checked and the release-readiness report says:

- Artifact built successfully.
- Artifact smoke passed.
- Automated verification passed or has documented, accepted exceptions.
- Existing Windows manual evidence is still valid after the latest relevant code changes.
- User-facing release notes exist.
- No known Windows blocker remains open.

At that point, macOS/Linux manual verification must not block declaring the Windows version complete.

## 6. Next recommended task

Start with W1 and W2:

1. Decide the first Windows v2 version.
2. Enable Windows bundling in Tauri config.
3. Produce a distributable artifact.
4. Run W3 smoke against that artifact.
5. Write `docs/windows-release-readiness-YYYY-MM-DD.md`.

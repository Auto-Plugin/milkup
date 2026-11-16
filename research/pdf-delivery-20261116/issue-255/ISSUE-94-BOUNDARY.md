# #94 language-switch data retention: not executed

Closed historical issue https://github.com/Auto-Plugin/milkup/issues/94 is a
regression lead, not evidence that the present v2 has the defect.

Read-only review of the exact retained source
`58c78973101acb0a22ca0cb5d24ef24bd9edc199` and current checkout found no application
UI-language switch. `apps/desktop/src/settings-service.ts` exposes six editor
settings and appearance theme/zoom only; `plugins/preferences/src/controller.ts`
and `plugin.ts` consume that settings model, and the desktop main entry has no
locale/language switching action. Code-fence languages and locale-formatted dates
are unrelated. No corresponding native installed result was found in the reviewed
records. This is a source capability finding, not a native menu observation.

The next existing installed daily-use runner now persists a separate `issue94`
row beside #255 with `status=not-executed`, `nativePassed=false`, exact package
identity inherited from the report, and `currentCandidateNeedsUiVerification`.
A #255 pass cannot turn this row into a pass. On a candidate with a real supported
language action, the required sequence is: create a synthetic file with unique
unsaved text; request actual UI-language change; cancel any save/restart prompt
and verify editor text, dirty state and original disk bytes; save all text, perform
the real switch and any supported normal restart, then reopen and byte-check the
whole file and document identity. No storage/DOM mutation is an acceptable proxy.
No new i18n feature, separate build, dispatch, production setting or safety change
was introduced. Native execution remains unavailable in this local environment;
no DISPLAY, installed Milkup, tauri-driver, WebKitWebDriver or xdotool is present.

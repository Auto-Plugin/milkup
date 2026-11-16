# #255 delayed bracket caret: native ride-along, not a native pass

Reviewed preserved installed reports 43686757658 (external-file conflict) and
43687852420 (checkpoint recovery), both source
`58c78973101acb0a22ca0cb5d24ef24bd9edc199`, with all original step names and report
SHA-256 recorded in `evidence-review.json`. Neither executes this bracket case.
The associated preserved deb is
`milkup-2.0.0-beta.10-linux-deb-58c78973101a.deb`, 9,854,742 bytes,
SHA-256 `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`;
installed binary SHA-256
`42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`.
These identities are evidence context, not a newly executed test.

The legacy `tauri-block-keyboard.mjs` tests `()tail`, `abc123`, 2.5 seconds and `X`.
It is insufficient for the requested exact case; no qualifying installed report
was found in the reviewed records. The source browser test is also not a native
installed acceptance result.

The new shared orchestration and installed adapter create only a synthetic file:
24 preceding paragraphs, `前文 () 后缀 <unique>-LINE-END`, 24 following paragraphs,
and an independent document-end marker. Native X11 keys place the caret and type
`Ab12`; a monotonic clock measures at least 3.2 seconds with no new input. DOM
observations record the insertion offset, editable mode, editor focus and scroll;
X11 independently records native focus. `Z` is typed without refocusing or moving
selection. The entire saved file is byte-compared; the exact owned process is
normally closed and a fresh process reopens the same file, checks the bracket and
end marker, and normally closes. Each process is bound to PID/start time, window
ownership, binary and package identity. Original failures and partial samples
remain in the report. Cleanup/discard of this synthetic failed test is explicitly
separate and cannot produce a native pass.

`run-linux-installed-gui.sh` actually invokes the adapter in its existing normal
installed-product path, bounded to 180 seconds, before its existing GUI/PDF run.
The original PDF fixture is untouched. This adds no workflow trigger, build,
installation or dispatch. A research runtime explicitly skips this daily-use gate;
that skip must not be interpreted as passing #255. The final-path candidate runner
must carry the same gate and supply its exact manifest and extracted-app identity.

Local validation: seven Node orchestration/integration contracts pass, including
late caret movement after 3 seconds, focus loss, scroll jump, wrong saved bytes and
wrong reopened document. JavaScript and shell syntax pass. These use a controlled
adapter and are **not DOM/browser/native acceptance**. Native input is through the
existing production adapter's ASCII `xdotool` path, not injected text or private
editor dispatch; no TSF/IME is needed.

Native execution is currently blocked locally: no DISPLAY, tauri-driver,
WebKitWebDriver, Xvfb/xvfb-run or xdotool; no installed Milkup binary; free space
about 200 KiB. xwininfo, dbus-run-session and Node are available. No dependencies,
security settings or user configurations were changed to work around this. No CI
was dispatched and the active WebCore build was neither polled nor altered.
Autosave enabled/disabled comparison remains untested; the adapter reports the
existing fresh isolated-profile setting without pretending to control both modes.

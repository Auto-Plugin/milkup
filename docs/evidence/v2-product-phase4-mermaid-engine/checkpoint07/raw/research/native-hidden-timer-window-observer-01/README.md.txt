# Owned X11 snapshot observer — static draft

`observe.py` is an external diagnostic only. It has not been executed, syntax-checked, or accepted on X11 yet. No repository/product files were changed. Review and a separately authorized smoke run must precede use as evidence.

It directly calls read-only Xlib through Python ctypes: open/close display, query tree/attributes/properties/focus, intern **existing** atoms, and synchronize. It does not create/map/unmap windows, select input, set focus, send input, signal processes, call page/plugin IPC, or read window titles. It creates a new JSON output file exclusively; existing evidence is never overwritten.

## Handshake

Transport supplies authoritative same-namespace process identities obtained from the native instance's owned-process snapshot. No PID discovery or descendant expansion is performed by this observer. Roles are descriptive only.

```json
{
  "display": ":126",
  "bootId": "actual /proc/sys/kernel/random/boot_id",
  "pidNamespace": "actual /proc/self/ns/pid link",
  "owners": [
    { "role": "guardian", "pid": 12345, "birth": 99999 },
    { "role": "helper", "pid": 12346, "birth": 100001 }
  ]
}
```

The numbers above are illustrative, never defaults. `birth` is `/proc/PID/stat` field22, numeric start ticks. `{ "startTicks": number, "bootId": string }` is also accepted. Optional `argv` requires an exact argument-array match. A baseline uses `owners: []`; boot/PID namespace fields are optional, but if provided must match. The observer checks each supplied owner before and after X11 sampling. Transport separately verifies the precise Xvfb identity; this script accepts only explicit `display: ":126"`.

```sh
python3 /workspace/milkup-mermaid-engine-evidence/research/native-hidden-timer-window-observer-01/observe.py --identity-file identities.json --output baseline.json
python3 /workspace/milkup-mermaid-engine-evidence/research/native-hidden-timer-window-observer-01/observe.py --identity-file owned-identities.json --baseline baseline.json --output before-render.json
```

Do not run these example commands before the parent grants the runtime slot. Suggested observation times are activation baseline, after activation before first render, after result before cleanup, and after cleanup with empty owners. **Do not sample inside the2s execution window.** There is no polling loop.

## Frozen result contract

Schema: `milkup.owned-x11-observation.v1`.

- `ok`: observation completed without bounds, X11 or identity errors; not an assertion that the observed state is safe.
- `errors`: structured errors. A disappearing window/BadWindow is retained as inconclusive, not swallowed into PASS.
- `identity.allMatched`, `identity.owners`, `identity.after`: supplied identities and actual birth verification.
- `focus.windowId`: actual XGetInputFocus ID (including special PointerRoot ID1); `focus.activeWindowId`: optional EWMH active client, null if unavailable.
- `windows`: IDs, parent IDs, `_NET_WM_PID`, map state, InputOutput class, override redirect, owned attribution, and `toplevelKind` only. No title.
- `assessment.ownedVisibleToplevelsAbsent`, `ownedVisibleToplevelIds`, `unknownVisibleToplevelIds`.
- `comparison`: null without baseline. Otherwise `sameDisplay`, `focusUnchanged`, `activeWindowUnchanged`, `newVisibleToplevelIds`, `newUnknownVisibleToplevelIds`, `noNewVisibleToplevels`.
- `durationMs`, `monotonic`, `wall`: measured observation overhead/time; do not subtract from task results.

With a baseline, the harness must require all of:

```text
ok
identity.allMatched
assessment.ownedVisibleToplevelsAbsent
comparison.sameDisplay
comparison.focusUnchanged
comparison.activeWindowUnchanged
comparison.noNewVisibleToplevels
```

The last condition is intentionally strict: any newly visible top-level, including one with unknown PID, prevents setup acceptance. For baseline creation require `ok`, matching identities and no owned visible top-level; no comparison exists yet. Exit0 means `ok`, not the conjunction of the safety checks. Exit2 indicates inconclusive/error; the JSON preserves its cause.

## Top-level classification and limits

Visible means X11 `IsViewable`, not GTK's logical `mapped` flag alone. A normal client is identified by `_NET_CLIENT_LIST` or `WM_STATE`; an InputOutput root child is also recorded as a potential top-level, including override-redirect popups. This handles WM frames without pretending arbitrary nested GDK windows are OS top-levels. The tree records internal children but does not count them as top-level merely because they carry the same PID. Real GTK offscreen windows use `GDK_WINDOW_OFFSCREEN`; the static WebKit/GTK evidence is in `../hidden-page-static-review/review.md`.

Attribution uses X11 PID properties plus supplied before/after process birth matches. PID properties are hints, not a security boundary. Missing PID is explicit unknown. Baseline comparison also catches new visible root frames whose client PID might be unavailable. Existing unknown baseline windows are not assigned to the helper.

The traversal is capped at256 windows and a2s **soft** collection bound between X11 requests. This is not a timeout for a stuck X server, and does not change the renderer's watchdog. A cap hit or query error is inconclusive. The local private display and Xvfb ownership must already be established by transport.

Discrete before/after snapshots cannot prove absence of a transient window or focus change between observations. Do not claim continuous monitoring. Combine the snapshots with the static offscreen window implementation and later normal native UI verification; no runtime focus hook or background sampler is included.

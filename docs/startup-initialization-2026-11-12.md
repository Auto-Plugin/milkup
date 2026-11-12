# Windows startup initialization evidence, 2026-11-12

This is a diagnostic result, not a startup performance fix or a release acceptance.

## Exact candidate and evidence

- Application and harness: `0c14340fc2ce344ec3b347a874b4adb5a3cc0d42`.
- Windows run: https://github.com/Auto-Plugin/milkup/actions/runs/43189737359.
- Product artifact: `13930557578`, 1,134,051 bytes, ZIP SHA-256
  `9c0a045c04b2bab11fe63f58b661cb0995b079d1ebfeef0a3852221d8b92c166`.
- Both account product reports have 11/11 passing steps and passing outer audits.
  The original reports were decoded and their strict PID + creation FILETIME
  launch ledgers replayed, including successful exit and stdio EOF.
- The run completed successfully at 09:44 UTC. Full account artifact:
  `13931737426`, 2,367,082 bytes, ZIP SHA-256
  `30c3d6141caf4edd7f0a66357e58568d50902afff636e3e4cdc15ea7cc1fcfa1`.
  The original compressed window/log evidence was decoded and the strict GUI
  verifier replayed. Both accounts passed 8/8 steps, including 12-diagram
  compact/scroll/revisit scenarios and idle/busy real UI close. Idle/busy had
  respectively 0/1 pending request at close; all four closes exited with code 0,
  drained stdio, proved inner cleanup, and did not require forced termination.
  Pure-standard resolved 105/105 SHOW records and filtered-admin 104/104. Both
  window audits were complete, with positive controls passed, no overflow, and
  zero observed visible console windows.
- The application installed in the separate six-launch attachment comparison
  remains `b877746f5dfd236dfc13f718ed23d837b8e4f89d`; this run used a linked
  diagnostic executable, not a new installer.

## What was measured

The opt-in Wry constructor collects closed-enum, monotonic microsecond marks in
memory. It emits one bounded record on constructor return. The environment and
controller callbacks do not write logs. No browser options, permissions,
durability operations, or message-pump behavior were changed.

For the first pure-standard ordinary-document launch, first PNG decode was
13,780.6 ms after process spawn. The application-built to user setup interval was
9,834 ms, and decomposes as follows:

| Interval | Milliseconds |
| --- | ---: |
| Application built to Wry constructor entry | 15 |
| COM initialization | 0.033 |
| Native container creation | 0.490 |
| Environment preparation + creation | 5,928.994 |
| Controller preparation + creation | 2,923.356 |
| `init_webview` | 960.223 |
| Entire Wry constructor | 9,816.714 |
| Constructor end to user setup | approximately 2.3 |

`init_webview` includes theme/settings, event handlers, initialization scripts,
navigation, focus, and optional extension loading. Its duration is **not** a
measurement of settings calls alone. Cross-boundary Unix timestamps have
millisecond precision; internal Wry intervals use a monotonic clock.

The environment API call itself took 5,928.832 ms. Its completion callback
arrived 0.129 ms **before** the API returned. Callback-to-wait-return was 0.199
ms. Thus a multi-second wait after that callback does not explain this sample.
The controller API returned after 106.029 ms, the callback arrived 2,568.527 ms
later, and wait-return followed the callback after 244.134 ms. That last interval
is real, but does not account for the environment call or most of the controller
stage.

The environment call finished about 5,955 ms after application-run-enter.
WebDriver attachment began about 6,960 ms after spawn. The slow environment
call preceded attachment; this does not isolate the effects of concurrent
read-only readiness polling or host load.

The other nine environment calls took 3.265–7.351 ms. First ordinary-document
decode under filtered-admin took 3,660.9 ms, with a 1,205.303 ms constructor.
These sequential samples confound account, execution order, and warmed runtime
state, so they are not an account-permission or cold-cache experiment.

The later GUI idle/busy constructors took 764.094/747.122 ms under pure-standard
and 782.614/922.053 ms under filtered-admin. Their environment API calls took
3.846–5.593 ms. Their controller callback-to-wait-return intervals were
0.055–0.112 ms. These four later launches did not reproduce the first product
launch's long environment call; they do not establish that it was fixed.

For the first ordinary diagram, the actual frontend render started-to-finished
audit interval was 370 ms in pure-standard and 347 ms in filtered-admin. Those
intervals do not include engine loading, initialization, or PNG presentation.
The product trace also retains an initial pure-standard WebDriver `/status`
connection failure while the driver was starting; later product acceptance
completed. It is not a renderer failure.

## Interpretation and next boundary

The measured long interval is mostly inside WebView construction before the
frontend starts. The trace identifies the public API boundary but cannot name
the internal Windows/runtime operation. It does not prove antivirus, disk,
proxy, registry discovery, renderer startup, or another system cause.

The pinned `webview2-com` pump checks its channel then dispatches Windows
messages. This sample rejects a multi-second post-environment-callback stall;
it does not justify replacing the pump. Likewise, moving initialization earlier
would only move the measured cost unless a controlled comparison proves reduced
time to useful content.

Microsoft documents environment creation and runtime selection at
https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl.
The supported public environment API is retained. The internal runtime export,
security settings, and required durable catalogue writes were not bypassed.

The next useful comparison must separate first runtime use from fresh profile
creation and attachment, retaining the same executable, account policy, exact
runtime, approved catalogue, normal close, and EOF checks. It should also split
`init_webview` before attempting to batch or reorder any script or handler.
No application optimization has yet been demonstrated by this evidence.

Existing installed multi-file, HTML/PDF, repair-health, and uninstall acceptance
remains recorded against its original package. Linux GUI, real IME, physical
printing, production signing/channel, and automatic rollback remain outside
the completed acceptance. Nothing has been released.

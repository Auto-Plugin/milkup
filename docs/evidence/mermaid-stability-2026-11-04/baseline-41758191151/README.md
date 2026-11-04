# Delivered beta.9 second GUI control — run 41758191151

The run failed. Original ZIP and every staged file were independently checked against the exact downloaded ZIP digest and original file manifest; see independent-analysis.json. This is the delivered beta.9 application under a newer harness, not beta.10 acceptance.

Both ordinary and wide diagrams survived their 75-second idle observations. Fresh plugin state and the persisted enabled state on the second launch were verified through product UI. Idle close and an actual pending-render close both exited naturally with code 0 and closed stdio; internal cleanup passed. This run did not reproduce the user's close hang. Outer account/profile deletion is recorded separately from product cleanup.

The first resize phase failed the Win32 client/CSS viewport relationship check. The harness used the W3C window rectangle API and observed a 740×650 response and 688-pixel presentation container. Only startup and shutdown boundary records captured the main Tauri rectangle, both 1044×769: they do not prove its size never changed between those observations. The failed native measurement was not retained in the old report, so the precise native/embedded-window relationship cannot be reconstructed. Subsequent harness commits retain measurements before validation and operate the exact held process's native main HWND. No DPI tolerance was relaxed.

Console absence cannot pass: the positive control passed, but there are product-linked consoles, unresolved show events, and live-window-cache-budget overflow. Summary counts also include attribution changes that were not retained as events; they are not an exact independently replayable count. Preserve the raw records and treat unknown/overflow as failure. Later observer changes must log each counted state and remove only known destroyed window lifetimes.

The pending-render close was cancelled before a helper process was created. It proves this timing boundary only, not cancellation after WebView rendering has started. The new candidate's full Windows GUI and installer matrices remain required.

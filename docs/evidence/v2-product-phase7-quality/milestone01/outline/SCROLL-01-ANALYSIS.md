# Scroll baseline 01: observer requirement was invalid

The immutable baseline run `p7-outline-baseline-scroll-01` was not a product-scroll failure. It recorded a trusted wheel event (`start=23519.000000000004`) after an initial scrollTop of 251721. Before and after, the mounted range was [8920,9080), revision 147. The actual failure PNG shows that the visible rows moved down to roughly Dense 9020–9040 within this cached range. The old failure record did not collect final scrollTop; no exact final value is inferred from pixels.

Baseline source at fa530 (`desktop-plugin-ui.ts`, `scheduleVirtualViewportUpdate`) deliberately returns without requesting a new viewport while neither range margin needs refresh. New revision is therefore not required for a valid cached-range scroll. The original harness demanded both changed scrollTop and a changed revision, so its completion predicate could remain false after valid scrolling. The run remains failed/incomplete as a measurement; no scroll p95 is reported.

## Candidate harness correction

The user-visible target is unchanged: real wheel input moves the outline and the visible region contains real rendered rows. Each sample uses ten native wheel notches, waits until the trigger has returned, then requires changed scrollTop, the full visible rank interval within the rendered range, and two animation frames. It accepts an unchanged revision while still inside a cached range. Twenty bursts run ten down and ten up, allowing range boundaries to be crossed. The result records trusted wheel event count and delta, prior and final scrollTop/range/revision, viewport interval, and end-of-burst acknowledgement time.

Elapsed time starts at the first trusted wheel and includes the native burst plus its WebDriver acknowledgement; this is a burst completion proxy, not a single-wheel or physical-pixel latency. Failure records now also preserve the final scrollTop/clientHeight/range, avoiding the earlier diagnostic gap. Candidate verification runs first; a same-script baseline scroll-only rerun may follow on its own display slot. Neither has happened yet.

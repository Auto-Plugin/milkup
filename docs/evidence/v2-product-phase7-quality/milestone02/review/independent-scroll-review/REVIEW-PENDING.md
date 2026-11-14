# Independent generic virtual scroll scheduler review — pending final freeze

Reviewer: catalog_adapter. Base commit78e9329004d2ff244585d98dbe0d7cdd98ab9495. Scope is read-only source/test inspection against generic-scroll-scheduler-01/PLAN.md. No tests, formatter, build, UI or native performance run by this reviewer. Implementation is concurrently changing under checkpoint21; this is not final approval or a frozen-source review.

## Reported concrete blocking candidate

Version changes can inherit old-range equality suppression. With version1, wheel600 requests440..770 but renderer returns old0..160 rows. The new independent requested-buffer record correctly retains440..770; mount.virtualViewport also retains it. When version increments and wheel remains600, scheduleVirtualViewportUpdate creates a new context request but the later equality against mount.virtualViewport can return without a version2 render. Actual rows0..160 still do not cover600. The existing new-version test changed positions140→600, so it does not detect same-position old-echo behavior. Reported immediately to checkpoint21/root; same-position echo/in-flight regression cases are being added. Final resolution awaits final implementation and reported GREEN evidence.

## Other reviewed semantics so far

- First pending event schedules a16ms task without resetting it on every event. It rereads the attached list by public id and current position. pending boolean plus actual renderer token provides one in-flight scheduler render and latest-demand drain rather than FIFO backlog.
- Old synchronous echoes retain the independent requested buffer; explicit plugin invalidation remains able to publish real new rows. Tests inspect actual treeitem counts/ranges rather than only RPC completion. ReadVirtualListMetadata itself trusts renderer range metadata as before; no new independent security claim about dishonest metadata is made.
- Timer context replacement clears the old handle synchronously, with no await between clear/delete/new request; no concrete old-timer blocking issue found in this path. Old promise finalization checks request object and token identity before clearing a newer flight.
- Root's independently reported same-document navigation issue is confirmed in the first inspected diff: requested buffer is retained without selectionRevision/followActive invalidation, and removal of user-intent clearing allows programmatic follow scroll to be mistaken for lingering user demand. Added navigation cases are in progress.
- Keyboard Home/End/cross-slice navigation clears scheduler timer/request and bumps renderSequence for in-flight scroll; current code should be reviewed again after navigation fix. External-focus checks remain in rendering; completion alone does not warrant focus restoration.
- Pointer-active callback returns without rendering and pointer release reschedules through existing protection; stale mount callbacks are guarded by mount/request context. Existing pointer tests remain necessary.

No latency or200ms performance conclusion follows from source reasoning or jsdom tests. Final report will pin product/test hashes only after checkpoint21 declares GREEN/frozen and then inspect the resulting delta.

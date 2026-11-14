# Independent final scroll scheduler review

No remaining concrete blocking correctness issue found in the frozen two-file scheduler diff; previously reported epoch and navigation findings resolved. Native performance acceptance remains open.

Base: `78e9329004d2ff244585d98dbe0d7cdd98ab9495`. Read-only source/diff/test/log inspection. No tests, formatter, builds or GUI run by reviewer. Only review deliverables written.

## Frozen inputs

- `apps/desktop/src/desktop-plugin-ui.ts`: `9b716cde1a1f1d8d0a700c4efc04c07e3dab3eac876a99efb088dc2dbfa6bafe`
- `apps/desktop/src/desktop-plugin-ui.test.ts`: `3a4a3e42d4d1b749f8b2603e52300167e05c8d75bae1a9e951c7843b9a0fcee7`

## Resolved findings

- **same-position-new-version** — New document/version/selection/list context resets the old request and public viewport. Deduplication uses only this context-owned requested buffer; the old public-viewport equality was removed. Echo and held-promise same-position regression cases each failed before the fix (epoch-red01) and are included in final GREEN. Source: `desktop-plugin-ui.ts:1044-1064,1125-1133`.
- **same-document-selection-follow-active** — Selection revision participates in request and response guards; followActive metadata resets old demand before retaining any buffer. Reset clears timer/request/edge/user intent and restores the actual slice. Dispatch consumes user intent, so a resulting programmatic scroll is not stale user demand. navigation-red01 preserves two actual failures before GREEN. Source: `desktop-plugin-ui.ts:535-558,806-831,1015-1031,1134`.

## Reviewed behavior

- Sustained wheel events do not restart the 16 ms timer. The callback resolves the current mounted list and latest scrollTop rather than a detached captured element. The fake-clock sustained gesture verifies first dispatch by 32 ms and one request across its 400 ms within-buffer gesture.
- Old echoed rows do not overwrite the independent requested buffer. Explicit plugin invalidation remains independent and can publish the prepared range. Tests assert installed treeitem counts (including 330 actual rows), not just RPC or metadata completion.
- Within one current context, an in-flight token plus pending boolean coalesces multiple demands to the latest range. Finalization checks both request identity and token before touching state. Context replacement synchronously cancels/deletes the timer; no concrete old-timer/new-context blocking path remains in the inspected implementation.
- Document/version/selection changes, disposal and keyboard navigation discard old scheduler intent. Local Home also invalidates an in-flight scroll render sequence. Existing focus restoration requires focus to remain inside the mounted UI or a valid keyboard anchor; completion alone does not reclaim departed focus.
- Pointer-active scheduling remains deferred; pointer release reschedules with current intent. Existing explicit edge gesture and one-time adjustment behavior remains. Edge requests intentionally bypass ordinary buffer deduplication; there is no autonomous unchanged-buffer retry loop.

## Evidence and limits

Inspected `navigation-red01` (2 failed), `epoch-red01` (2 failed), and `green-final01` (54 controller + 5 controlled-tree = 59 passed). Final types02 and format-check01 records exit 0. Final source hashes match the supplied freeze and successful check records. No check was rerun by this reviewer.

- One in-flight scheduler render is a current-context invariant, not global cancellation of physical RPCs. A new epoch may issue a request while an obsolete renderer promise is still pending; stale response guards prevent its UI application. The same-position held-promise regression explicitly exercises this overlap.
- The controller still accepts validated renderer range metadata under its existing contract; this change does not independently prove that an arbitrary renderer populated every claimed row. The new controlled fixture installs actual rows and checks counts.
- 59 unit tests, types and formatting are implementer-produced records inspected by this reviewer, not independently rerun. A 16 ms timeout is not a native frame or completion guarantee. Native measurements must still report actual mounted row coverage, stable frames and request counts. No 200 ms/native performance pass is claimed.

The provisional REVIEW-PENDING.md remains as historical evidence; this final report supersedes its pending verdict.

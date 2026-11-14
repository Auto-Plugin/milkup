# Scroll corner visibility: static design and frozen-record RED

Diagnostic02 retained left=69/top=125, but its preview bottom=260.5 exceeded editor bottom=229 by **31.5 CSS pixels**. The visible image bottom also exceeded it by 23.3984375 pixels. Horizontal preview right=354 was inside width=380. Existing intersection visibility is insufficient to claim a bottom-right screenshot.

The first offline assertion against that immutable record fails (`exit 1`). UI09 is a separate failure: its preview bottom was inside the editor, but its internal offsets reset to zero. Both checks are required.

`design-review.json` records source hashes, arithmetic, exact bounded real-gutter-wheel proposal, unchanged budgets and limitations. No product/test source has been changed for this follow-up; no browser/native execution occurred. Await parent approval before implementation. Windowed 32-combination pixel review remains pending the UI10 run.

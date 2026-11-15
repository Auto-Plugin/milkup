# Bounded table fragmentation mechanism experiment

Product integration stays 0e4e8c58 (8d93519b is evidence only). No caption candidate or application build. Default system WebKitGTK on the already usable Ubuntu 26.04 runner; reuse the existing sandboxed `WebKitPrintOperation` C probe with JavaScript disabled and an ephemeral context. Local host lacks GTK/WebKit pkg-config and Xvfb; do not install or weaken its sandbox to work around that.

Four structures, four controlled contexts (16 small prints):

1. Baseline: heading and entire table in an avoid-break wrapper, matching the current serializer's critical structure.
2. Chain: original heading/thead/tbody semantics, avoid-after heading, avoid-before table, avoid-after thead and avoid-before first data row; no whole-table wrapper.
3. External group: heading remains outside; one first tbody groups actual column-header cells and first data row. Remaining rows are a second tbody in the same table.
4. Internal group: same first tbody also contains the actual heading in a single colspan title cell, before column headers and data. Native heading and explicit column IDs/headers associations retained; this introduces an additional cell/row and is only a mechanism probe, not an approved accessibility design.

The latter two use `scope=col` and explicit data-cell `headers`; they do not retain automatic repeated thead headers. Report that tradeoff, never silently promote them to the product. No cloned heading, row or table, no ARIA role suppression, no absolute positioning or forced page break. Only a small first row group can be unbreakable; the full table must paginate.

Each structure has a 3-row short table and 72-row long table, each with 8 or 45 visible 20px prelude lines in normal flow. A4 with 16mm margins fixes remaining height; no invisible spacer or generated blank page. The critical negative control must reproduce the long-edge baseline title on page 1 and first row on page 2, while baseline short/room controls pass. Failure to reproduce makes the experiment inconclusive, not a fix.

Local gates validate the parsed HTML table/heading/header/data associations and counterexamples for duplicated/missing markers, wrong-page heading, overlap, blank pages and clipped bounds. Native gates use every row's unique left/right markers, page coordinates, exact title occurrence, matching column-header alignment, long-table multi-page splitting and no blank/unnecessarily displaced short table. MuPDF glyph boxes crop independent Poppler 144dpi renders; guard ink tolerance remains two pixels. Save all HTML/PDFs, coordinates, renders, native maps, versions and failures.

One manual workflow only if these local gates pass and no equivalent task is active. 20-minute job, 660-second native outer bound, 55-second per print bound. No Milkup/package build, installed application matrix, private engine, queue, Unicode/URI study, security changes or production changes. Even a passing mechanism is reported for review before any product candidate. Native AT/row navigation and product-equivalent HTML still need separate consideration; parser semantics are not screen-reader evidence.

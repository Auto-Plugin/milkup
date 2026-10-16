# Ordinary identity fixture correction

Parent-run 149 log reports 5 failed / 547 passed across 22 files. Four failures concern intended scroll continuity (three retention cases and same-position scroll). The fifth, ordinary identity guard, did not trigger a DOM replacement: same text and selection passed to public EditorView.updateState retained existing DOM. It is a fixture setup issue, not evidence of stale offset restoration after an identity-invalidated rebuild.

The ordinary identity branch now calls public view.refreshDocumentPresentation() immediately after updateState. This initiates the identity-invalidated provider/render path before testing fresh offsets. One test line changed; no product changes and no tests run by this agent. Raw 149 evidence remains unchanged. Parent will run the corrected red check; no result claimed here.

Updated external patch SHA256: `47fb89f0916824c73aac555a1a567747d396c9151c6436c80d77e028218ebe88`.

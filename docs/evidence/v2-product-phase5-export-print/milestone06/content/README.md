# Milestone06 content acceptance preparation

Fixture design and frozen bytes are under `tests/fixtures/p5-output/milestone06/`. No UI/native process was started for this preparation. Product converter and the main native harness were not edited.

Draft checker command:

```
python3 /workspace/milkup-export-print-evidence/milestone06/content/audit-artifact.py --fixture single-r1 --kind html --artifact ACTUAL.html --output AUDIT.json
python3 /workspace/milkup-export-print-evidence/milestone06/content/audit-artifact.py --fixture print04-regression --kind pdf --artifact ACTUAL.pdf --output AUDIT.json
```

For HTML it checks actual SVG presentation count, expected visible-label text within SVG text nodes, at least the expected rectangles/arrows, unique IDs, resolved marker references, forbidden stale-version markers, body completeness and fallback/warnings. It does not establish rendered geometry or visibility. For PDF it checks body completeness and rejects Mermaid source grammar; it deliberately does not infer diagram success from extracted labels. A zero exit means CONTENT_PRECHECK_PASS_VISUAL_AND_PROVENANCE_PENDING, never final acceptance.

The draft was checked against retained actual artifacts only: old print04 returns failure for Mermaid source fallback; old PDF05 returns content-precheck success but leaves visual and provenance pending and records the existing exact-codepoint failures. These are checker controls, not milestone06 product execution or a repaired-renderer result. Exit files are retained.

Use `provenance-template.json` as a field checklist, filling actual observations rather than copying nulls or claiming runtime versions from fixture revision names. Root/plugin owns integration. In particular, record all dispatches before the action: opening a document can warm the renderer before first output. First-output and first-renderer-invocation claims are separate. For cancellation too late to interrupt preparation, mark that checkpoint NOT_EXERCISED.

Final visual gate requires actual saved HTML offline DOM/pixel inspection or actual PDF page rasters, each expected graph with visible nodes and arrows, no source fallback, unique references and all source markers. Keep exact-codepoint and long-block-pagination failures separate and red. Never retry over a failed run's evidence.

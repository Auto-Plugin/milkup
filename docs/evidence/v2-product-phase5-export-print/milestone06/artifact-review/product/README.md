# Formal queue-fix product artifact review

These actual outputs use binary6e6c004030fe06146b58d9e40cbd22c7c7d3315c306ceb741f3f58e119ed9d2a and independent diagrams1.1.1. They are separate from the rejected1.1.2 candidate experiments.

`visual-summary.json`: actual first/repeat HTML received fresh offline screenshots; the existing single A4 PDF page raster was viewed without rerasterization. All three graph presentations visibly contain three readable nodes and two arrows, with no observed source fallback, clipping or overlap. First HTML and A4 still show the explicit incomplete-render warning(0–384), so clean completion FAIL remains. Repeat HTML has no warning.

The screenshots match the corresponding earlier candidate pixels exactly, but are independently captured from the formal HTML files. The installed sandboxed Chromium browser was used only as an offline artifact viewer via exact UTF8 setContent; no new dependency, native UI or product PDF-engine change. Both browsers closed before the next coordinated native run.

Static structural, ID/reference, source-marker and byte comparisons are in `multi-html-static-summary.json` and per-output reports. Their original precheck failures for the first warning remain recorded. PDF codepoint mapping, long-block pagination and physical-printer behavior are outside this visual result. Visible graph output is not a general proof that intermittent timeouts are solved.

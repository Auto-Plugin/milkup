# Actual product PDF and print-to-file review

Queue-fix binary 6e6c0040…9d2a with independent diagrams1.1.1. Existing PNGs reviewed; no browser or rasterization was used for this PDF review. Rerun lightweight checks with `python3 audit.py`.

Letter:2 pages,3 genuine visible diagrams. Page2 incomplete0–384 warning:clean completion FAIL.

Print first/repeat:7 pages each,100 page markers plus4 core markers each exactly once. Both have actual3node/2arrow graph and readable math. First footnotes remain literal source;5 warnings including incomplete and2 footnote fallbacks:rich completion FAIL. Repeat footnotes rendered, only2 intentional missing/remote-image warnings remain. All first-print pages viewed; repeat pages2/7 viewed separately, remaining5 pages exactRGB identical to reviewed first pages. No observed clipping or overlap.

Repeat PDF has identical xref objects and decoded streams to original PDF05 and old1.1.1/new rejected1.1.2 traceprints except object1 creation/modification dates. This is object comparison, not a cross-resolution pixel-equality claim:old reference PNGs have different dimensions. Within newfirst/repeat only pages2/7 differ, first graph area itself unchanged.

Exact original Unicode search/copy probes FAIL in Poppler and MuPDF without normalization. Long-block pagination remains a separate known failure. GTK print-to-file is not physical printing. Rejected candidate trace is retained solely as a reference, not product adoption. No reliability claim follows from these successes.

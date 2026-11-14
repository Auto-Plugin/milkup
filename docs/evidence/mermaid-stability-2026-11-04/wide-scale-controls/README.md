# Readable wide Mermaid display controls

The host-private PNG now offers a visible **原始尺寸 / 适应宽度** action only when its actual display width is smaller than the intrinsic PNG width. Default fitting and aspect ratio are preserved. Original-size mode uses a separate horizontal scroll viewport; the editor never grows to the PNG width. Narrow diagrams have no control. No new URL, HTML, plugin or native capability is accepted.

The same image element, blob URL and resource lease remain owned throughout the interaction. Scale mode belongs to that image instance and is discarded with it. The host-only layout notification verifies its current image owner and paint context, then updates existing virtual row heights and cursor geometry without starting document preparation. Disposing an image removes its observer, scheduled layout callback and control listeners.

Actual Linux Chromium ran both EditorView and SourceDocumentView with production CSS and presentation service, using the real 3528×126 PNG from Windows source run 41760093749 and a mocked renderer. In both views, Enter changed fit to original size, ArrowRight scrolled the viewport 80 pixels, Space returned to fit and reset scrolling, and a later original-size view stayed stable for three seconds. Provider calls and mocked renderer calls stayed at one; the same image/blob and exact document text remained unchanged. SourceDocumentView's measured row height matched actual DOM height after both transitions. Final PNG bytes, images and decoded owners all returned to zero.

PNG control tests: **20 passed**. Adjacent presentation/viewport/preparation/focus/pointer tests: **52 passed**. View-DOM TypeScript checking and formatting passed. These tests are not Windows product acceptance; the next native GUI run must exercise the same controls, unchanged native request count/PNG hash and scroll behavior.

The screenshots show an actual browser with the recorded native PNG, not an invented diagram or a new native render. The original-size screenshot makes the labels readable and keeps the fit button accessible above the horizontal scrollbar. A full DPI matrix and arbitrary Mermaid layouts remain outside this check.

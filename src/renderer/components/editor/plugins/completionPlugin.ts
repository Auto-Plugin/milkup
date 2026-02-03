import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { AIService } from "@/renderer/services/ai";
import { useAIConfig } from "@/renderer/hooks/useAIConfig";

export const completionKey = new PluginKey("milkup-completion");

export const completionPlugin = $prose(() => {
  const { config, isEnabled } = useAIConfig();
  let timer: NodeJS.Timeout | null = null;

  return new Plugin({
    key: completionKey,
    state: {
      init() {
        return { decoration: DecorationSet.empty, suggestion: null, loading: false };
      },
      apply(tr, value) {
        // Clear suggestion on any document change
        if (tr.docChanged) {
          return { decoration: DecorationSet.empty, suggestion: null, loading: false };
        }
        // Update decoration if manually dispatched (e.g. by async fetch)
        const meta = tr.getMeta(completionKey);
        if (meta) {
          return meta;
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decoration;
      },
      handleKeyDown(view, event) {
        if (event.key === "Tab") {
          const state = this.getState(view.state);
          if (state?.suggestion) {
            event.preventDefault();
            const tr = view.state.tr.insertText(state.suggestion, view.state.selection.to);
            // Clear the suggestion
            tr.setMeta(completionKey, {
              decoration: DecorationSet.empty,
              suggestion: null,
              loading: false,
            });
            view.dispatch(tr);
            return true;
          }
        }
        return false;
      },
    },
    view(_view) {
      return {
        update: (view: EditorView, prevState) => {
          // If disabled, do nothing
          if (!isEnabled.value) return;

          // If doc didn't change, ignore (unless it was our own transaction clearing things)
          if (!view.state.doc.eq(prevState.doc)) {
            if (timer) clearTimeout(timer);

            // Simple logic: Trigger only if user stopped typing at the end of a block??
            // Or just anywhere? Let's obey the debounce rule globally for now.

            timer = setTimeout(async () => {
              // Ensure editor is still focused? Maybe not strictly required but good UX
              // if (!view.hasFocus()) return

              const { selection, doc } = view.state;
              const { to } = selection;

              // Don't trigger if selection is not empty (range selection)
              if (!selection.empty) return;

              // Retrieve context
              // Build simple context: previous 100 chars
              // We can improve this by walking up the tree to find headers
              const fileTitle = (window as any).__currentFilePath
                ? (window as any).__currentFilePath.split(/[\\/]/).pop()
                : "未命名文档";

              // Naively get previous text
              const start = Math.max(0, to - 200);
              const previousContent = doc.textBetween(start, to, "\n");

              // Extract headers context for better AI awareness
              let sectionTitle = "未知";
              let subSectionTitle = "未知";

              const headers: { level: number; text: string }[] = [];

              doc.nodesBetween(0, to, (node, pos) => {
                if (node.type.name === "heading") {
                  // Only take headers that are strictly before the cursor position
                  if (pos + node.nodeSize <= to) {
                    headers.push({ level: node.attrs.level, text: node.textContent });
                  }
                  return false; // Don't descend into heading (optimization)
                }
                // Skip content of other blocks to improve performance
                if (
                  ["paragraph", "code_block", "blockquote", "bullet_list", "ordered_list"].includes(
                    node.type.name
                  )
                ) {
                  return false;
                }
                return true;
              });

              if (headers.length > 0) {
                const lastHeader = headers[headers.length - 1];
                subSectionTitle = lastHeader.text;

                // Find the "Big Title" (Section Title)
                // Looks for the nearest ancestor header (lower level number)
                const parentHeader = headers
                  .slice(0, -1)
                  .reverse()
                  .find((h) => h.level < lastHeader.level);

                if (parentHeader) {
                  sectionTitle = parentHeader.text;
                } else {
                  // If no direct parent found (e.g. H2...H2), find the document title (H1) or just fallback
                  const mainHeader =
                    headers.find((h) => h.level === 1) || headers.find((h) => h.level === 2);
                  if (mainHeader && mainHeader !== lastHeader) {
                    sectionTitle = mainHeader.text;
                  } else if (lastHeader.level <= 2) {
                    sectionTitle = lastHeader.text;
                  }
                }
              }

              if (previousContent.trim().length < 5) return; // Too short context

              try {
                const result = await AIService.complete(config.value, {
                  fileTitle,
                  previousContent,
                  sectionTitle,
                  subSectionTitle,
                });

                if (result && result.continuation) {
                  const widget = document.createElement("span");
                  widget.textContent = result.continuation;
                  widget.style.color = "var(--text-color-light, #999)"; // Use a lighter color
                  widget.style.opacity = "0.6";
                  widget.style.pointerEvents = "none";
                  widget.dataset.suggestion = result.continuation;

                  // Create deco
                  const deco = Decoration.widget(to, widget, { side: 1 });
                  const decoSet = DecorationSet.create(view.state.doc, [deco]);

                  // Dispatch state update
                  const tr = view.state.tr.setMeta(completionKey, {
                    decoration: decoSet,
                    suggestion: result.continuation,
                  });
                  view.dispatch(tr);
                }
              } catch (e) {
                console.error("AI Completion failed", e);
              }
            }, config.value.debounceWait || 2000);
          }
        },
      };
    },
  });
});

import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";
import { editorViewCtx } from "@milkdown/kit/core";

export const sourceOnFocusPluginKey = new PluginKey("MILKUP_SOURCE_ON_FOCUS");

export const sourceOnFocusPlugin = $prose((ctx) => {
  return new Plugin({
    key: sourceOnFocusPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr) {
        const { selection } = tr;
        const decorations: Decoration[] = [];
        const view = ctx.get(editorViewCtx);

        const handleImage = (img: any, pos: number, side: number = -1) => {
          const { src, alt } = img.attrs;
          decorations.push(
            Decoration.widget(
              pos,
              () => {
                const wrapper = document.createElement("span");
                wrapper.className = "md-source-image-wrapper";
                wrapper.textContent = "![";
                const altSpan = document.createElement("span");
                altSpan.className = "md-source-alt-editable";
                altSpan.contentEditable = "true";
                altSpan.textContent = alt || "";
                altSpan.style.caretColor = "var(--text-color-3)";

                const moveFocus = (isRight: boolean) => {
                  view.focus();
                  const targetPos = isRight ? pos + 1 : pos;
                  view.dispatch(
                    view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos))
                  );
                };

                const commitAlt = () => {
                  const newAlt = altSpan.textContent || "";
                  if (newAlt === alt) return;
                  view.dispatch(
                    view.state.tr.setNodeMarkup(pos, null, { ...img.attrs, alt: newAlt })
                  );
                };

                altSpan.addEventListener("keydown", (e) => {
                  const sel = window.getSelection();
                  if (e.key === "ArrowLeft" && sel?.anchorOffset === 0) {
                    e.preventDefault();
                    commitAlt();
                    moveFocus(false);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitAlt();
                    view.focus();
                    return;
                  }
                  e.stopPropagation();
                });

                altSpan.addEventListener("blur", () => {
                  commitAlt();
                });
                wrapper.appendChild(altSpan);
                wrapper.appendChild(document.createTextNode("]("));
                const srcSpan = document.createElement("span");
                srcSpan.className = "md-source-src-editable";
                srcSpan.contentEditable = "true";
                srcSpan.textContent = src;
                srcSpan.style.caretColor = "var(--text-color-3)";

                const commitSrc = () => {
                  const newSrc = srcSpan.textContent || "";
                  if (newSrc === src) return;
                  view.dispatch(
                    view.state.tr.setNodeMarkup(pos, null, { ...img.attrs, src: newSrc })
                  );
                };

                srcSpan.addEventListener("keydown", (e) => {
                  const sel = window.getSelection();
                  if (e.key === "ArrowRight" && sel?.anchorOffset === srcSpan.textContent?.length) {
                    e.preventDefault();
                    commitSrc();
                    moveFocus(true);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitSrc();
                    view.focus();
                    return;
                  }
                  e.stopPropagation();
                });

                srcSpan.addEventListener("blur", () => {
                  commitSrc();
                });
                wrapper.appendChild(srcSpan);
                wrapper.appendChild(document.createTextNode(")"));
                return wrapper;
              },
              { side }
            )
          );
        };

        // 0. 处理 NodeSelection (块级图片点击时)
        if (!selection.empty) {
          const selectedNode = (selection as any).node;
          if (
            selectedNode &&
            (selectedNode.type.name === "image" || selectedNode.type.name === "image-block")
          ) {
            handleImage(selectedNode, selection.from, -1);
          }
          // 对于其他非空选区（如划词），不显示源码预览
          if (decorations.length > 0) return DecorationSet.create(tr.doc, decorations);
          return DecorationSet.empty;
        }

        const { $from } = selection;

        // 1. 处理 Marks
        const marks = $from.marks();
        marks.forEach((mark) => {
          const type = mark.type.name;
          if (
            ["strong", "emphasis", "code_inline", "strike_through"].includes(type) ||
            type === "link"
          ) {
            let prefix = "",
              suffix = "";
            if (type === "strong") prefix = suffix = "**";
            else if (type === "emphasis") prefix = suffix = "*";
            else if (type === "code_inline") prefix = suffix = "`";
            else if (type === "strike_through") prefix = suffix = "~~";
            else if (type === "link") {
              prefix = "[";
              suffix = "]";
            }

            let start = $from.pos,
              end = $from.pos;
            $from.doc.nodesBetween(
              $from.start($from.depth),
              $from.end($from.depth),
              (node, pos) => {
                if (node.isText && mark.isInSet(node.marks)) {
                  if (pos < start) start = pos;
                  if (pos + node.nodeSize > end) end = pos + node.nodeSize;
                }
              }
            );

            if (prefix) {
              decorations.push(
                Decoration.widget(
                  start,
                  () => {
                    const el = document.createElement("span");
                    el.className = "md-source md-source-prefix";
                    el.textContent = prefix;
                    return el;
                  },
                  { side: -1 }
                )
              );
            }
            if (suffix) {
              decorations.push(
                Decoration.widget(
                  end,
                  () => {
                    const el = document.createElement("span");
                    el.className = "md-source md-source-suffix";
                    el.textContent = suffix;
                    return el;
                  },
                  { side: 1 }
                )
              );
            }

            if (type === "link") {
              const { href } = mark.attrs;
              decorations.push(
                Decoration.widget(
                  end,
                  () => {
                    const wrapper = document.createElement("span");
                    wrapper.className = "md-source-url-wrapper";
                    wrapper.textContent = "(";
                    const span = document.createElement("span");
                    span.className = "md-source-url-editable";
                    span.contentEditable = "true";
                    span.textContent = href;
                    span.style.caretColor = "var(--text-color-3)";
                    span.setAttribute("data-pos", end.toString());

                    const commitChange = () => {
                      const newHref = span.textContent || "";
                      if (newHref === href) return;
                      view.dispatch(
                        view.state.tr
                          .removeMark(start, end, mark.type)
                          .addMark(start, end, mark.type.create({ ...mark.attrs, href: newHref }))
                      );
                    };

                    span.addEventListener("keydown", (e) => {
                      const sel = window.getSelection();

                      // 向左跳出逻辑
                      if (e.key === "ArrowLeft" && sel?.anchorOffset === 0) {
                        e.preventDefault();
                        commitChange();
                        view.focus();
                        view.dispatch(
                          view.state.tr.setSelection(TextSelection.create(view.state.doc, end))
                        );
                        return;
                      }
                      // 向右跳出逻辑
                      if (
                        e.key === "ArrowRight" &&
                        sel?.anchorOffset === span.textContent?.length
                      ) {
                        e.preventDefault();
                        commitChange();
                        view.focus();
                        // 移动到 end + 1 处，确保彻底跳出链接的 Mark 范围并关闭源码预览
                        const nextPos = Math.min(view.state.doc.content.size, end + 1);
                        view.dispatch(
                          view.state.tr
                            .setSelection(TextSelection.create(view.state.doc, nextPos))
                            .setStoredMarks([])
                        );
                        return;
                      }
                      // 提交逻辑
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitChange();
                        view.focus();
                        return;
                      }

                      // 阻止其他键冒泡给 ProseMirror（如字母、数字、空格、删除键等）
                      // 这样可以确保 these 按键在 contentEditable 元素内正常工作
                      e.stopPropagation();
                    });

                    span.addEventListener("blur", () => {
                      commitChange();
                    });
                    wrapper.appendChild(span);
                    wrapper.appendChild(document.createTextNode(")"));
                    return wrapper;
                  },
                  { side: 2 }
                )
              );
            }
          }
        });

        // 2. 处理 Nodes
        const node = $from.parent;
        if (node.type.name === "heading") {
          const prefix = "#".repeat(node.attrs.level) + " ";
          decorations.push(
            Decoration.widget(
              $from.start(),
              () => {
                const el = document.createElement("span");
                el.className = "md-source md-source-heading";
                el.textContent = prefix;
                return el;
              },
              { side: -1 }
            )
          );
        }

        const nodeAfter = $from.nodeAfter;
        const nodeBefore = $from.nodeBefore;

        if (
          nodeAfter &&
          (nodeAfter.type.name === "image" || nodeAfter.type.name === "image-block")
        ) {
          handleImage(nodeAfter, $from.pos, -1);
        } else if (
          nodeBefore &&
          (nodeBefore.type.name === "image" || nodeBefore.type.name === "image-block")
        ) {
          handleImage(nodeBefore, $from.pos - 1, 1);
        } else if (node.type.name === "image-block") {
          // 场景：光标就在 image-block 内部（节点选区或类似的）
          handleImage(node, $from.before(), -1);
        }

        return DecorationSet.create(tr.doc, decorations);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
      handleKeyDown(view, event) {
        const { selection } = view.state;
        const { $from } = selection;

        if (event.key === "ArrowRight" && selection.empty) {
          // 处理链接：在链接末尾按右键进入 URL 编辑
          const marks = $from.marks();
          const linkMark = marks.find((m) => m.type.name === "link");
          if (linkMark) {
            // 计算当前链接的精确范围
            let markStart = $from.pos,
              markEnd = $from.pos;
            $from.doc.nodesBetween(
              $from.start($from.depth),
              $from.end($from.depth),
              (node, pos) => {
                if (node.isText && linkMark.isInSet(node.marks)) {
                  if (pos < markStart) markStart = pos;
                  if (pos + node.nodeSize > markEnd) markEnd = pos + node.nodeSize;
                }
              }
            );

            if ($from.pos === markEnd) {
              const el = view.dom.querySelector(
                `.md-source-url-editable[data-pos="${markEnd}"]`
              ) as HTMLElement;
              if (el) {
                el.focus();
                // 确保光标在最前面
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(el);
                range.collapse(true);
                sel?.removeAllRanges();
                sel?.addRange(range);
                return true;
              }
            }
          }

          // 处理图片
          if (
            $from.nodeAfter?.type.name === "image" ||
            $from.nodeAfter?.type.name === "image-block"
          ) {
            const el = view.dom.querySelector(".md-source-alt-editable") as HTMLElement;
            if (el) {
              el.focus();
              return true;
            }
          }

          // 处理加粗/斜体/内联代码等 Mark 的跳出
          const specialMarks = ["strong", "emphasis", "code_inline", "strike_through", "link"];
          const activeSpecialMark = marks.find((m) => specialMarks.includes(m.type.name));

          if (activeSpecialMark) {
            // 获取当前所有 special mark 的最大结束位置
            let maxEnd = $from.pos;
            marks.forEach((mark) => {
              if (specialMarks.includes(mark.type.name)) {
                $from.doc.nodesBetween(
                  $from.start($from.depth),
                  $from.end($from.depth),
                  (node, pos) => {
                    if (node.isText && mark.isInSet(node.marks)) {
                      maxEnd = Math.max(maxEnd, pos + node.nodeSize);
                    }
                  }
                );
              }
            });

            if ($from.pos === maxEnd) {
              const nextPos = Math.min(view.state.doc.content.size, maxEnd + 1);
              view.dispatch(
                view.state.tr
                  .setSelection(TextSelection.create(view.state.doc, nextPos))
                  .setStoredMarks([])
              );
              return true; // 拦截默认行为，防止跳到下一行
            }
          }
        }
        if (event.key === "ArrowLeft") {
          if (
            $from.nodeBefore?.type.name === "image" ||
            $from.nodeBefore?.type.name === "image-block"
          ) {
            const el = view.dom.querySelector(".md-source-src-editable") as HTMLElement;
            if (el) {
              // 将光标设置到末尾
              el.focus();
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(el);
              range.collapse(false);
              sel?.removeAllRanges();
              sel?.addRange(range);
              return true;
            }
          }
        }
        return false;
      },
    },
  });
});

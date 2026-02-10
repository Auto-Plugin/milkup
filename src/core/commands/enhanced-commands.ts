/**
 * 增强的编辑器命令
 *
 * 通过插入 Markdown 语法文本实现格式化，
 * 让 syntax-detector 和 heading-sync 等插件自动处理渲染。
 */

import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import { MarkType } from "prosemirror-model";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** Mark 类型对应的 Markdown 语法标记 */
const MARK_SYNTAX: Record<string, { prefix: string; suffix: string }> = {
  strong: { prefix: "**", suffix: "**" },
  emphasis: { prefix: "*", suffix: "*" },
  code_inline: { prefix: "`", suffix: "`" },
  strikethrough: { prefix: "~~", suffix: "~~" },
  highlight: { prefix: "==", suffix: "==" },
};

/**
 * 创建增强的 toggleMark 命令
 *
 * 始终通过插入 Markdown 语法文本实现，让 syntax-detector 自动处理渲染。
 * - 有选区：在选区两端插入语法标记
 * - 无选区：插入语法标记对，光标定位到中间
 */
export function createEnhancedToggleMark(markType: MarkType): Command {
  const syntax = MARK_SYNTAX[markType.name];

  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    if (!syntax) return false;

    const { from, to, empty } = state.selection;

    if (dispatch) {
      if (empty) {
        // 无选区：插入标记对，光标在中间
        const text = syntax.prefix + syntax.suffix;
        const tr = state.tr.insertText(text, from);
        tr.setSelection(TextSelection.create(tr.doc, from + syntax.prefix.length));
        dispatch(tr);
      } else {
        // 有选区：检查是否已有该语法，如果是则移除，否则添加
        const tr = state.tr;
        const selectedText = state.doc.textBetween(from, to);
        const prefixLen = syntax.prefix.length;
        const suffixLen = syntax.suffix.length;

        // 情况1：选区外侧紧邻语法标记（如选中 a，两侧是 **a**）
        const beforeFrom = Math.max(0, from - prefixLen);
        const afterTo = Math.min(state.doc.content.size, to + suffixLen);
        const textBefore = state.doc.textBetween(beforeFrom, from);
        const textAfter = state.doc.textBetween(to, afterTo);

        if (textBefore === syntax.prefix && textAfter === syntax.suffix) {
          // 移除外侧语法标记（先删后面的，再删前面的，避免位置偏移）
          tr.delete(to, afterTo);
          tr.delete(beforeFrom, from);
          tr.setSelection(
            TextSelection.create(tr.doc, beforeFrom, beforeFrom + selectedText.length)
          );
          dispatch(tr);
          return true;
        }

        // 情况2：选区本身包含语法标记（如选中 **a**）
        if (
          selectedText.length >= prefixLen + suffixLen &&
          selectedText.startsWith(syntax.prefix) &&
          selectedText.endsWith(syntax.suffix)
        ) {
          const inner = selectedText.slice(prefixLen, selectedText.length - suffixLen);
          tr.insertText(inner, from, to);
          tr.setSelection(TextSelection.create(tr.doc, from, from + inner.length));
          dispatch(tr);
          return true;
        }

        // 情况3：未包裹，在选区两端插入语法标记
        tr.insertText(syntax.suffix, to);
        tr.insertText(syntax.prefix, from);
        tr.setSelection(TextSelection.create(tr.doc, from + prefixLen, to + prefixLen));
        dispatch(tr);
      }
    }
    return true;
  };
}

/**
 * 创建设置标题命令
 *
 * 通过插入/修改 `# ` 语法标记文本实现标题切换。
 * - 段落 → 标题：设置节点类型并插入 `# ` 前缀
 * - 标题（同级）→ 段落：移除 `# ` 前缀并转为段落
 * - 标题（不同级）→ 标题：替换 `# ` 前缀
 */
export function createSetHeadingCommand(level: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const { $from } = state.selection;
    const parent = $from.parent;
    const parentPos = $from.before($from.depth);
    const schema = state.schema;

    if (!schema.nodes.heading) return false;

    // 只处理段落和标题
    if (parent.type.name !== "paragraph" && parent.type.name !== "heading") {
      return false;
    }

    if (dispatch) {
      const syntaxMarkerType = schema.marks.syntax_marker;
      const hashStr = "#".repeat(level);

      if (parent.type.name === "heading") {
        if (parent.attrs.level === level) {
          // 同级标题 → 段落：移除 # 前缀和后面的空格
          let removeEnd = 0;
          let syntaxEnd = 0;
          parent.forEach((child, offset) => {
            if (
              child.marks.some(
                (m: any) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
              )
            ) {
              syntaxEnd = offset + child.nodeSize;
              removeEnd = syntaxEnd;
            }
          });
          // 检查语法标记后面是否紧跟一个空格
          if (syntaxEnd < parent.content.size) {
            const nextText = parent.textBetween(
              syntaxEnd,
              Math.min(syntaxEnd + 1, parent.content.size)
            );
            if (nextText === " ") {
              removeEnd = syntaxEnd + 1;
            }
          }

          const tr = state.tr;
          tr.setBlockType(parentPos, parentPos + parent.nodeSize, schema.nodes.paragraph);
          if (removeEnd > 0) {
            tr.delete(parentPos + 1, parentPos + 1 + removeEnd);
          }
          dispatch(tr.scrollIntoView());
        } else {
          // 不同级标题：只替换 # 部分（保留空格）
          let syntaxFrom = -1;
          let syntaxTo = -1;
          parent.forEach((child, offset) => {
            if (
              syntaxFrom === -1 &&
              child.marks.some(
                (m: any) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
              )
            ) {
              syntaxFrom = offset;
              syntaxTo = offset + child.nodeSize;
            }
          });

          const tr = state.tr;
          const syntaxMark = syntaxMarkerType?.create({ syntaxType: "heading" });
          const newSyntaxText = syntaxMark
            ? schema.text(hashStr, [syntaxMark])
            : schema.text(hashStr);

          if (syntaxFrom >= 0) {
            tr.replaceWith(parentPos + 1 + syntaxFrom, parentPos + 1 + syntaxTo, newSyntaxText);
          }
          tr.setNodeMarkup(parentPos, schema.nodes.heading, { level });
          dispatch(tr.scrollIntoView());
        }
      } else {
        // 段落 → 标题：插入 # 和空格（分开）
        const tr = state.tr;
        tr.setBlockType(parentPos, parentPos + parent.nodeSize, schema.nodes.heading, { level });
        const syntaxMark = syntaxMarkerType?.create({ syntaxType: "heading" });
        const syntaxText = syntaxMark ? schema.text(hashStr, [syntaxMark]) : schema.text(hashStr);
        // 先插入空格，再在空格前插入 #（因为 insert 在同一位置会按顺序排列）
        tr.insert(parentPos + 1, syntaxText);
        tr.insert(parentPos + 1 + hashStr.length, schema.text(" "));
        dispatch(tr.scrollIntoView());
      }
    }
    return true;
  };
}

/**
 * 创建设置段落命令
 *
 * 如果当前是标题，移除 # 前缀并转为段落。
 */
export function createSetParagraphCommand(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const { $from } = state.selection;
    const parent = $from.parent;
    const parentPos = $from.before($from.depth);
    const schema = state.schema;

    if (!schema.nodes.paragraph) return false;

    if (parent.type.name === "paragraph") return false; // 已经是段落

    if (parent.type.name === "heading") {
      if (dispatch) {
        let syntaxEnd = 0;
        let removeEnd = 0;
        parent.forEach((child, offset) => {
          if (
            child.marks.some(
              (m: any) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
            )
          ) {
            syntaxEnd = offset + child.nodeSize;
            removeEnd = syntaxEnd;
          }
        });
        // 检查语法标记后面是否紧跟一个空格
        if (syntaxEnd < parent.content.size) {
          const nextText = parent.textBetween(
            syntaxEnd,
            Math.min(syntaxEnd + 1, parent.content.size)
          );
          if (nextText === " ") {
            removeEnd = syntaxEnd + 1;
          }
        }

        const tr = state.tr;
        tr.setBlockType(parentPos, parentPos + parent.nodeSize, schema.nodes.paragraph);
        if (removeEnd > 0) {
          tr.delete(parentPos + 1, parentPos + 1 + removeEnd);
        }
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    return false;
  };
}

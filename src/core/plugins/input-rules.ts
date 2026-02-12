/**
 * Milkup 输入规则插件
 *
 * 自动转换 Markdown 语法
 */

import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from "prosemirror-inputrules";
import { NodeType, MarkType, Schema, Fragment } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { milkupSchema } from "../schema";
import { decorationPluginKey } from "../decorations";

/**
 * 创建标题输入规则
 * # heading -> h1
 * ## heading -> h2
 * ...
 * 同时添加 syntax_marker 以支持即时渲染
 */
function headingRule(nodeType: NodeType, maxLevel: number = 6): InputRule {
  return new InputRule(new RegExp(`^(#{1,${maxLevel}})\\s$`), (state, match, start, end) => {
    const level = match[1].length;
    const schema = state.schema;
    const syntaxMarkerType = schema.marks.syntax_marker;

    // 检查是否可以转换为标题
    const $start = state.doc.resolve(start);
    if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)) {
      return null;
    }

    // 创建语法标记文本（# 带 syntax_marker，空格单独作为普通文本）
    const hashText = match[1];
    let content;
    if (syntaxMarkerType) {
      const syntaxMark = syntaxMarkerType.create({ syntaxType: "heading" });
      content = [schema.text(hashText, [syntaxMark]), schema.text(" ")];
    } else {
      content = [schema.text(hashText + " ")];
    }

    // 先删除匹配的文本，然后设置块类型，最后插入语法标记
    let tr = state.tr.delete(start, end);
    tr = tr.setBlockType(start, start, nodeType, { level });
    // 在标题开头插入语法标记
    for (const node of content) {
      tr = tr.insert(start, node);
      start += node.nodeSize;
    }

    return tr;
  });
}

/**
 * 创建引用块输入规则
 * > quote
 */
function blockquoteRule(nodeType: NodeType): InputRule {
  return wrappingInputRule(/^>\s$/, nodeType);
}

/**
 * 创建代码块输入规则
 * ```lang 并按空格时创建代码块
 */
function codeBlockRule(nodeType: NodeType): InputRule {
  return new InputRule(/^```(\w*) $/, (state, match, start, end) => {
    // 源码视图模式下不自动创建代码块
    const decorationState = decorationPluginKey.getState(state);
    if (decorationState?.sourceView) {
      return null;
    }

    const language = match[1] || "";
    const $start = state.doc.resolve(start);

    // 检查是否可以创建代码块
    if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)) {
      return null;
    }

    // 获取当前段落的起始位置
    const paragraphStart = $start.start();

    // 创建空的代码块
    const codeBlock = nodeType.create({ language });

    // 替换整个段落为代码块
    const tr = state.tr.replaceWith(paragraphStart, end, codeBlock);

    // 将光标移动到代码块内部
    tr.setSelection(TextSelection.create(tr.doc, paragraphStart + 1));

    return tr;
  });
}

/**
 * 创建分隔线输入规则
 * --- 或 *** 或 ___
 */
function horizontalRuleRule(nodeType: NodeType): InputRule {
  return new InputRule(/^([-*_]){3,}\s$/, (state, match, start, end) => {
    const tr = state.tr.replaceWith(start - 1, end, nodeType.create());
    return tr;
  });
}

/**
 * 创建无序列表输入规则
 * - item 或 * item
 */
function bulletListRule(listType: NodeType, itemType: NodeType): InputRule {
  return wrappingInputRule(/^[-*+]\s$/, listType, null, (_, node) => node.type === itemType);
}

/**
 * 创建有序列表输入规则
 * 1. item
 */
function orderedListRule(listType: NodeType, itemType: NodeType): InputRule {
  return wrappingInputRule(
    /^(\d+)\.\s$/,
    listType,
    (match) => ({ start: parseInt(match[1], 10) }),
    (match, node) => node.type === itemType && node.childCount + parseInt(match[1], 10) === 1
  );
}

/**
 * 创建任务列表输入规则
 * 在无序列表项内输入 [] 或 [ ] 或 [x] 后跟空格，转换为任务列表
 */
function taskListRule(listType: NodeType, itemType: NodeType): InputRule {
  return new InputRule(/^\[([ xX]?)\]\s$/, (state, match, start, end) => {
    const checked = match[1].toLowerCase() === "x";
    const $start = state.doc.resolve(start);

    // 检查是否在 list_item > paragraph 内
    if ($start.depth < 2) return null;

    const listItemDepth = $start.depth - 1;
    const listItem = $start.node(listItemDepth);
    const listDepth = listItemDepth - 1;
    const list = $start.node(listDepth);

    if (listItem.type.name !== "list_item" || list.type.name !== "bullet_list") return null;

    // 确保是段落的开头
    const paraStart = $start.start($start.depth);
    if (start !== paraStart) return null;

    const listPos = $start.before(listDepth);
    const matchLen = end - start;

    // 构建新的段落内容：移除匹配的 [] 文本
    const para = $start.node($start.depth);
    const newParaContent = para.content.cut(matchLen);
    const newPara = para.type.create(
      para.attrs,
      newParaContent.size > 0 ? newParaContent : undefined
    );

    // 重建列表项内容：替换第一个段落，保留其余子节点
    const itemChildren: any[] = [newPara];
    for (let i = 1; i < listItem.childCount; i++) {
      itemChildren.push(listItem.child(i));
    }

    if (list.childCount === 1) {
      // 单项列表：一次性替换整个列表
      const newItem = itemType.create({ checked }, itemChildren);
      const newList = listType.create(null, newItem);
      let tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, newList);
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(listPos + 2)));
      return tr;
    }

    // 多项列表：拆分列表，将当前项转换为任务列表
    const itemIndex = $start.index(listDepth);
    const newItem = itemType.create({ checked }, itemChildren);
    const newTaskList = listType.create(null, newItem);

    const beforeItems: any[] = [];
    const afterItems: any[] = [];
    list.forEach((child, _offset, index) => {
      if (index < itemIndex) beforeItems.push(child);
      else if (index > itemIndex) afterItems.push(child);
    });

    const fragments: any[] = [];
    if (beforeItems.length > 0) {
      fragments.push(list.type.create(list.attrs, Fragment.from(beforeItems)));
    }
    fragments.push(newTaskList);
    if (afterItems.length > 0) {
      fragments.push(list.type.create(list.attrs, Fragment.from(afterItems)));
    }

    let tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, fragments);
    let cursorPos = listPos;
    if (beforeItems.length > 0) {
      cursorPos += beforeItems.reduce((s: number, n: any) => s + n.nodeSize, 0) + 2;
    }
    cursorPos += 2; // 进入 task_list > task_item > paragraph
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));
    return tr;
  });
}

/**
 * 创建带 syntax_marker 的行内规则
 * 保持与解析器一致的文档结构
 */
function createInlineRuleWithSyntax(
  pattern: RegExp,
  markType: MarkType,
  prefix: string | ((match: RegExpMatchArray) => string),
  suffix: string | ((match: RegExpMatchArray) => string),
  contentIndex: number,
  syntaxType: string
): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const schema = state.schema;
    const syntaxMarkerType = schema.marks.syntax_marker;
    const contentMark = markType.create();

    const prefixStr = typeof prefix === "function" ? prefix(match) : prefix;
    const suffixStr = typeof suffix === "function" ? suffix(match) : suffix;
    // 支持多个捕获组的情况（如 strong 的正则有两种模式）
    const content = match[contentIndex] || match[contentIndex + 2] || "";

    if (!prefixStr || !content) return null;

    let tr = state.tr.delete(start, end);

    // 插入前缀（带 syntax_marker + 语义 mark）
    tr = tr.insertText(prefixStr, start);
    if (syntaxMarkerType) {
      const syntaxMark = syntaxMarkerType.create({ syntaxType });
      tr = tr.addMark(start, start + prefixStr.length, syntaxMark);
    }
    tr = tr.addMark(start, start + prefixStr.length, contentMark);

    // 插入内容（带语义 mark）
    const contentStart = start + prefixStr.length;
    tr = tr.insertText(content, contentStart);
    tr = tr.addMark(contentStart, contentStart + content.length, contentMark);

    // 插入后缀（带 syntax_marker + 语义 mark）
    const suffixStart = contentStart + content.length;
    tr = tr.insertText(suffixStr, suffixStart);
    if (syntaxMarkerType) {
      const syntaxMark = syntaxMarkerType.create({ syntaxType });
      tr = tr.addMark(suffixStart, suffixStart + suffixStr.length, syntaxMark);
    }
    tr = tr.addMark(suffixStart, suffixStart + suffixStr.length, contentMark);

    return tr;
  });
}

/**
 * 创建行内代码输入规则
 * `code`
 */
function inlineCodeRule(markType: MarkType): InputRule {
  return createInlineRuleWithSyntax(/`([^`]+)`$/, markType, "`", "`", 1, "code_inline");
}

/**
 * 创建粗体输入规则
 * **text** 或 __text__
 * 允许内容包含其他语法标记
 */
function strongRule(markType: MarkType): InputRule {
  return createInlineRuleWithSyntax(
    /(?<!\*)(\*\*)(?!\*)(.+?)(?<!\*)\1(?!\*)$|(?<!_)(__)(?!_)(.+?)(?<!_)\1(?!_)$/,
    markType,
    (m) => m[1] || m[3],
    (m) => m[1] || m[3],
    2,
    "strong"
  );
}

/**
 * 创建斜体输入规则
 * *text* 或 _text_
 * 注意：下划线在单词中间时不应该被视为斜体标记
 */
function emphasisRule(markType: MarkType): InputRule {
  return createInlineRuleWithSyntax(
    /(?<![*_\w])(\*)(?![*\s])(.+?)(?<![*\s])\1(?![*])$|(?<![*_])(_)(?![_\s])(?=\S)(.+?)(?<=\S)(?<![_\s])\3(?![_\w])$/,
    markType,
    (m) => m[1] || m[3],
    (m) => m[1] || m[3],
    2,
    "emphasis"
  );
}

/**
 * 创建删除线输入规则
 * ~~text~~
 */
function strikethroughRule(markType: MarkType): InputRule {
  return createInlineRuleWithSyntax(/~~(.+?)~~$/, markType, "~~", "~~", 1, "strikethrough");
}

/**
 * 创建高亮输入规则
 * ==text==
 */
function highlightRule(markType: MarkType): InputRule {
  return createInlineRuleWithSyntax(/==(.+?)==$/, markType, "==", "==", 1, "highlight");
}

/**
 * 创建链接输入规则
 * [text](url) - url 可以为空，排除图片语法
 */
function linkRule(markType: MarkType): InputRule {
  return new InputRule(
    /(?<!!)\[([^\]]+)\]\(((?:[^)\\]|\\.)*)?\)$/, // 允许空 URL，支持转义括号，排除图片语法
    (state, match, start, end) => {
      const schema = state.schema;
      const syntaxMarkerType = schema.marks.syntax_marker;
      const url = match[2] || "";
      const linkMark = markType.create({ href: url, title: "" });

      const text = match[1];

      let tr = state.tr.delete(start, end);

      // 构建链接结构
      const prefix = "[";
      const suffix = `](${url})`;

      // 插入前缀 [ (syntax_marker + link)
      tr = tr.insertText(prefix, start);
      if (syntaxMarkerType) {
        const syntaxMark = syntaxMarkerType.create({ syntaxType: "link" });
        tr = tr.addMark(start, start + prefix.length, syntaxMark);
      }
      tr = tr.addMark(start, start + prefix.length, linkMark);

      // 插入链接文本 (link only)
      const textStart = start + prefix.length;
      tr = tr.insertText(text, textStart);
      tr = tr.addMark(textStart, textStart + text.length, linkMark);

      // 插入后缀 ](url) (syntax_marker + link)
      const suffixStart = textStart + text.length;
      tr = tr.insertText(suffix, suffixStart);
      if (syntaxMarkerType) {
        const syntaxMark = syntaxMarkerType.create({ syntaxType: "link" });
        tr = tr.addMark(suffixStart, suffixStart + suffix.length, syntaxMark);
      }
      tr = tr.addMark(suffixStart, suffixStart + suffix.length, linkMark);

      return tr;
    }
  );
}

/**
 * 创建图片输入规则
 * ![alt](src) - 行内图片
 */
function imageRule(nodeType: NodeType): InputRule {
  return new InputRule(/!\[([^\]]*)\]\(([^)]+)\)$/, (state, match, start, end) => {
    const alt = match[1] || "";
    const src = match[2] || "";

    const imageNode = nodeType.create({ src, alt, title: "" });

    return state.tr.replaceWith(start, end, imageNode);
  });
}

/**
 * 创建数学块输入规则
 * $$ 在行首输入时创建数学块
 */
function mathBlockRule(nodeType: NodeType): InputRule {
  return new InputRule(/^\$\$\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)) {
      return null;
    }
    return state.tr.delete(start, end).setBlockType(start, start, nodeType);
  });
}

/**
 * 创建单行数学块输入规则
 * $$content$$ 创建数学块
 */
function mathBlockInlineRule(nodeType: NodeType): InputRule {
  return new InputRule(/^\$\$(.+)\$\$$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)) {
      return null;
    }
    const content = match[1];
    const textNode = content ? state.schema.text(content) : null;
    return state.tr
      .delete(start, end)
      .replaceWith(start, start, nodeType.create({}, textNode ? [textNode] : []));
  });
}

/**
 * 创建行内数学公式输入规则
 * $content$
 */
function mathInlineRule(markType: MarkType): InputRule {
  return createInlineRuleWithSyntax(
    /(?<!\$)\$([^$]+)\$$/, // 排除 $$ 的情况
    markType,
    "$",
    "$",
    1,
    "math_inline"
  );
}

/**
 * 创建容器输入规则
 * :::type
 */
function containerRule(nodeType: NodeType): InputRule {
  return new InputRule(/^:::(\w+)(?:\s+(.*))?$/, (state, match, start, end) => {
    const type = match[1];
    const title = match[2] || "";
    const paragraph = state.schema.nodes.paragraph.create();
    return state.tr.replaceWith(start - 1, end, nodeType.create({ type, title }, paragraph));
  });
}

/**
 * 创建输入规则插件
 */
export function createInputRulesPlugin(schema: Schema = milkupSchema): Plugin {
  const rules: InputRule[] = [];

  // 块级规则
  if (schema.nodes.heading) {
    rules.push(headingRule(schema.nodes.heading));
  }
  if (schema.nodes.blockquote) {
    rules.push(blockquoteRule(schema.nodes.blockquote));
  }
  if (schema.nodes.code_block) {
    rules.push(codeBlockRule(schema.nodes.code_block));
  }
  if (schema.nodes.horizontal_rule) {
    rules.push(horizontalRuleRule(schema.nodes.horizontal_rule));
  }
  if (schema.nodes.bullet_list && schema.nodes.list_item) {
    rules.push(bulletListRule(schema.nodes.bullet_list, schema.nodes.list_item));
  }
  if (schema.nodes.ordered_list && schema.nodes.list_item) {
    rules.push(orderedListRule(schema.nodes.ordered_list, schema.nodes.list_item));
  }
  if (schema.nodes.task_list && schema.nodes.task_item) {
    rules.push(taskListRule(schema.nodes.task_list, schema.nodes.task_item));
  }
  if (schema.nodes.math_block) {
    rules.push(mathBlockRule(schema.nodes.math_block));
    rules.push(mathBlockInlineRule(schema.nodes.math_block));
  }
  if (schema.nodes.container) {
    rules.push(containerRule(schema.nodes.container));
  }

  // 行内规则
  if (schema.marks.code_inline) {
    rules.push(inlineCodeRule(schema.marks.code_inline));
  }
  if (schema.marks.strong) {
    rules.push(strongRule(schema.marks.strong));
  }
  if (schema.marks.emphasis) {
    rules.push(emphasisRule(schema.marks.emphasis));
  }
  if (schema.marks.strikethrough) {
    rules.push(strikethroughRule(schema.marks.strikethrough));
  }
  if (schema.marks.highlight) {
    rules.push(highlightRule(schema.marks.highlight));
  }
  if (schema.marks.link) {
    rules.push(linkRule(schema.marks.link));
  }
  if (schema.nodes.image) {
    rules.push(imageRule(schema.nodes.image));
  }
  if (schema.marks.math_inline) {
    rules.push(mathInlineRule(schema.marks.math_inline));
  }

  return inputRules({ rules });
}

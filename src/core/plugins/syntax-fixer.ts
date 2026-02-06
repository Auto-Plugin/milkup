/**
 * Milkup 语法修复插件
 *
 * 监听文档变化，检测并修复不完整的语法结构
 * 例如：删除 **a** 的后两个 ** 后，应该移除 strong mark
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Node, Mark } from "prosemirror-model";

/** 语法定义 */
interface SyntaxDef {
  markType: string;
  markers: string[]; // 可能的语法标记，如 ['**', '__'] 对应 strong
}

/** 支持的语法列表 */
const SYNTAX_DEFS: SyntaxDef[] = [
  { markType: "strong", markers: ["**", "__"] },
  { markType: "emphasis", markers: ["*", "_"] },
  { markType: "code_inline", markers: ["`"] },
  { markType: "strikethrough", markers: ["~~"] },
  { markType: "highlight", markers: ["=="] },
  { markType: "math_inline", markers: ["$"] },
  // 链接需要特殊处理，因为前后缀不同
];

/** 插件 Key */
export const syntaxFixerPluginKey = new PluginKey("milkup-syntax-fixer");

/** 语法标记信息 */
interface SyntaxMarkerInfo {
  from: number;
  to: number;
  text: string;
  syntaxType: string;
  semanticMark: string | null;
}

/**
 * 收集文本块中的所有语法标记
 */
function collectSyntaxMarkers(node: Node, basePos: number): SyntaxMarkerInfo[] {
  const markers: SyntaxMarkerInfo[] = [];

  let offset = 0;
  node.forEach((child) => {
    if (child.isText) {
      const syntaxMark = child.marks.find((m) => m.type.name === "syntax_marker");
      if (syntaxMark) {
        // 找到对应的语义 mark
        const semanticMark = child.marks.find(
          (m) =>
            m.type.name !== "syntax_marker" && SYNTAX_DEFS.some((s) => s.markType === m.type.name)
        );

        markers.push({
          from: basePos + offset,
          to: basePos + offset + child.nodeSize,
          text: child.text || "",
          syntaxType: syntaxMark.attrs.syntaxType,
          semanticMark: semanticMark?.type.name || null,
        });
      }
    }
    offset += child.nodeSize;
  });

  return markers;
}

/**
 * 检查语法标记是否成对
 * 返回需要移除 marks 的范围
 */
function findUnpairedMarkers(
  node: Node,
  basePos: number
): Array<{ from: number; to: number; markType: string }> {
  const markers = collectSyntaxMarkers(node, basePos);
  const invalidRanges: Array<{ from: number; to: number; markType: string }> = [];

  // 按语法类型分组
  const markersByType: Map<string, SyntaxMarkerInfo[]> = new Map();
  for (const marker of markers) {
    const key = marker.syntaxType;
    if (!markersByType.has(key)) {
      markersByType.set(key, []);
    }
    markersByType.get(key)!.push(marker);
  }

  // 检查每种语法类型的标记是否成对
  for (const [syntaxType, typeMarkers] of markersByType) {
    const syntaxDef = SYNTAX_DEFS.find((s) => s.markType === syntaxType);
    if (!syntaxDef) continue;

    // 按位置排序
    typeMarkers.sort((a, b) => a.from - b.from);

    // 检查是否成对（相同的标记文本）
    const stack: SyntaxMarkerInfo[] = [];
    const paired: Set<SyntaxMarkerInfo> = new Set();

    for (const marker of typeMarkers) {
      // 检查是否可以与栈顶配对
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.text === marker.text && syntaxDef.markers.includes(marker.text)) {
          // 配对成功
          paired.add(top);
          paired.add(marker);
          stack.pop();
          continue;
        }
      }
      // 入栈
      stack.push(marker);
    }

    // 未配对的标记需要移除 marks
    for (const marker of typeMarkers) {
      if (!paired.has(marker)) {
        // 找到这个标记所在的整个语义区域
        const region = findSemanticRegion(node, basePos, marker, syntaxType);
        if (region) {
          invalidRanges.push(region);
        }
      }
    }
  }

  return invalidRanges;
}

/**
 * 找到语法标记所在的整个语义区域
 */
function findSemanticRegion(
  node: Node,
  basePos: number,
  marker: SyntaxMarkerInfo,
  markType: string
): { from: number; to: number; markType: string } | null {
  let regionStart = -1;
  let regionEnd = -1;
  let offset = 0;

  node.forEach((child) => {
    if (child.isText) {
      const hasMark = child.marks.some((m) => m.type.name === markType);
      if (hasMark) {
        const childStart = basePos + offset;
        const childEnd = basePos + offset + child.nodeSize;

        // 检查是否与 marker 相邻或重叠
        if (childEnd >= marker.from && childStart <= marker.to) {
          if (regionStart === -1) regionStart = childStart;
          regionEnd = childEnd;
        } else if (regionStart !== -1 && childStart === regionEnd) {
          // 扩展区域
          regionEnd = childEnd;
        }
      }
    }
    offset += child.nodeSize;
  });

  // 重新扫描，找到完整的连续区域
  offset = 0;
  regionStart = -1;
  regionEnd = -1;
  let foundMarker = false;

  node.forEach((child) => {
    if (child.isText) {
      const hasMark = child.marks.some((m) => m.type.name === markType);
      const childStart = basePos + offset;
      const childEnd = basePos + offset + child.nodeSize;

      if (hasMark) {
        if (regionStart === -1) {
          regionStart = childStart;
        }
        regionEnd = childEnd;

        // 检查是否包含目标 marker
        if (childStart <= marker.from && childEnd >= marker.to) {
          foundMarker = true;
        }
      } else if (regionStart !== -1 && foundMarker) {
        // 区域结束，且已找到 marker
        return false;
      } else if (regionStart !== -1) {
        // 区域结束，但未找到 marker，重置
        regionStart = -1;
        regionEnd = -1;
      }
    }
    offset += child.nodeSize;
  });

  if (regionStart !== -1 && regionEnd !== -1 && foundMarker) {
    return { from: regionStart, to: regionEnd, markType };
  }

  return null;
}

/**
 * 创建语法修复插件
 */
export function createSyntaxFixerPlugin(): Plugin {
  return new Plugin({
    key: syntaxFixerPluginKey,

    appendTransaction(transactions, oldState, newState) {
      // 只在文档变化时处理
      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged) return null;

      const invalidRanges: Array<{ from: number; to: number; markType: string }> = [];

      // 遍历所有文本块
      newState.doc.descendants((node, pos) => {
        if (node.isTextblock) {
          const ranges = findUnpairedMarkers(node, pos + 1);
          invalidRanges.push(...ranges);
        }
        return true;
      });

      if (invalidRanges.length === 0) return null;

      // 去重
      const uniqueRanges = invalidRanges.filter(
        (range, index, self) =>
          index ===
          self.findIndex(
            (r) => r.from === range.from && r.to === range.to && r.markType === range.markType
          )
      );

      // 创建事务移除无效的 marks
      let tr = newState.tr;
      for (const range of uniqueRanges) {
        const markType = newState.schema.marks[range.markType];
        if (markType) {
          tr = tr.removeMark(range.from, range.to, markType);
        }
        // 同时移除 syntax_marker
        const syntaxMarkerType = newState.schema.marks.syntax_marker;
        if (syntaxMarkerType) {
          tr = tr.removeMark(range.from, range.to, syntaxMarkerType);
        }
      }

      return tr.docChanged ? tr : null;
    },
  });
}

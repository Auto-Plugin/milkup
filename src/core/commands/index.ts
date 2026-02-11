/**
 * Milkup 编辑器命令
 *
 * 提供常用的编辑操作命令
 */

import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import { Node, Mark, MarkType, NodeType } from "prosemirror-model";
import { toggleMark, setBlockType, wrapIn, lift } from "prosemirror-commands";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/**
 * 切换粗体
 */
export function toggleStrong(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.strong;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换斜体
 */
export function toggleEmphasis(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.emphasis;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换行内代码
 */
export function toggleCodeInline(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const markType = state.schema.marks.code_inline;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换删除线
 */
export function toggleStrikethrough(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const markType = state.schema.marks.strikethrough;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换高亮
 */
export function toggleHighlight(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.highlight;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 设置标题级别
 */
export function setHeading(level: number): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.heading;
    if (!nodeType) return false;
    return setBlockType(nodeType, { level })(state, dispatch);
  };
}

/**
 * 设置为段落
 */
export function setParagraph(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const nodeType = state.schema.nodes.paragraph;
  if (!nodeType) return false;
  return setBlockType(nodeType)(state, dispatch);
}

/**
 * 设置为代码块
 */
export function setCodeBlock(language = ""): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.code_block;
    if (!nodeType) return false;
    return setBlockType(nodeType, { language })(state, dispatch);
  };
}

/**
 * 包装为引用块
 */
export function wrapInBlockquote(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.blockquote;
  if (!nodeType) return false;
  return wrapIn(nodeType)(state, dispatch);
}

/**
 * 包装为无序列表
 */
export function wrapInBulletList(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.bullet_list;
  if (!nodeType) return false;
  return wrapIn(nodeType)(state, dispatch);
}

/**
 * 包装为有序列表
 */
export function wrapInOrderedList(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.ordered_list;
  if (!nodeType) return false;
  return wrapIn(nodeType)(state, dispatch);
}

/**
 * 取消包装（提升）
 */
export function liftBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  return lift(state, dispatch);
}

/**
 * 插入分隔线
 */
export function insertHorizontalRule(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.horizontal_rule;
  if (!nodeType) return false;

  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(nodeType.create());
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 插入图片
 */
export function insertImage(src: string, alt = "", title = ""): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.image;
    if (!nodeType) return false;

    if (dispatch) {
      const node = nodeType.create({ src, alt, title });
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 插入链接
 */
export function insertLink(href: string, title = ""): Command {
  return (state, dispatch) => {
    const markType = state.schema.marks.link;
    if (!markType) return false;

    const { from, to, empty } = state.selection;

    if (dispatch) {
      const mark = markType.create({ href, title });
      let tr = state.tr;

      if (empty) {
        // 没有选中文本，插入链接文本
        const text = title || href;
        tr = tr.insertText(text, from);
        tr = tr.addMark(from, from + text.length, mark);
      } else {
        // 有选中文本，添加链接
        tr = tr.addMark(from, to, mark);
      }

      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 移除链接
 */
export function removeLink(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.link;
  if (!markType) return false;

  const { from, to } = state.selection;

  if (dispatch) {
    const tr = state.tr.removeMark(from, to, markType);
    dispatch(tr);
  }
  return true;
}

/**
 * 插入表格
 */
export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    const { table, table_row, table_header, table_cell, paragraph } = state.schema.nodes;
    if (!table || !table_row || !table_header || !table_cell) return false;

    if (dispatch) {
      const tableRows: Node[] = [];

      // 表头行
      const headerCells: Node[] = [];
      for (let c = 0; c < cols; c++) {
        headerCells.push(table_header.create(null, paragraph?.create()));
      }
      tableRows.push(table_row.create(null, headerCells));

      // 数据行
      for (let r = 1; r < rows; r++) {
        const cells: Node[] = [];
        for (let c = 0; c < cols; c++) {
          cells.push(table_cell.create(null, paragraph?.create()));
        }
        tableRows.push(table_row.create(null, cells));
      }

      const tableNode = table.create(null, tableRows);
      const tr = state.tr.replaceSelectionWith(tableNode);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 查找光标所在的表格上下文
 */
function findTableContext(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") {
      // 找到 table_row 和 table_cell 的 depth
      let rowDepth = -1;
      let cellDepth = -1;
      for (let d = $from.depth; d > depth; d--) {
        const n = $from.node(d);
        if (n.type.name === "table_row") rowDepth = d;
        if (n.type.name === "table_cell" || n.type.name === "table_header") cellDepth = d;
      }
      if (rowDepth === -1 || cellDepth === -1) return null;
      const rowIndex = $from.index(depth);
      const cellIndex = $from.index(rowDepth);
      return {
        tableDepth: depth,
        tableStart: $from.before(depth),
        tableNode: node,
        rowDepth,
        rowIndex,
        cellDepth,
        cellIndex,
      };
    }
  }
  return null;
}

/**
 * 创建一行新的 cells
 */
function createRow(state: EditorState, colCount: number, useHeader: boolean): Node {
  const { table_row, table_header, table_cell, paragraph } = state.schema.nodes;
  const cellType = useHeader ? table_header : table_cell;
  const cells: Node[] = [];
  for (let i = 0; i < colCount; i++) {
    cells.push(cellType.create(null, paragraph.create()));
  }
  return table_row.create(null, cells);
}

/**
 * 在当前行上方插入一行
 */
export function addRowBefore(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { $from } = state.selection;
    const rowPos = $from.before(ctx.rowDepth);
    const colCount = ctx.tableNode.child(0).childCount;
    const newRow = createRow(state, colCount, false);
    dispatch(state.tr.insert(rowPos, newRow).scrollIntoView());
  }
  return true;
}

/**
 * 在当前行下方插入一行
 */
export function addRowAfter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { $from } = state.selection;
    const rowPos = $from.after(ctx.rowDepth);
    const colCount = ctx.tableNode.child(0).childCount;
    const newRow = createRow(state, colCount, false);
    dispatch(state.tr.insert(rowPos, newRow).scrollIntoView());
  }
  return true;
}

/**
 * 在表格末尾追加一行
 */
export function addRowAtEnd(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const tableEnd = ctx.tableStart + ctx.tableNode.nodeSize - 1;
    const colCount = ctx.tableNode.child(0).childCount;
    const newRow = createRow(state, colCount, false);
    dispatch(state.tr.insert(tableEnd, newRow).scrollIntoView());
  }
  return true;
}

/**
 * 在当前列左侧插入一列
 */
export function addColumnBefore(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { paragraph, table_header, table_cell } = state.schema.nodes;
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1; // 进入 table 内部
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset, rowIndex) => {
      const isHeaderRow = rowIndex === 0;
      const cellType = isHeaderRow ? table_header : table_cell;
      const newCell = cellType.create(null, paragraph.create());
      // 找到该行中第 cellIndex 个 cell 的位置
      let cellPos = tableStart + rowOffset + 1; // +1 进入 row 内部
      for (let c = 0; c < ctx.cellIndex; c++) {
        cellPos += row.child(c).nodeSize;
      }
      tr = tr.insert(cellPos + offset, newCell);
      offset += newCell.nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 在当前列右侧插入一列
 */
export function addColumnAfter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { paragraph, table_header, table_cell } = state.schema.nodes;
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1;
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset, rowIndex) => {
      const isHeaderRow = rowIndex === 0;
      const cellType = isHeaderRow ? table_header : table_cell;
      const newCell = cellType.create(null, paragraph.create());
      let cellPos = tableStart + rowOffset + 1;
      for (let c = 0; c <= ctx.cellIndex; c++) {
        cellPos += row.child(c).nodeSize;
      }
      tr = tr.insert(cellPos + offset, newCell);
      offset += newCell.nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 在表格最右侧追加一列
 */
export function addColumnAtEnd(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { paragraph, table_header, table_cell } = state.schema.nodes;
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1;
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset, rowIndex) => {
      const isHeaderRow = rowIndex === 0;
      const cellType = isHeaderRow ? table_header : table_cell;
      const newCell = cellType.create(null, paragraph.create());
      // 插入到行末尾（row 结束标签前）
      const rowEnd = tableStart + rowOffset + row.nodeSize - 1;
      tr = tr.insert(rowEnd + offset, newCell);
      offset += newCell.nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 删除当前行
 */
export function deleteRow(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  // 至少保留一行
  if (ctx.tableNode.childCount <= 1) return false;
  if (dispatch) {
    const { $from } = state.selection;
    const rowStart = $from.before(ctx.rowDepth);
    const rowEnd = $from.after(ctx.rowDepth);
    dispatch(state.tr.delete(rowStart, rowEnd).scrollIntoView());
  }
  return true;
}

/**
 * 删除当前列
 */
export function deleteColumn(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  // 至少保留一列
  if (ctx.tableNode.child(0).childCount <= 1) return false;
  if (dispatch) {
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1;
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset) => {
      let cellPos = tableStart + rowOffset + 1;
      for (let c = 0; c < ctx.cellIndex; c++) {
        cellPos += row.child(c).nodeSize;
      }
      const cellEnd = cellPos + row.child(ctx.cellIndex).nodeSize;
      tr = tr.delete(cellPos + offset, cellEnd + offset);
      offset -= row.child(ctx.cellIndex).nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 插入数学块
 */
export function insertMathBlock(content = ""): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.math_block;
    if (!nodeType) return false;

    if (dispatch) {
      const node = nodeType.create({ content });
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 插入容器
 */
export function insertContainer(type = "note", title = ""): Command {
  return (state, dispatch) => {
    const { container, paragraph } = state.schema.nodes;
    if (!container) return false;

    if (dispatch) {
      const node = container.create({ type, title }, paragraph?.create());
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export const commands = {
  toggleStrong,
  toggleEmphasis,
  toggleCodeInline,
  toggleStrikethrough,
  toggleHighlight,
  setHeading,
  setParagraph,
  setCodeBlock,
  wrapInBlockquote,
  wrapInBulletList,
  wrapInOrderedList,
  liftBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  removeLink,
  insertTable,
  addRowBefore,
  addRowAfter,
  addRowAtEnd,
  addColumnBefore,
  addColumnAfter,
  addColumnAtEnd,
  deleteRow,
  deleteColumn,
  insertMathBlock,
  insertContainer,
};

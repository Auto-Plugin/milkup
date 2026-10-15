import { definePlugin } from '@milkup/plugin-sdk'
import type {
  SdkPluginCommandHandler,
  SdkPluginRendererContext,
  SdkRendererOutput,
} from '@milkup/plugin-sdk'
import { createController, type State } from './controller'

let controller: ReturnType<typeof createController> | undefined
let modalVisible = false
let toolbarSignature = ''
let contextVisible = false
let modalEditable = true
export const formatActions = [
  ['heading1', '一级标题'],
  ['heading2', '二级标题'],
  ['heading3', '三级标题'],
  ['heading4', '四级标题'],
  ['heading5', '五级标题'],
  ['heading6', '六级标题'],
  ['bold', '粗体'],
  ['italic', '斜体'],
  ['strike', '删除线'],
  ['bullet', '无序列表'],
  ['ordered', '有序列表'],
  ['task', '任务列表'],
  ['quote', '引用'],
  ['inlineCode', '行内代码'],
  ['fence', '代码块'],
] as const
export const tableActions = [
  ['tableAddRow', '下方加行', 'add-row'],
  ['tableDeleteRow', '删除行', 'delete-row'],
  ['tableAddColumn', '右侧加列', 'add-column'],
  ['tableDeleteColumn', '删除列', 'delete-column'],
  ['tableAlignLeft', '列左对齐', 'align-left'],
  ['tableAlignCenter', '列居中', 'align-center'],
  ['tableAlignRight', '列右对齐', 'align-right'],
  ['tableAlignDefault', '清除列对齐', 'align-default'],
  ['tableClearCell', '清空单元格', 'clear-cell'],
  ['tableSelectCell', '选中单元格', 'select-cell'],
  ['tableSelect', '选中表格', 'select-table'],
  ['tableExit', '退出表格', 'exit'],
] as const
const commands: Record<string, SdkPluginCommandHandler> = {
  'formatting.open': async (context) => {
    await context.host?.ui?.open('formatting-modal')
  },
  'formatting.link': async (context) => {
    await context.host?.ui?.open('formatting-modal')
  },
  'formatting.field': (_context, input) => controller?.field(input),
  'formatting.refresh': () => controller?.load(),
  'formatting.applyLink': () => controller?.execute('link', true),
  'formatting.unlink': (_context, input) => controller?.execute('unlink', isDraft(input)),
  'formatting.tableInsert': () => controller?.table('insert-table', true),
  'formatting.tableSetCell': () => controller?.table('set-cell', true),
}
for (const [id] of formatActions)
  commands[`formatting.${id}`] = (_context, input) => controller?.execute(id, isDraft(input))
for (const [id, , operation] of tableActions)
  commands[`formatting.${id}`] = (_context, input) => controller?.table(operation, isDraft(input))
function isDraft(input: unknown) {
  return !!input && typeof input === 'object' && 'draft' in input && input.draft === true
}
export default definePlugin({
  activate(context) {
    controller?.dispose()
    modalVisible = false
    toolbarSignature = ''
    contextVisible = false
    modalEditable = true
    const current = createController(context.host.editing, () => {
      if (current === controller) void context.host.ui?.requestUpdate().catch(() => undefined)
    })
    controller = current
    return {
      dispose() {
        current.dispose()
        if (controller === current) {
          controller = undefined
          modalVisible = false
          toolbarSignature = ''
          contextVisible = false
        }
      },
    }
  },
  deactivate() {
    controller?.dispose()
    controller = undefined
    modalVisible = false
    toolbarSignature = ''
    contextVisible = false
  },
  commands,
  renderers: {
    'formatting-modal': (context: SdkPluginRendererContext) => {
      if (context.node?.phase === 'dispose') {
        modalVisible = false
        toolbarSignature = ''
        controller?.cancel()
        return ''
      }
      if (!modalVisible) {
        modalVisible = true
        if (context.node?.documentEditable !== false) void controller?.load()
      } else if (!modalEditable && context.node?.documentEditable !== false) {
        void controller?.load()
      }
      modalEditable = context.node?.documentEditable !== false
      return renderModal(stateFor(context))
    },
    'formatting-toolbar': (context: SdkPluginRendererContext) => {
      if (context.node?.phase === 'dispose') {
        toolbarSignature = ''
        return ''
      }
      const signature = JSON.stringify([
        context.node?.documentId,
        context.node?.documentVersion,
        context.node?.viewport,
        context.node?.viewMode,
        context.node?.selectionRevision,
        context.node?.documentEditable,
      ])
      if (!modalVisible && signature !== toolbarSignature) {
        toolbarSignature = signature
        if (context.node?.documentEditable !== false) void controller?.load()
      }
      return renderToolbar(stateFor(context))
    },
    'formatting-context': (context: SdkPluginRendererContext) => {
      if (context.node?.phase === 'dispose') {
        contextVisible = false
        return ''
      }
      const visible = context.node?.visible !== false
      if (visible && !contextVisible && !modalVisible && context.node?.documentEditable !== false)
        void controller?.load()
      contextVisible = visible
      // Hiding the menu after a click does not cancel that submitted command.
      return group([
        ...formatActions
          .filter(([id]) =>
            [
              'heading1',
              'heading2',
              'bold',
              'italic',
              'strike',
              'bullet',
              'task',
              'quote',
              'inlineCode',
            ].includes(id),
          )
          .map(([id, title]) => button(id, title, stateFor(context).busy)),
        ...(context.node?.documentEditable === false
          ? [text('文档只读或正在处理，格式操作暂不可用。')]
          : []),
        button('open', '更多格式与表格操作', false),
      ])
    },
  },
})
function stateFor(context: SdkPluginRendererContext): State {
  const state = controller?.state ?? initial()
  return context.node?.documentEditable === false
    ? { ...state, busy: true, error: '文档只读或正在处理，格式操作暂不可用。' }
    : state
}
function initial(): State {
  return { busy: true, fields: { url: 'https://', rows: '2', columns: '3', cell: '' } }
}
const text = (value: string, role?: string): SdkRendererOutput => ({
  type: 'element',
  tag: 'span',
  text: value,
  ...(role ? { attributes: { role } } : {}),
})
function button(id: string, title: string, disabled: boolean, draft = false): SdkRendererOutput {
  return {
    type: 'element',
    tag: 'button',
    text: title,
    disabled,
    attributes: { class: 'dialog-button secondary', 'aria-label': title },
    action: { command: `formatting.${id}`, ...(draft ? { input: { draft: true } } : {}) },
  }
}
function group(children: SdkRendererOutput[], className = 'plugin-actions'): SdkRendererOutput {
  return { type: 'element', tag: 'span', attributes: { class: className }, children }
}
function tableDisabled(state: State, operation: string): boolean {
  const table = state.snapshot?.table
  return (
    state.busy ||
    !table ||
    (!table.withinCell && !operation.startsWith('select-')) ||
    (operation === 'delete-row' && table.row === 0) ||
    (operation === 'delete-column' && table.columnCount <= 2)
  )
}
function tableDescription(state: State): string {
  const table = state.snapshot?.table
  if (!table) return '选区不在可编辑的完整表格中；进入单元格后可增删行列。'
  return `${table.row === 0 ? '表头' : `第 ${table.row} 行`} · 第 ${table.column + 1} 列。${!table.withinCell ? '请先选择单元格以修改结构。' : '表头不能删除，至少保留两列。'}`
}
export function renderToolbar(state: State): SdkRendererOutput {
  return group([
    button('open', '格式', false),
    button('bold', '粗体', state.busy || !state.snapshot),
    button('italic', '斜体', state.busy || !state.snapshot),
    ...(state.snapshot?.table
      ? [
          ...tableActions
            .filter(([, , op]) =>
              ['add-row', 'delete-row', 'add-column', 'delete-column', 'exit'].includes(op),
            )
            .map(([id, title, op]) => button(id, title, tableDisabled(state, op))),
        ]
      : []),
    ...(state.error ? [text('操作未完成，请打开“格式”查看详情。', 'alert')] : []),
  ])
}
export function renderModal(state: State): SdkRendererOutput {
  const disabled = state.busy || !state.snapshot
  const children: SdkRendererOutput[] = [
    text(
      '对当前选区或所在完整行应用格式。再次点击相同格式可取消。单次编辑最多 64 Ki UTF-16 文本、256 行；不确定语法时会保留原文并说明原因。',
    ),
    text(
      '复杂嵌套块、跨部分语法和代码内格式不直接转换。文本修改作为一次撤销步骤；选择表格不修改正文。',
    ),
    group(formatActions.map(([id, title]) => button(id, title, disabled, true))),
    { type: 'element', tag: 'strong', text: '链接' },
    {
      type: 'field',
      key: 'url',
      kind: 'text',
      label: '链接地址',
      value: state.fields.url,
      disabled: state.busy,
      placeholder: 'https://example.com 或 ./page.md',
      onChange: { command: 'formatting.field' },
    },
    button('applyLink', '应用链接', disabled, true),
    button('unlink', '取消链接', disabled, true),
    { type: 'element', tag: 'strong', text: '表格' },
    text(tableDescription(state)),
    group(tableActions.map(([id, title, op]) => button(id, title, tableDisabled(state, op), true))),
    {
      type: 'field',
      key: 'cell',
      kind: 'text',
      label: '单元格内容',
      value: state.fields.cell,
      disabled: state.busy,
      help: '替换当前单元格，管道符由宿主安全转义。',
      onChange: { command: 'formatting.field' },
    },
    button('tableSetCell', '替换单元格内容', tableDisabled(state, 'set-cell'), true),
    group(
      [
        {
          type: 'field',
          key: 'rows',
          kind: 'number',
          label: '表格正文行数',
          value: state.fields.rows,
          min: 1,
          max: 64,
          step: 1,
          disabled: state.busy,
          onChange: { command: 'formatting.field' },
        },
        {
          type: 'field',
          key: 'columns',
          kind: 'number',
          label: '表格列数',
          value: state.fields.columns,
          min: 1,
          max: 16,
          step: 1,
          disabled: state.busy,
          onChange: { command: 'formatting.field' },
        },
      ],
      'plugin-form',
    ),
    button('tableInsert', '插入表格', disabled, true),
  ]
  if (state.busy) children.push(text('正在读取或应用格式…', 'status'))
  if (state.error) children.push(text(state.error, 'alert'))
  if (state.message) children.push(text(state.message, 'status'))
  children.push(button('refresh', '重新读取选区', state.busy))
  return group(children, 'plugin-ui-state')
}

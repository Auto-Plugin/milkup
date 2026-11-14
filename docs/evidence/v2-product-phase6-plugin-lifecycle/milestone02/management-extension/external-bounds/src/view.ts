import type { SdkRendererOutput as Output } from '@milkup/plugin-sdk'
import type { State } from './controller'
const text = (value: string): Output => ({ type: 'element', tag: 'span', text: value })
const group = (children: Output[], className?: string): Output => ({
  type: 'element',
  tag: 'span',
  children,
  ...(className ? { attributes: { class: className } } : {}),
})
const button = (command: string, label: string, disabled = false, input?: unknown): Output => ({
  type: 'element',
  tag: 'button',
  text: label,
  disabled,
  action: { command, ...(input === undefined ? {} : { input }) },
})
const field = (label: string, value: string) =>
  group([text(`${label}：`), text(value)], 'plugin-list-item')
const stateLabels = {
  enabled: '已启用',
  disabled: '已停用',
  failed: '运行失败',
  pending: '等待审阅',
  removed: '已卸载',
}
export function render(state: State): Output {
  const nodes: Output[] = []
  if (state.details) {
    const d = state.details,
      c = d.compatibility
    nodes.push(
      button('management.back', '返回插件列表', state.busy),
      { type: 'element', tag: 'strong', text: d.title },
      text(d.description),
    )
    nodes.push(
      field('版本', d.version),
      field('状态', stateLabels[d.state]),
      field('执行环境', d.host),
      field('目录代次', String(d.entryRevision)),
    )
    if (d.candidate)
      nodes.push(field('待审候选', d.candidate.version), field('候选指纹', d.candidate.fingerprint))
    nodes.push(
      field(
        '兼容性',
        c.compatible
          ? '满足当前宿主要求'
          : '不兼容；请选择适用于当前宿主的插件版本，或在宿主更新后重新检查。',
      ),
      field('宿主版本', c.hostVersion),
      field('SDK 版本', c.sdkVersion),
    )
    if (c.requiredHost) nodes.push(field('要求宿主', c.requiredHost))
    if (c.requiredSdk) nodes.push(field('要求 SDK', c.requiredSdk))
    for (const [label, diff] of [
      ['权限', d.permissions],
      ['网络范围', d.networkOrigins],
    ] as const) {
      nodes.push(
        field(`${label}声明`, diff.declared.join('、') || '无'),
        field(`${label}已批准`, diff.approved.join('、') || '无'),
      )
      if (diff.added.length) nodes.push(field(`${label}新增（需宿主审阅）`, diff.added.join('、')))
      if (diff.removed.length) nodes.push(field(`${label}移除`, diff.removed.join('、')))
    }
    if (d.approvedHost && d.approvedHost !== d.host)
      nodes.push(text(`执行环境从 ${d.approvedHost} 变为 ${d.host}，请在宿主详情中重新审阅。`))
    for (const diagnostic of d.diagnostics) nodes.push(field(diagnostic.code, diagnostic.message))
    if (d.state === 'failed')
      nodes.push(text('先在宿主详情中查看故障、停用或恢复选项；本扩展不会自动重新启用插件。'))
    if (d.settings) {
      nodes.push(text('设置说明（默认值，不含已保存的用户值）'))
      for (const [key, schema] of Object.entries(d.settings.schema)) {
        const bounds =
          schema.type === 'enum'
            ? `可选：${schema.options.join('、')}`
            : schema.type === 'number'
              ? `范围：${schema.minimum}–${schema.maximum}${schema.allowZero ? '；也可为 0' : ''}`
              : '布尔值'
        nodes.push(field(key, `${bounds}；默认：${String(d.settings.defaults[key])}`))
      }
    }
    nodes.push(text('安装、升级、回退、权限确认与数据保留由可信宿主处理。此页面只提供解释和导航。'))
    nodes.push(
      button('management.hostDetails', '打开宿主详情', state.busy),
      button('management.hostSettings', '打开宿主设置', state.busy || !d.settings),
    )
  } else {
    nodes.push(button('management.refresh', '刷新插件列表', state.busy))
    if (state.phase === 'loading') nodes.push(text('正在读取插件目录…'))
    else if (state.phase === 'ready' && !state.snapshot?.items.length)
      nodes.push(text('暂无已安装插件。'))
    for (const item of state.snapshot?.items ?? [])
      nodes.push({
        type: 'element',
        tag: 'button',
        disabled: state.busy,
        action: { command: 'management.details', input: { id: item.id } },
        attributes: { class: 'plugin-list-item', 'aria-label': item.title },
        children: [
          group([text(Array.from(item.title)[0] ?? '◇')], 'plugin-ui-state-icon'),
          { type: 'element', tag: 'strong', text: item.title },
          text(item.description || '暂无描述'),
        ],
      })
  }
  if (state.message)
    nodes.push({
      type: 'element',
      tag: 'span',
      text: state.message,
      attributes: { role: 'status' },
    })
  return group(nodes, 'plugin-list-panel')
}

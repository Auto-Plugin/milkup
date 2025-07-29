import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { NodeSpec, Node as ProseNode } from '@milkdown/prose/model'
import type { EditorView, NodeView } from '@milkdown/prose/view'

import { prosePluginsCtx } from '@milkdown/core'
import { Plugin, PluginKey } from '@milkdown/prose/state'

// 插件主体
export const rawHTML: MilkdownPlugin = (ctx) => {
  console.log('ctx::: ', ctx)
  return async () => {
    // 注册 rawHtml 节点
    // ctx.update(nodesCtx, (prev) => prev.concat({ name: 'rawHtml', spec: rawHtmlNode }));

    // 添加 ProseMirror 插件，挂载 NodeView
    const plugin = new Plugin({
      key: new PluginKey('MILKDOWN_RAW_HTML'),
      props: {
        nodeViews: {
          // @ts-ignore
          rawHtml: (node, view, getPos) => new RawHtmlView(node, view, getPos),
        },
      },
    })
    ctx.update(prosePluginsCtx, prev => prev.concat(plugin))
  }
}

class RawHtmlView implements NodeView {
  dom: HTMLElement
  node: ProseNode
  view: EditorView
  getPos: () => number

  constructor(node: ProseNode, view: EditorView, getPos: () => number) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = document.createElement('div')
    this.dom.setAttribute('data-raw-html', 'true')
    this.renderStatic()

    // 点击时替换为 code block
    this.dom.addEventListener('click', () => {
      const pos = this.getPos()
      if (pos === undefined)
        return
      const { state, dispatch } = this.view
      const { schema } = state
      const html = this.node.attrs.content
      // 创建 code_block 节点，语言设为 html
      const codeBlock = schema.nodes.code_block.create(
        { language: 'html' },
        schema.text(html),
      )
      // 替换当前 rawHtml 节点
      const tr = state.tr.replaceWith(pos, pos + this.node.nodeSize, codeBlock)
      dispatch(tr.scrollIntoView())
    })
  }

  // 渲染静态 HTML
  renderStatic() {
    this.dom.innerHTML = this.node.attrs.content
  }

  // 当节点更新时重新渲染
  update(node: ProseNode) {
    if (node.type !== this.node.type)
      return false
    this.node = node
    this.renderStatic()
    return true
  }
}

export const rawHtmlNode: NodeSpec = {
  group: 'block',
  atom: true,
  // 不直接支持子节点，由 attrs.content 持有 HTML 字符串
  content: '',
  attrs: {
    content: { default: '' }, // 存放原始 HTML
  },
  parseDOM: [
    {
      tag: 'div[data-raw-html]',
      getAttrs: (dom: HTMLElement) => ({
        content: dom.innerHTML,
      }),
    },
  ],
  toDOM: () => {
    // 使用 data-raw-html 属性标记，这里“0”表示插入内容占位
    return ['div', { 'data-raw-html': true }, 0]
  },
  parseMarkdown: {
    // 当遇到 mdast 中 type === 'html' 的节点时，使用该节点类型
    match: (node: { type: string }) => node.type === 'html',
    runner: (state: { addNode: (arg0: any, arg1: undefined, arg2: undefined, arg3: { content: any }) => void }, node: any, type: any) => {
      // 将原生 HTML 字符串填入 attrs.content
      state.addNode(type, undefined, undefined, { content: node.value })
    },
  },
  toMarkdown: {
    // 序列化时，将该节点输出为原始 HTML
    match: (node: { type: { name: string } }) => node.type.name === 'rawHtml',
    runner: (state: { addNode: (arg0: string, arg1: undefined, arg2: undefined, arg3: { value: any }) => void }, node: any) => {
      state.addNode('html', undefined, undefined, { value: node.attrs.content })
    },
  },
}

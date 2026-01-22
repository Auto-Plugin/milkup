import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/prose/model'
import type { EditorView, NodeViewConstructor } from '@milkdown/prose/view'
import type { RootContent } from 'mdast'
import type { Parent } from 'unist'
import { InputRule } from '@milkdown/prose/inputrules'
import { Plugin, Selection } from '@milkdown/prose/state'

import { $inputRule, $nodeAttr, $nodeSchema, $prose, $remark } from '@milkdown/utils'
import { visit } from 'unist-util-visit'
import { withMeta } from '../__internal__'
import { processImagePaths, reverseProcessImagePaths } from '../imagePathPlugin'

// 不转义 HTML 标签,即使输入 <div> 也能正常显示
export const escapeAngleBracketRule = $inputRule(
  () => new InputRule(
    /<([^>]+)>(.*)<\/([^>]+)>$/,
    (state, match, start, end) => {
      const [text] = match
      if (!text)
        return null

      // 将匹配到的 文本转换为 HTML 节点
      const tr = state.tr
      const nodeType = state.schema.nodes.html
      const attrs = { value: text }
      const node = nodeType.create(attrs, undefined, undefined)
      tr.replaceWith(start, end, node)
      // 设置光标位置在新插入的 HTML 节点后面
      const pos = start + node.nodeSize
      tr.setSelection(Selection.near(tr.doc.resolve(pos)))
      // 返回修改后的 transaction
      return tr
    },
    { inCode: false, inCodeMark: false }, // 禁止在代码块中使用
  ),
)

export function createHtmlNodeView(): NodeViewConstructor {
  return (node: ProseNode, view: EditorView, getPos) => {
    let editing = false
    const dom = document.createElement('div')
    dom.classList.add('html-block')
    dom.setAttribute('data-type', 'html')
    dom.setAttribute('contenteditable', 'true')

    const contentDOM = document.createElement('div')
    contentDOM.classList.add('html-source')
    contentDOM.setAttribute('contenteditable', 'true')

    const rendered = document.createElement('div')
    rendered.classList.add('html-rendered')
    rendered.setAttribute('data-rendered', 'true')
    rendered.innerHTML = node.attrs.value

    // 获取当前文件路径（用于路径转换）
    const getCurrentFilePath = (): string | null => {
      // 尝试从 DOM 中获取当前文件路径
      // 这里假设有一个全局的方式获取当前文件路径
      // 如果没有，可能需要通过其他方式传递
      try {
        // 从 view 的 state 中尝试获取
        const editorElement = view.dom.closest('[data-file-path]')
        if (editorElement) {
          return editorElement.getAttribute('data-file-path')
        }
        // 或者从全局状态获取
        return (window as any).__currentFilePath || null
      } catch {
        return null
      }
    }

    // 切换到编辑状态
    const enterEdit = () => {
      if (editing)
        return
      editing = true

      // 将 milkup:// 协议转回相对路径再显示
      const htmlContent = rendered.innerHTML
      const filePath = getCurrentFilePath()
      const restoredContent = reverseProcessImagePaths(htmlContent, filePath)

      // 更新编辑内容
      contentDOM.textContent = restoredContent
      dom.innerHTML = ''
      dom.appendChild(contentDOM)

      setTimeout(() => {
        view.focus()
        // ✅ 将光标移至最后
        const selection = window.getSelection()
        const range = document.createRange()

        const lastTextNode = contentDOM.firstChild
        if (lastTextNode) {
          const len = lastTextNode.textContent?.length ?? 0
          range.setStart(lastTextNode, len)
          range.setEnd(lastTextNode, len)
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      }, 0)
    }
    // 切换到渲染状态
    const exitEdit = () => {
      if (!editing)
        return
      editing = false

      // 获取用户编辑的内容（包含相对路径）
      const newValue = contentDOM.textContent

      // 将相对路径转换为 milkup:// 协议用于渲染
      const filePath = getCurrentFilePath()
      const processedValue = processImagePaths(newValue || '', filePath)

      // 构造并派发 transaction，更新节点 attrs.value
      // 注意：这里保存的是处理后的内容（包含 milkup://）
      const tr = view.state.tr
      tr.setNodeMarkup(
        getPos() as number, // 节点位置
        undefined, // 保持类型不变
        { value: processedValue }, // 更新 attrs（使用处理后的内容）
      )
      view.dispatch(tr)

      // 更新预览（使用处理后的内容）
      rendered.innerHTML = processedValue || ''
      dom.innerHTML = ''
      dom.appendChild(rendered)
    }

    // 点击进入编辑
    document.addEventListener('selectionchange', handleSelectionChange)
    function handleSelectionChange() {
      const selection = document.getSelection()
      if (!selection || !selection.anchorNode)
        return

      const anchorNode = selection.anchorNode
      const inThisNode = dom.contains(anchorNode)

      if (inThisNode && !editing) {
        requestAnimationFrame(() => enterEdit())
      } else if (!inThisNode && editing) {
        requestAnimationFrame(() => exitEdit())
      }
    }
    // 初始状态是渲染状态
    dom.appendChild(rendered)

    return {
      dom,
      contentDOM,
      update(updatedNode) {
        if (updatedNode.type !== node.type)
          return false
        if (!editing) {
          rendered.innerHTML = updatedNode.attrs.value
        }
        return true
      },
      ignoreMutation: () => editing,
      stopEvent: () => editing,
      destroy() {
        document.removeEventListener('selectionchange', handleSelectionChange)
      },
    }
  }
}

export const proseHtml = $prose(() => {
  return new Plugin({
    props: {
      nodeViews: {
        html: createHtmlNodeView(),
      },
      handleKeyDown(view, event) {
        const { selection } = view.state
        const node = selection.$anchor.node()
        if (node.type.name === 'html') {
          if (event.key === 'Enter') {
            // 在 html 节点内按下 Enter 键时，阻止默认行为，跳出当前段落，并在后面插入一个新的段落
            event.preventDefault()
            const { tr } = view.state
            const pos = selection.$anchor.end()

            tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
            view.dispatch(tr)
            return true
          }
        }

        return false
      },
    },

  })
})
// remark AST 会把行内元素标签单独分开即 `<span>text</span>` 会被拆分成三个节点,这里将相邻的 HTML 开始标签、文本节点和结束标签合并为一个 HTML 节点
export const remarkHtmlMerger = $remark('remarkHtmlMerger', () => () => (tree) => {
  visit(tree, (_node, _index, parent: Parent | undefined) => {
    if (!parent || !Array.isArray(parent.children))
      return

    const children = parent.children

    for (let i = 0; i < children.length - 2; i++) {
      const open = children[i] as any
      const text = children[i + 1] as any
      const close = children[i + 2] as any

      if (
        open.type === 'html'
        && text.type === 'text'
        && close.type === 'html'
      ) {
        const openTagMatch = open.value.match(/^<([a-z][\w\-]*)(?:\s[^<>]*)?>$/i)
        const closeTagMatch = close.value.match(/^<\/([a-z][\w\-]*)>$/i)

        if (
          openTagMatch
          && closeTagMatch
          && openTagMatch[1] === closeTagMatch[1]
        ) {
          // 合并为一个新的 html 节点
          const combinedNode: RootContent = {
            type: 'html',
            value: `${open.value}${text.value}${close.value}`,
          }

          children.splice(i, 3, combinedNode)
        }
      }
    }
  })
})
// 将紧邻的 HTML 节点的文本节点拆分开来
export const remarkHtmlSplitter = $remark('remarkHtmlSplitter', () => () => (tree) => {
  visit(tree, (node, index, parent) => {
    if (!parent || !('type' in node) || (node as any).type !== 'html')
      return
    if (!('children' in parent))
      return

    const value = (node as any).value as string
    const htmlMatch = value.match(/^<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*<\/\1>/i)
    if (!htmlMatch)
      return

    const htmlPart = htmlMatch[0]
    const rest = value.slice(htmlPart.length).trim()
    const newHtmlNode: RootContent = {
      type: 'html',
      value: htmlPart,
    }
    const newTextNode: RootContent | null = rest
      ? { type: 'text', value: rest }
      : null
    const children = (parent as any).children
    const newNodes: RootContent[] = [newHtmlNode]
    if (newTextNode)
      newNodes.push(newTextNode)
    children.splice(index!, 1, ...newNodes)
  })
})

export const htmlAttr = $nodeAttr('html')

withMeta(htmlAttr, {
  displayName: 'Attr<html>',
  group: 'Html',
})
export const htmlSchema = $nodeSchema('html', (ctx) => {
  ctx.inject(htmlAttr.key)
  return {
    inline: true,
    code: true,
    group: 'inline',
    content: 'text*',
    attrs: {
      value: {
        default: '',
        validate: 'string',
      },
    },
    parseMarkdown: {
      match: ({ type }) => Boolean(type === 'html'),
      runner: (state, node, type) => {
        state.addNode(type, { value: (node.value as string) })
      },
    },
    toMarkdown: {
      match: node => node.type.name === 'html',
      runner: (state, node) => {
        state.addNode('html', undefined, node.attrs.value)
      },
    },
  }
})
export const htmlPlugin: MilkdownPlugin[] = [htmlSchema, remarkHtmlMerger, remarkHtmlSplitter, proseHtml, escapeAngleBracketRule].flat()

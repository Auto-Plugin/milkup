<script setup lang="ts">
import { basicSetup, EditorView } from '@codemirror/basic-setup'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, Prec } from '@codemirror/state'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import useSourceCode from '@/hooks/useSourceCode'
import useTab from '@/hooks/useTab'

interface MdSpan {
  type: 'link' | 'image'
  start: number
  end: number
  textStart: number
  textEnd: number
  raw: string
  text: string
  url: string
}

const props = defineProps<{
  modelValue: string
  readOnly: boolean | undefined
}>()
const emit = defineEmits(['update:modelValue'])
const { toggleSourceCode } = useSourceCode()
const { currentTab } = useTab()
// 禁用注释快捷键 Ctrl-/Cmd-/
const blockCtrlSlashDOM = Prec.highest(
  EditorView.domEventHandlers({
    keydown: (e, _view) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        toggleSourceCode()
        return true
      }
      return false
    },
  }),
)

const editorContainer = ref<HTMLElement>()
let editorView: EditorView | null = null

onMounted(() => {
  const startState = EditorState.create({
    doc: props.modelValue,
    extensions: [
      blockCtrlSlashDOM,
      basicSetup,
      markdown(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
        // 获取 cm 光标
        if (update.selectionSet) {
          const pos = update.state.selection.main
          const milkdownOffset = calcMilkOffset(update.state.doc.toString(), pos.head)
          currentTab.value!.milkdownCursorOffset = milkdownOffset
          currentTab.value!.codeMirrorCursorOffset = pos.head
        }
      }),
      EditorView.lineWrapping,
      EditorView.editable.of(!props.readOnly),
    ],
  })

  editorView = new EditorView({
    state: startState,
    parent: editorContainer.value!,
  })
  editorView.dispatch({
    selection: { anchor: currentTab.value?.codeMirrorCursorOffset || 0 },
    scrollIntoView: true,
  })
})
// 同步外部 props 变化
watch(() => props.modelValue, (newVal) => {
  if (editorView && editorView.state.doc.toString() !== newVal) {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: newVal,
      },
    })
  }
})

// 清理
onBeforeUnmount(() => {
  editorView?.destroy()
})
function toMilkdownApproxText(md: string): string {
  return md
    // 删除标题符号（#、空格）
    .replace(/^#+\s*/gm, '')
    // 删除强调符（*、_、~、`）
    .replace(/[*_~`]+/g, '')
    // 链接 [text](url) -> 'a'
    .replace(/\[.*?\]\(.*?\)/g, 'a')
    // 图片 ![alt](url) -> 'a'
    .replace(/!\[.*?\]\(.*?\)/g, 'a')
    // 引用符号 >
    .replace(/^\s*>+\s?/gm, '')
    // 列表项符号 -, *, 1.
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    // 表格符号
    .replace(/\|/g, '')
    // 删除行尾多余空格
    .trim()
}
function findMdSpans(md: string): MdSpan[] {
  const spans: MdSpan[] = []
  // eslint-disable-next-line regexp/no-unused-capturing-group
  const regex = /!?(\[([^\]]*)\])\(([^)]+)\)/g
  let match
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(md)) !== null) {
    const isImage = match[0].startsWith('!')
    const start = match.index
    const end = regex.lastIndex
    const textStart = start + (isImage ? 2 : 1)
    const textEnd = textStart + match[2].length
    spans.push({
      type: isImage ? 'image' : 'link',
      start,
      end,
      textStart,
      textEnd,
      raw: match[0],
      text: match[2],
      url: match[3],
    })
  }
  return spans
}
function calcMilkOffset(md: string, cmOffset: number): number {
  const spans = findMdSpans(md)
  let milkOffset = 0
  let pos = 0

  for (const span of spans) {
    if (cmOffset < span.start) {
      // 光标在此 span 前 → 累积前面文本
      milkOffset += toMilkdownApproxText(md.slice(pos, cmOffset)).length
      return milkOffset
    }

    if (cmOffset >= span.start && cmOffset <= span.end) {
      // 光标在某个链接/图片语法中间
      if (cmOffset <= span.textEnd) {
        // 光标在 [text] 内部，按 text 内位置算
        const insideTextOffset = cmOffset - span.textStart
        milkOffset += toMilkdownApproxText(md.slice(pos, span.start)).length + insideTextOffset
      } else {
        // 光标在 (url) 内或后面 → 视为整个节点末尾
        milkOffset += toMilkdownApproxText(md.slice(pos, span.start)).length + 1
      }
      return milkOffset
    }

    // 光标在此 span 之后
    milkOffset += toMilkdownApproxText(md.slice(pos, span.start)).length + 1 // 链接/图片视作一个
    pos = span.end
  }

  // 光标在最后
  milkOffset += toMilkdownApproxText(md.slice(pos, cmOffset)).length
  return milkOffset
}
</script>

<template>
  <div id="codemirror" ref="editorContainer" class="editor-container" />
</template>

<style scoped>
.editor-container {
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.5;
  height: 100%;
  width: 100%;
  overflow: auto;
}
</style>

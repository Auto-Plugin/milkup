<script setup lang="ts">
import { basicSetup, EditorView } from '@codemirror/basic-setup'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import useContent from '@/hooks/useContent'

const props = defineProps <{
  modelValue: string
  readOnly: boolean | undefined
}> ()
const emit = defineEmits(['update:modelValue'])

// 禁用注释快捷键 Ctrl-/Cmd-/
const disableCommentKeymap = keymap.of([{ key: 'Mod-/', run: () => true }])

const editorContainer = ref <HTMLElement> ()
const { currentScrollRatio, initScrollListener } = useContent()
let editorView: EditorView | null = null

onMounted(() => {
  const startState = EditorState.create({
    doc: props.modelValue,
    extensions: [
      basicSetup,
      disableCommentKeymap,
      markdown(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
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
  initScrollListener()
  if (currentScrollRatio.value > 0) {
    const el = document.querySelector('.cm-scroller')
    if (!el)
      return
    const scrollHeight = el.scrollHeight || 0
    const targetScrollTop = scrollHeight * currentScrollRatio.value
    el.scrollTop = targetScrollTop
  }
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

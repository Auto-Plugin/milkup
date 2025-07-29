<script setup lang="ts">
import { basicSetup, EditorView } from '@codemirror/basic-setup'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits(['update:modelValue'])

const editorContainer = ref<HTMLElement>()
let editorView: EditorView | null = null

onMounted(() => {
  const startState = EditorState.create({
    doc: props.modelValue,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      }),
      EditorView.lineWrapping,
    ],
  })

  editorView = new EditorView({
    state: startState,
    parent: editorContainer.value!,
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
</script>

<template>
  <div ref="editorContainer" class="editor-container" />
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

import { ref } from 'vue'

// 编辑器实例 key，用于触发编辑器重新渲染
const editorKey = ref(0)

export function useContext() {
  // 重新加载编辑器（通过改变key强制重建）
  function reloadEditor() {
    editorKey.value += 1
  }

  return {
    editorKey,
    reloadEditor,
  }
}

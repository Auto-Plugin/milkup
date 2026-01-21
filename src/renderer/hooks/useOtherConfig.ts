import { computed, nextTick } from 'vue'
import { useConfig } from './useConfig'

// 编辑器内边距 CSS 变量
const EDITOR_PADDING_CSS_VAR = '--milkup-editor-padding'

// 获取配置管理实例
const { config, getConf, setConf } = useConfig()

// 当前其他配置（直接使用响应式的 config）
const currentOtherConfig = computed(() => config.value.other)

// 当前编辑器内边距
const currentEditorPadding = computed(() => currentOtherConfig.value.editorPadding)

// 初始化配置
function init() {
  // 应用当前编辑器内边距配置到 DOM
  const editorPadding = getConf('other').editorPadding
  console.log(editorPadding)

  applyEditorPadding(editorPadding)
}

// 设置编辑器内边距
function setEditorPadding(padding: string) {
  setConf('other', 'editorPadding', padding)
  applyEditorPadding(padding)
}

// 应用编辑器内边距
function applyEditorPadding(padding: string) {
  nextTick(() => {
    const fontRootElement = document.querySelector('#fontRoot') as HTMLElement

    if (!fontRootElement)
      return

    fontRootElement.style.setProperty(EDITOR_PADDING_CSS_VAR, padding)
  })
}

export default function useOtherConfig() {
  return {
    currentEditorPadding,
    currentOtherConfig,
    init,
    setEditorPadding,
  }
}

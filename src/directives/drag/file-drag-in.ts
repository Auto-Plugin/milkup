import type { Directive, DirectiveBinding } from 'vue'

interface FileDragOptions {
  onDrop?: (file: File) => void
}

interface FileDragElement extends HTMLElement {
  _fileDragOptions?: FileDragOptions
  _dragOverCount?: number
  _fileDragHandlers?: {
    handleDragEnter: (event: DragEvent) => void
    handleDragOver: (event: DragEvent) => void
    handleDragLeave: (event: DragEvent) => void
    handleDrop: (event: DragEvent) => void
  }
}

// 拖拽事件处理函数
function createDragHandlers(el: FileDragElement, options: FileDragOptions) {
  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    el._dragOverCount = (el._dragOverCount || 0) + 1
    el.classList.add('drag-over')
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    el._dragOverCount = Math.max(0, (el._dragOverCount || 0) - 1)

    if (el._dragOverCount === 0) {
      el.classList.remove('drag-over')
    }
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    el._dragOverCount = 0
    el.classList.remove('drag-over')

    const files = event.dataTransfer?.files
    if (!files || files.length === 0)
      return

    // 只取第一个文件
    const file = files[0]

    // 检查是否为JSON文件
    if (!file.name.toLowerCase().endsWith('.json')) {
      console.warn('只支持JSON文件')
      return
    }

    if (options.onDrop) {
      options.onDrop(file)
    }
  }

  return {
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}

// 文件拖拽指令
export const fileDragIn: Directive = {
  mounted(el: FileDragElement, binding: DirectiveBinding) {
    // 允许直接传入函数作为简写形式，也支持完整的配置对象
    let options: FileDragOptions
    if (typeof binding.value === 'function') {
      options = { onDrop: binding.value }
    } else {
      options = binding.value || {}
    }

    // 存储选项和状态
    el._fileDragOptions = options
    el._dragOverCount = 0

    // 创建事件处理函数
    const handlers = createDragHandlers(el, options)

    // 绑定事件监听器
    el.addEventListener('dragenter', handlers.handleDragEnter)
    el.addEventListener('dragover', handlers.handleDragOver)
    el.addEventListener('dragleave', handlers.handleDragLeave)
    el.addEventListener('drop', handlers.handleDrop)

    // 存储事件处理函数引用，用于清理
    el._fileDragHandlers = handlers
  },

  updated(el: FileDragElement, binding: DirectiveBinding) {
    // 允许直接传入函数作为简写形式，也支持完整的配置对象
    let options: FileDragOptions
    if (typeof binding.value === 'function') {
      options = { onDrop: binding.value }
    } else {
      options = binding.value || {}
    }
    el._fileDragOptions = options
  },

  beforeUnmount(el: FileDragElement) {
    if (el._fileDragHandlers) {
      const handlers = el._fileDragHandlers

      // 移除事件监听器
      el.removeEventListener('dragenter', handlers.handleDragEnter)
      el.removeEventListener('dragover', handlers.handleDragOver)
      el.removeEventListener('dragleave', handlers.handleDragLeave)
      el.removeEventListener('drop', handlers.handleDrop)

      // 清理引用
      delete el._fileDragHandlers
      delete el._fileDragOptions
      delete el._dragOverCount
    }

    // 移除样式类
    el.classList.remove('drag-over')
  },
}

// 导出指令名称
export const fileDragInName = 'file-drag-in'

// 默认导出
export default fileDragIn

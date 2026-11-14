import { definePlugin } from '@milkup/plugin-sdk'
import { createController } from './controller'
import { render } from './view'
let controller: ReturnType<typeof createController> | undefined
let visible = false
export default definePlugin({
  activate(context) {
    controller?.dispose()
    visible = false
    const current = createController(context.host.management, () => {
      if (visible && controller === current)
        void context.host.ui?.requestUpdate('management-panel').catch(() => {})
    })
    controller = current
    return {
      dispose() {
        current.dispose()
        if (controller === current) {
          controller = undefined
          visible = false
        }
      },
    }
  },
  deactivate() {
    controller?.dispose()
    controller = undefined
    visible = false
  },
  commands: {
    'management.refresh': () => controller?.refresh(),
    'management.details': (_context, input) => {
      if (input && typeof input === 'object' && 'id' in input && typeof input.id === 'string')
        return controller?.select(input.id)
    },
    'management.back': () => controller?.back(),
    'management.hostDetails': (context) =>
      controller?.openTrusted(context.host?.management, 'details'),
    'management.hostSettings': (context) =>
      controller?.openTrusted(context.host?.management, 'settings'),
  },
  renderers: {
    'management-panel': (context) => {
      if (context.node?.phase === 'dispose' || context.node?.visible === false) {
        visible = false
        controller?.close()
        return ''
      }
      if (!visible) {
        visible = true
        void controller?.refresh()
      }
      return controller ? render(controller.state) : '插件管理能力尚未就绪。'
    },
  },
})

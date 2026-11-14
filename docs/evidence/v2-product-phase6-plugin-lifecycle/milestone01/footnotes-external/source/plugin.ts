import { definePlugin } from '@milkup/plugin-sdk'
import { createFootnoteController } from './controller'
export default definePlugin({
  activate(context) {
    const document = context.host.document
    if (!document?.readWindow || !document.invalidatePresentation)
      throw new Error('Footnotes requires the SDK 0.3.3 document window host')
    const controller = createFootnoteController(document)
    return {
      documentRenderers: { footnotes: (request, options) => controller.render(request, options) },
      dispose: () => controller.dispose(),
    }
  },
})

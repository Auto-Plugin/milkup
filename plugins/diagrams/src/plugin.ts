import { definePlugin } from '@milkup/plugin-sdk'
import { prepareRenderer, renderDocuments } from './renderer'

export default definePlugin({
  async activate() {
    await prepareRenderer()
    return { documentRenderers: { 'diagrams.mermaid': renderDocuments } }
  },
})

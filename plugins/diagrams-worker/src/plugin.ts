import { definePlugin } from '@milkup/plugin-sdk'
import { renderDocuments } from './renderer'
export default definePlugin({
  activate() {
    return { documentRenderers: { 'diagrams.mermaid': renderDocuments } }
  },
})

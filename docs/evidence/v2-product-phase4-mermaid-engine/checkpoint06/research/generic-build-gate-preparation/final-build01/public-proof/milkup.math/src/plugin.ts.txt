import { definePlugin } from '@milkup/plugin-sdk'
import { renderMathDocument } from './renderer'

export default definePlugin({ documentRenderers: { 'math.document': renderMathDocument } })

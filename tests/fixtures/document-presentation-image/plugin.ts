import {
  definePlugin,
  type SdkDocumentRenderer,
  type SdkDocumentSvgImage,
} from '@milkup/plugin-sdk'

/** Test-only transport/lifecycle fixture. This is not a Mermaid parser or engine. */
const image: SdkDocumentSvgImage = {
  type: 'svg-image',
  profile: 'bounded-svg-v1',
  motion: 'static',
  width: 600,
  height: 260,
  viewBox: [0, 0, 600, 260],
  rasterBounds: [0, 0, 600, 260],
  aspect: { align: 'xMidYMid', fit: 'meet' },
  title: 'Controlled document image fixture',
  styles: [
    { fill: { kind: 'color', rgba: [220, 235, 255, 1] } },
    {
      fill: { kind: 'color', rgba: [20, 35, 55, 1] },
      fontId: 'sans',
      fontSize: { value: 16, unit: 'px' },
    },
  ],
  definitions: [],
  children: [
    { kind: 'rect', style: 0, x: 8, y: 8, width: 584, height: 244 },
    {
      kind: 'text',
      style: 1,
      x: [{ value: 24, unit: 'user' }],
      y: [{ value: 46, unit: 'user' }],
      children: [{ kind: 'textRun', text: 'Controlled image fixture 中文😀' }],
    },
  ],
}
const render: SdkDocumentRenderer = (request) => {
  if (!request.contextKnown) return { complete: false, fragments: [] }
  return {
    complete: true,
    fragments: request.blocks
      .filter(
        (block) => block.kind === 'fence' && block.complete && block.info?.trim() === 'mermaid',
      )
      .map((block) => {
        const source = request.source.slice(block.from - request.from, block.to - request.from)
        if (source.includes('TEST_DOCUMENT_IMAGE_ERROR'))
          return {
            from: block.from,
            to: block.to,
            layout: 'block' as const,
            status: 'error' as const,
            accessibleText: 'Controlled fixture error; original source retained',
            message: 'Controlled fixture error; original source retained',
            content: { type: 'code' as const, children: [{ type: 'text' as const, text: source }] },
          }
        return {
          from: block.from,
          to: block.to,
          layout: 'block' as const,
          accessibleText: 'Controlled document image fixture',
          content: image,
        }
      }),
  }
}
export default definePlugin({ documentRenderers: { 'fixture.image': render } })

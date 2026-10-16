// Test package only. The shipped host has no knowledge of this fixture or its ID.
export default {
  activate(context) {
    const languages = new Set(context.manifest.contributes.documentRenderers[0].fenceLanguages)
    return {
      documentRenderers: {
        layout: async (request) => {
          const fence = request.blocks.find(
            (block) =>
              block.kind === 'fence' &&
              block.complete &&
              languages.has((block.info ?? '').trim().split(/\s+/)[0]),
          )
          if (!fence) return { fragments: [], complete: true }
          if (request.source.includes('LOOP_FOREVER')) {
            while (true) {
              // Deliberately non-cooperative renderer, terminated by native ownership.
            }
          }
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          const text = document.createElementNS(svg.namespaceURI, 'text')
          text.textContent = '真实 DOM 中文 😀'
          svg.append(text)
          document.body.append(svg)
          await document.fonts.ready
          const box = text.getBBox()
          svg.remove()
          if (!(box.width > 0 && box.height > 0)) throw new Error('Native layout unavailable')
          return {
            fragments: [
              {
                from: fence.from,
                to: fence.to,
                layout: 'block',
                content: { type: 'text', text: 'DOM lifecycle ready' },
                accessibleText: 'DOM lifecycle ready',
              },
            ],
            complete: true,
          }
        },
      },
    }
  },
}

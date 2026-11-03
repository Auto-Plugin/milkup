// Product-private fixed bootstrap. Diagram text is JSON data, never browser code.
;(() => {
  'use strict'
  const host = chrome.webview
  const policyObservations = []
  const MAX_AXIS = 8192
  const MAX_PIXELS = 16777216
  document.addEventListener('securitypolicyviolation', (event) => {
    if (policyObservations.length < 16)
      policyObservations.push({
        directive: event.effectiveDirective.slice(0, 100),
        blockedURI: event.blockedURI.slice(0, 160),
      })
  })
  let consumed = false
  let rendered = false
  let strippedLinkTargets = 0
  const send = (value) => host.postMessage(value)
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
  const finiteBox = (box) =>
    box &&
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.width >= 0 &&
    box.height >= 0

  function liftC4Labels(svg, background, theme) {
    if (!svg.querySelector('.c4-shape')) return 0
    let count = 0
    const ink = theme === 'dark' ? '#e2e4e9' : '#444444'
    // C4's built-in relationship palette does not follow Mermaid's dark theme.
    for (const path of svg.querySelectorAll('marker path')) {
      if (getComputedStyle(path).fill !== 'none') path.style.setProperty('fill', ink, 'important')
      if (getComputedStyle(path).stroke !== 'none')
        path.style.setProperty('stroke', ink, 'important')
    }
    // Mermaid 12.2.0 emits C4 relationships as a line plus direct text children.
    // Keep component/type labels untouched and retain the official line endpoints.
    for (const line of svg.querySelectorAll('line')) {
      line.style.setProperty('stroke', ink, 'important')
      const group = line.parentElement
      for (const label of [...group.children].filter((node) => node.localName === 'text')) {
        label.style.setProperty('fill', ink, 'important')
        const box = label.getBBox()
        if (!finiteBox(box) || box.width <= 0 || box.height <= 0) continue
        const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        wrapper.setAttribute('data-milkup-c4-label', '')
        wrapper.setAttribute('transform', `translate(0 ${-(box.height / 2 + 6)})`)
        group.insertBefore(wrapper, label)
        wrapper.appendChild(label)
        // The opaque backing also protects diagonal relationships. A text stroke
        // alone can leave line ink visible in spaces and counters between glyphs.
        const bounds = wrapper.getBBox()
        const backing = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        backing.setAttribute('x', String(bounds.x - 3))
        backing.setAttribute('y', String(bounds.y - 2))
        backing.setAttribute('width', String(bounds.width + 6))
        backing.setAttribute('height', String(bounds.height + 4))
        backing.setAttribute('rx', '2')
        backing.style.setProperty('fill', background, 'important')
        backing.style.setProperty('stroke', 'none', 'important')
        wrapper.insertBefore(backing, label)
        count++
      }
    }
    return count
  }

  function measureNaturalOutput(svg, target) {
    // Most Mermaid diagrams have width="100%" and max-width equal to their
    // natural viewBox width. Measuring that constrained rectangle compresses an
    // arbitrarily wide diagram into the editor's width. Preserve SVG user units
    // as CSS pixels instead; the product owns horizontal scrolling of the PNG.
    const original = svg.viewBox.baseVal
    const box = svg.getBBox()
    if (!finiteBox(box) || !finiteBox(original)) throw new Error('Invalid SVG geometry')
    const boxes = [box]
    // C4 reserves a large positive-coordinate outer canvas even for tiny graphs.
    // Its actual bbox already includes every node, relationship endpoint and
    // adjusted label/backing. Crop that specific renderer to content plus padding.
    const cropC4 = Boolean(svg.querySelector('.c4-shape'))
    if (!cropC4 && original.width > 0 && original.height > 0) boxes.push(original)
    let left = Math.min(...boxes.map((value) => value.x))
    let top = Math.min(...boxes.map((value) => value.y))
    let right = Math.max(...boxes.map((value) => value.x + value.width))
    let bottom = Math.max(...boxes.map((value) => value.y + value.height))
    // Other diagrams retain the renderer's viewBox (markers/layout padding)
    // together with content bounds. C4's marker tips fit inside the 16px padding.
    // Padding covers ordinary strokes/shadows. It is not a universal SVG filter
    // paint-bound proof; retained native pixels remain an acceptance requirement.
    const padding = 16
    left = Math.floor(left - padding)
    top = Math.floor(top - padding)
    right = Math.ceil(right + padding)
    bottom = Math.ceil(bottom + padding)
    const width = right - left
    const height = bottom - top
    if (
      ![width, height].every(Number.isFinite) ||
      width < 1 ||
      height < 1 ||
      width > MAX_AXIS ||
      height > MAX_AXIS ||
      width * height > MAX_PIXELS
    ) {
      throw new Error('Measured output exceeds pixel budget')
    }
    svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.style.setProperty('width', `${width}px`, 'important')
    svg.style.setProperty('height', `${height}px`, 'important')
    svg.style.setProperty('max-width', 'none', 'important')
    svg.style.setProperty('display', 'block', 'important')
    target.style.width = `${width}px`
    target.style.height = `${height}px`
    return { width, height, box }
  }

  host.addEventListener('message', async ({ data }) => {
    if (rendered && data?.phase === 'capture') {
      rendered = false
      await frame()
      await frame()
      const target = document.getElementById('target')
      send({
        phase: 'capture-ready',
        policyObservations,
        strippedLinkTargets,
        activeLinkElements: [...target.querySelectorAll('a')].filter(
          (a) => a.hasAttribute('href') || a.hasAttribute('xlink:href'),
        ).length,
        executableElements: target.querySelectorAll('script,iframe,object,embed').length,
        interactionAttempted: false,
      })
      return
    }
    if (consumed) return
    consumed = true
    try {
      if (
        !data ||
        data.protocol !== 1 ||
        typeof data.requestId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(data.requestId) ||
        typeof data.source !== 'string' ||
        data.source.length > 50000 ||
        data.source.split('\n').length > 256 ||
        !Number.isInteger(data.width) ||
        data.width < 160 ||
        data.width > MAX_AXIS ||
        !['default', 'dark'].includes(data.theme) ||
        !['classic', 'neo'].includes(data.look)
      ) {
        throw new Error('Invalid fixed data contract')
      }
      const target = document.getElementById('target')
      const background = data.theme === 'dark' ? '#1e1e1e' : '#ffffff'
      document.documentElement.style.background = background
      document.body.style.background = background
      document.body.style.margin = '0'
      target.style.width = `${data.width}px`
      target.style.display = 'flow-root'
      // Pin every existing configuration key against frontmatter/init overrides.
      // No external layout loaders, icon registration, callbacks or bindFunctions.
      const secure = [
        ...new Set([
          ...Object.keys(mermaid.mermaidAPI.defaultConfig),
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'maxEdges',
          'secure',
          'htmlLabels',
        ]),
      ]
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        maxTextSize: 50000,
        maxEdges: 500,
        deterministicIds: true,
        deterministicIDSeed: 'milkup-private-mermaid',
        theme: data.theme,
        fontFamily: 'Arial, sans-serif',
        htmlLabels: true,
        look: data.look,
        secure,
      })
      await document.fonts.ready
      const result = await mermaid.render('fixed-diagram', data.source, target)
      target.innerHTML = result.svg
      const svg = target.querySelector('svg')
      if (!svg) throw new Error('Official render returned no SVG')
      // Strict mode can preserve HTTPS anchors. Only inert PNGs leave this helper.
      // Native navigation/request gates and CSP remain independent protections.
      for (const anchor of target.querySelectorAll('a')) {
        if (
          anchor.hasAttribute('href') ||
          anchor.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')
        )
          strippedLinkTargets++
        anchor.removeAttribute('href')
        anchor.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
        anchor.removeAttribute('xlink:href')
        anchor.removeAttribute('target')
        anchor.removeAttribute('download')
      }
      if (target.querySelector('script,iframe,object,embed'))
        throw new Error('Executable element rejected in static renderer output')
      await document.fonts.ready
      await frame()
      await frame()
      const adjustedC4Labels = liftC4Labels(svg, background, data.theme)
      const { width, height, box } = measureNaturalOutput(svg, target)
      await frame()
      const rect = svg.getBoundingClientRect()
      if (Math.abs(rect.width - width) > 1 || Math.abs(rect.height - height) > 1) {
        throw new Error('Natural SVG dimensions did not settle')
      }
      rendered = true
      send({
        phase: 'rendered',
        requestId: data.requestId,
        width,
        height,
        diagramType: result.diagramType ?? null,
        adjustedC4Labels,
        svgViewBox: svg.getAttribute('viewBox'),
        svgBBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        boundary:
          'Natural SVG units, C4 content crop or other viewBox/content union, and 16px padding; native visual acceptance required',
      })
    } catch (error) {
      send({ phase: 'error', message: String(error).slice(0, 1000) })
    }
  })
  send({ phase: 'ready', engine: '12.2.0' })
})()

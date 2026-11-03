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

  function improveC4NodeContrast(svg) {
    const geometryNames = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon'])
    for (const node of svg.querySelectorAll('.c4-shape')) {
      const shapes = [...node.children].flatMap((child) => {
        if (geometryNames.has(child.localName)) return [child]
        // Person shapes group the body rectangle and head circle together.
        return child.classList.contains('label-container')
          ? [...child.querySelectorAll('rect, circle, ellipse, path, polygon')]
          : []
      })
      for (const label of node.querySelectorAll('.label')) {
        if (label.closest('.c4-shape') !== node) continue
        const bounds = label.getBoundingClientRect()
        const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        // Read the actual opaque shape behind the label, including document C4
        // style choices. Theme names and shape types do not determine contrast.
        const shape = shapes.findLast((candidate) => {
          const matrix = candidate.getScreenCTM()
          if (!matrix || !candidate.isPointInFill(center.matrixTransform(matrix.inverse())))
            return false
          const style = getComputedStyle(candidate)
          return style.fill !== 'none' && Number(style.fillOpacity) === 1
        })
        if (!shape) continue
        const color = getComputedStyle(shape).fill.match(/^rgba?\(([^)]+)\)$/)
        if (!color) continue // Gradients and unresolved paints have no single known background.
        const rgb = color[1].split(',').map((channel) => Number(channel.trim()))
        if (
          (rgb.length !== 3 && rgb.length !== 4) ||
          rgb
            .slice(0, 3)
            .some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255) ||
          (rgb.length === 4 && rgb[3] !== 1)
        )
          continue
        let opaque = true
        for (
          let ancestor = shape;
          ancestor && ancestor !== svg;
          ancestor = ancestor.parentElement
        ) {
          if (Number(getComputedStyle(ancestor).opacity) !== 1) opaque = false
        }
        if (!opaque) continue
        const linear = rgb.slice(0, 3).map((channel) => {
          const srgb = channel / 255
          return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
        })
        const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
        const blackContrast = (luminance + 0.05) / 0.05
        const whiteContrast = 1.05 / (luminance + 0.05)
        const ink = blackContrast >= whiteContrast ? '#000000' : '#ffffff'
        for (const text of label.querySelectorAll('text, tspan')) {
          text.style.setProperty('fill', ink, 'important')
        }
      }
    }
  }

  function clearC4LabelEdges(svg, wrapper) {
    // Parallel/curved relationship groups need a layout decision, not a nudge.
    if (wrapper.parentElement.querySelectorAll(':scope > line, :scope > path').length !== 1) return
    const parentMatrix = wrapper.parentElement.getScreenCTM()
    if (!parentMatrix) return
    const inverse = parentMatrix.inverse()
    const boundsInParent = (element) => {
      const box = element.getBBox()
      const matrix = element.getScreenCTM()
      if (!finiteBox(box) || !matrix) return null
      const transform = inverse.multiply(matrix)
      const points = [
        new DOMPoint(box.x, box.y),
        new DOMPoint(box.x + box.width, box.y),
        new DOMPoint(box.x, box.y + box.height),
        new DOMPoint(box.x + box.width, box.y + box.height),
      ].map((point) => point.matrixTransform(transform))
      return {
        left: Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        bottom: Math.max(...points.map((point) => point.y)),
      }
    }
    const box = boundsInParent(wrapper)
    if (!box) return
    const nodes = [...svg.querySelectorAll('.c4-shape')].flatMap((node) => {
      const bounds = boundsInParent(node)
      if (!bounds) return []
      let halfStroke = 0
      for (const shape of node.querySelectorAll('rect,circle,ellipse,path,polygon')) {
        const matrix = shape.getScreenCTM()
        const width = Number.parseFloat(getComputedStyle(shape).strokeWidth)
        if (!matrix || !Number.isFinite(width)) continue
        const transform = inverse.multiply(matrix)
        halfStroke = Math.max(
          halfStroke,
          (width / 2) *
            Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d)),
        )
      }
      const gap = halfStroke + 1
      return [
        {
          left: bounds.left - gap,
          right: bounds.right + gap,
          top: bounds.top - gap,
          bottom: bounds.bottom + gap,
        },
      ]
    })
    const overlaps = (node, dx = 0) =>
      box.left + dx < node.right &&
      box.right + dx > node.left &&
      box.top < node.bottom &&
      box.bottom > node.top
    const touching = nodes.filter((node) => overlaps(node))
    if (!touching.length) return
    const protectedBounds = [
      ...svg.querySelectorAll('[data-milkup-c4-label], line, path[marker-start], path[marker-end]'),
    ]
      .filter(
        (element) =>
          element !== wrapper &&
          (element.hasAttribute('data-milkup-c4-label') ||
            element.parentElement !== wrapper.parentElement),
      )
      .flatMap((element) => {
        const bounds = boundsInParent(element)
        if (!bounds) return []
        // Conservatively protect whole connector bounds, including arrow tips.
        // A blocked correction leaves the authored layout as rendered.
        const gap = element.hasAttribute('data-milkup-c4-label') ? 1 : 8
        return [
          {
            left: bounds.left - gap,
            right: bounds.right + gap,
            top: bounds.top - gap,
            bottom: bounds.bottom + gap,
          },
        ]
      })
    // The fixed C4 renderer places relationship text just to the right of its
    // line midpoint. Our opaque backing can then graze a nearby node's stroke.
    // Correct only a small edge collision; do not recenter authored offsets,
    // move line endpoints, or attempt a general relationship-layout rewrite.
    const candidates = touching
      .flatMap((node) => [node.left - box.right, node.right - box.left])
      .filter((dx) => Number.isFinite(dx) && Math.abs(dx) <= 8)
      .sort((left, right) => Math.abs(left) - Math.abs(right))
    const dx = candidates.find((candidate) =>
      [...nodes, ...protectedBounds].every((bounds) => !overlaps(bounds, candidate)),
    )
    if (dx === undefined) return
    const transform = wrapper.transform.baseVal.consolidate().matrix
    wrapper.setAttribute('transform', `translate(${transform.e + dx} ${transform.f})`)
  }

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
    // All relationship labels must exist before checking neighbouring labels.
    for (const wrapper of svg.querySelectorAll('[data-milkup-c4-label]')) {
      clearC4LabelEdges(svg, wrapper)
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
      improveC4NodeContrast(svg)
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

// Only this fixed host asset and the pinned official engine execute here.
// Diagram text is data on an authenticated MessagePort, never script or HTML.
;(() => {
  'use strict'
  document.documentElement.dataset.milkupMermaidBootstrap = 'started'
  let engineStartupError = false
  addEventListener(
    'error',
    () => {
      engineStartupError = true
    },
    { capture: true },
  )
  const MAX_AXIS = 8192
  const MAX_PIXELS = 16777216
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

  // The fixed document's fragment survives cross-site navigation without
  // relying on browser persistence of window.name. It never contains source.
  const nonce = location.hash.slice(1)
  if (!/^[a-f0-9]{32}$/.test(nonce) || parent === window) return
  const parentOrigin = new URL(document.referrer).origin
  let attached = false
  let busy = false
  const handshake = (event) => {
    if (
      attached ||
      event.source !== parent ||
      event.origin !== parentOrigin ||
      event.data?.kind !== 'milkup-mermaid-port' ||
      event.data.nonce !== nonce ||
      event.ports.length !== 1
    )
      return
    attached = true
    removeEventListener('message', handshake)
    const port = event.ports[0]
    let parentDomReadable = false
    try {
      void parent.document.documentElement
      parentDomReadable = true
    } catch {}
    let engineInitialized = false
    let engineInitializing = false
    let engineScriptUrlRevoked = false
    const bridge = () => ({
      engineAvailable: typeof globalThis.mermaid?.render === 'function',
      engineStartupError,
      engineScriptUrlRevoked,
      parentDomReadable,
      tauriInternals: '__TAURI_INTERNALS__' in window,
      tauriInvoke: '__TAURI__' in window,
      wryIpc: 'ipc' in window,
      chromeWebview: !!window.chrome?.webview,
    })
    port.postMessage({ kind: 'bootstrap-connected', nonce })
    port.onmessage = async ({ data }) => {
      if (!data || data.nonce !== nonce) return
      if (data.kind === 'initialize-engine') {
        if (engineInitializing || engineInitialized) return
        engineInitializing = true
        let engineUrl
        let engineScript
        try {
          if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength !== 5494801)
            throw Error('Fixed engine size')
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.bytes))]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')
          if (digest !== 'a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f')
            throw Error('Fixed engine identity')
          engineUrl = URL.createObjectURL(new Blob([data.bytes], { type: 'text/javascript' }))
          engineScript = document.createElement('script')
          engineScript.integrity = 'sha256-qKam+AWwdKgmGiglyG+ZyAVKyzs19Qu34kpPnyw8O58='
          engineScript.src = engineUrl
          await new Promise((resolve, reject) => {
            engineScript.onload = resolve
            engineScript.onerror = () => reject(Error('Fixed engine script load'))
            document.head.append(engineScript)
          })
          if (typeof globalThis.mermaid?.render !== 'function')
            throw Error('Fixed engine export missing')
          engineInitialized = true
        } catch {
          engineStartupError = true
        } finally {
          engineScript?.remove()
          if (engineUrl) URL.revokeObjectURL(engineUrl)
          engineScriptUrlRevoked = true
        }
        port.postMessage({ kind: 'connected', nonce, engine: '12.2.0', bridge: bridge() })
        return
      }
      if (!engineInitialized) return
      if (data.kind === 'boundary-probe') {
        // A native frame receiver rejects and records this actual attempt; the
        // parent requires that record, not a timeout, before admitting source.
        if (bridge().chromeWebview)
          chrome.webview.postMessage(
            JSON.stringify({
              cmd: 'frontend_mermaid_probe',
              payload: { nonce },
              callback: 0,
              error: 0,
              invokeKey: 'frame-has-no-key',
            }),
          )
        port.postMessage({ kind: 'probe-sent', nonce })
        return
      }
      if (data.kind === 'navigation-probe') {
        location.replace('about:blank')
        port.postMessage({ kind: 'navigation-sent', nonce })
        return
      }
      if (data.kind !== 'render' || busy) return
      busy = true
      const requestId = data.requestId
      let stage = 'input'
      try {
        if (
          typeof requestId !== 'string' ||
          !/^[a-f0-9]{32}$/.test(requestId) ||
          typeof data.source !== 'string' ||
          data.source.length > 50000 ||
          data.source.split('\n').length > 256 ||
          !Number.isInteger(data.width) ||
          data.width < 160 ||
          data.width > MAX_AXIS ||
          !['default', 'dark'].includes(data.theme)
        )
          throw Error('invalid-input')
        const target = document.getElementById('target')
        target.replaceChildren()
        target.removeAttribute('style')
        target.style.width = `${data.width}px`
        target.style.display = 'flow-root'
        const background = data.theme === 'dark' ? '#1e1e1e' : '#ffffff'
        document.documentElement.style.background = background
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
          deterministicIDSeed: 'milkup-frontend-mermaid',
          theme: data.theme,
          fontFamily: 'Arial, sans-serif',
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          journey: { textPlacement: 'svg' },
          look: 'classic',
          secure,
        })
        await document.fonts.ready
        stage = 'mermaid-render'
        port.postMessage({ kind: 'rendering', nonce, requestId })
        const rendered = await mermaid.render('frontend-diagram', data.source, target)
        stage = 'svg-output'
        // This DOM belongs to the opaque frame; it is never inserted in the editor.
        target.innerHTML = rendered.svg
        const svg = target.querySelector('svg')
        if (!svg || target.querySelector('script,iframe,object,embed,image,audio,video'))
          throw Error('unsafe-output')
        for (const a of svg.querySelectorAll('a')) {
          a.removeAttribute('href')
          a.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
          a.removeAttribute('target')
          a.removeAttribute('download')
        }
        const nodes = [svg, ...svg.querySelectorAll('*')]
        if (nodes.length > 20000) throw Error('output-budget')
        // Official eventmodeling uses foreignObject text boxes even with
        // htmlLabels:false. Keep only inert text/layout HTML in this opaque
        // document; no controls, links, media, scripts or embedded documents.
        const htmlTextTags = new Set([
          'div',
          'span',
          'p',
          'br',
          'b',
          'strong',
          'i',
          'em',
          'code',
          'pre',
          'sub',
          'sup',
          'small',
          's',
          'del',
          'u',
        ])
        for (const node of nodes) {
          if (
            node.namespaceURI !== 'http://www.w3.org/2000/svg' &&
            (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
              !htmlTextTags.has(node.localName) ||
              !node.closest('foreignObject'))
          )
            throw Error('unsafe-output')
          for (const attr of node.attributes) {
            if (
              node.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
              !['class', 'style', 'xmlns', 'dir', 'lang'].includes(attr.name)
            )
              throw Error('unsafe-output')
            if (
              /^on/i.test(attr.name) ||
              (attr.localName === 'href' && !attr.value.startsWith('#'))
            )
              throw Error('unsafe-output')
          }
        }
        const serializedPolicy = new XMLSerializer().serializeToString(svg)
        if (
          serializedPolicy.length > 4 * 1024 * 1024 ||
          /@import|@font-face/i.test(serializedPolicy)
        )
          throw Error('unsafe-output')
        for (const match of serializedPolicy.matchAll(/url\(([^)]*)\)/gi)) {
          const url = match[1].trim().replace(/^['"]|['"]$/g, '')
          if (!/^#[A-Za-z0-9_-]+$/.test(url)) throw Error('external-output-resource')
        }
        await document.fonts.ready
        improveC4NodeContrast(svg)
        liftC4Labels(svg, background, data.theme)
        const { width, height } = measureNaturalOutput(svg, target)
        svg.setAttribute('width', String(width))
        svg.setAttribute('height', String(height))
        svg.style.maxWidth = 'none'
        stage = 'png-output'
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
          type: 'image/svg+xml',
        })
        // Chromium taints canvases for blob SVGs with foreignObject. A bounded
        // validated SVG data image supports these inert labels without injecting
        // SVG into the privileged page or using native screenshot/render IPC.
        const usesHtmlText = !!svg.querySelector('foreignObject')
        const url = usesHtmlText
          ? await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result)
              reader.onerror = () => reject(Error('png-failed'))
              reader.readAsDataURL(blob)
            })
          : URL.createObjectURL(blob)
        let png
        try {
          const image = new Image()
          image.src = url
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          if (!context) throw Error('canvas-unavailable')
          context.fillStyle = background
          context.fillRect(0, 0, width, height)
          context.drawImage(image, 0, 0, width, height)
          png = await new Promise((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(Error('png-failed'))), 'image/png'),
          )
          canvas.width = 0
          canvas.height = 0
        } finally {
          if (!usesHtmlText) URL.revokeObjectURL(url)
        }
        if (png.size > 16 * 1024 * 1024) throw Error('output-budget')
        const bytes = await png.arrayBuffer()
        target.replaceChildren()
        port.postMessage(
          { kind: 'result', nonce, requestId, width, height, bytes, engine: '12.2.0' },
          [bytes],
        )
      } catch (error) {
        document.getElementById('target').replaceChildren()
        port.postMessage({
          kind: 'error',
          nonce,
          requestId,
          code:
            stage === 'mermaid-render' &&
            (error?.name === 'UnknownDiagramError' ||
              String(error?.message).startsWith('No diagram type detected'))
              ? 'unknown-diagram'
              : 'render-failed',
          stage,
          reason: [
            'unsafe-output',
            'external-output-resource',
            'output-budget',
            'invalid-input',
            'canvas-unavailable',
            'png-failed',
          ].includes(error?.message)
            ? error.message
            : 'renderer-error',
        })
      } finally {
        busy = false
      }
    }
    port.start()
  }
  addEventListener('message', handshake)
  addEventListener(
    'DOMContentLoaded',
    () => {
      parent.postMessage({ kind: 'milkup-mermaid-ready', nonce }, parentOrigin)
      document.documentElement.dataset.milkupMermaidReadySent = 'true'
    },
    { once: true },
  )
})()

;(() => {
  const out = (window.__nearReturnTrace = {
    observationOnly: true,
    events: [],
    replacements: [],
    geometry: [],
    dropped: 0,
  })
  let selector,
    editor,
    tracked,
    armed = false,
    seq = 0,
    ids = new WeakMap(),
    next = 0
  const hooked = new WeakSet()
  const identity = (n) =>
    n && typeof n === 'object' ? (ids.has(n) ? ids.get(n) : (ids.set(n, ++next), next)) : null
  const desc = (n) =>
    n?.nodeType === 1
      ? {
          id: identity(n),
          tag: n.tagName,
          className: String(n.className?.baseVal ?? n.className ?? '').slice(0, 100),
          connected: n.isConnected,
          from: n.getAttribute('data-presentation-from'),
          line: n.getAttribute('data-line'),
        }
      : null
  const rect = (n) => n?.getBoundingClientRect().toJSON() ?? null
  const put = (list, v) => {
    if (list.length >= 400) {
      out.dropped++
      return
    }
    list.push({ wall: Date.now(), mono: performance.now(), ...v })
  }
  const snapshot = () => {
    const target = document.querySelector(selector),
      preview = target?.closest('[data-document-presentation]'),
      content = editor.querySelector('.milkup-editor-content')
    return {
      target: desc(target),
      preview: desc(preview),
      previewDataset: preview ? { ...preview.dataset } : null,
      previewInContent: !!(preview && content?.contains(preview)),
      targetRect: rect(target),
      editorRect: rect(editor),
      scrollTop: editor.scrollTop,
      contentMetadata: content ? { ...content.dataset } : null,
      active: desc(document.activeElement),
      documentFocus: document.hasFocus(),
      visibility: document.visibilityState,
      version: document.querySelector('[data-stat="version"]')?.textContent,
      savedVersion: document.querySelector('[data-stat="saved"]')?.textContent,
      documentPath: document.querySelector('[data-stat="path"]')?.textContent,
      mode: editor.dataset.mode,
      selection: [...editor.querySelectorAll('.milkup-selection')]
        .slice(0, 4)
        .map((e) => ({ dataset: { ...e.dataset }, rect: rect(e) })),
      cursor: editor.querySelector('.milkup-cursor')?.dataset.position,
      notice: editor.querySelector('[data-document-presentation-notice]')?.textContent,
      referenceLine: desc(editor.querySelector('.milkup-line[data-from="434"]')),
      definitionLine: desc(editor.querySelector('.milkup-line[data-from="463"]')),
    }
  }
  const types = [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'focus',
    'blur',
    'focusin',
    'focusout',
  ]
  const hookTarget = (n) => {
    if (!n || hooked.has(n)) return
    hooked.add(n)
    for (const type of types)
      n.addEventListener(type, (e) => {
        if (armed)
          put(out.events, {
            type,
            phase: 'target-bubble-after-existing',
            trusted: e.isTrusted,
            defaultPrevented: e.defaultPrevented,
            target: desc(e.target),
            snapshot: snapshot(),
          })
      })
  }
  for (const type of types) {
    document.addEventListener(
      type,
      (e) => {
        if (!armed) return
        const id = ++seq
        put(out.events, {
          id,
          type,
          phase: 'capture',
          trusted: e.isTrusted,
          button: e.button,
          buttons: e.buttons,
          x: e.clientX,
          y: e.clientY,
          defaultPrevented: e.defaultPrevented,
          target: desc(e.target),
          related: desc(e.relatedTarget),
          path: e.composedPath().slice(0, 8).map(desc),
          snapshot: snapshot(),
        })
        queueMicrotask(() =>
          put(out.events, {
            id,
            type,
            phase: 'microtask',
            defaultPrevented: e.defaultPrevented,
            target: desc(e.target),
            snapshot: snapshot(),
          }),
        )
        requestAnimationFrame(() =>
          put(out.events, {
            id,
            type,
            phase: 'raf',
            defaultPrevented: e.defaultPrevented,
            target: desc(e.target),
            snapshot: snapshot(),
          }),
        )
      },
      true,
    )
    document.addEventListener(type, (e) => {
      if (armed)
        put(out.events, {
          type,
          phase: 'document-bubble',
          defaultPrevented: e.defaultPrevented,
          target: desc(e.target),
          snapshot: snapshot(),
        })
    })
  }
  let queued = false,
    lastGeometry = ''
  const geometry = (reason) => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      const v = snapshot(),
        signature = JSON.stringify(v)
      if (signature !== lastGeometry) {
        lastGeometry = signature
        put(out.geometry, { reason, snapshot: v })
      }
    })
  }
  window.__armNearReturnDiagnostic = (s) => {
    selector = s
    editor = document.querySelector('.milkup-editor')
    tracked = document.querySelector(selector)
    armed = true
    hookTarget(tracked)
    out.armedWall = Date.now()
    out.initial = snapshot()
    editor.addEventListener('scroll', () => geometry('scroll'), { passive: true })
    new MutationObserver((records) => {
      geometry('local-mutation')
      const current = document.querySelector(selector)
      if (current !== tracked) {
        put(out.replacements, {
          previous: desc(tracked),
          current: desc(current),
          recordCount: records.length,
          snapshot: snapshot(),
        })
        tracked = current
        hookTarget(current)
      }
    }).observe(editor, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-from-line',
        'data-to-line',
        'data-document-presentation-status',
        'aria-description',
        'data-position',
        'data-from',
        'data-to',
      ],
    })
  }
})()

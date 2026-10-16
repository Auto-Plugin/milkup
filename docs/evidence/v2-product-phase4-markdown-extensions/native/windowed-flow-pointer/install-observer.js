;(() => {
  if (window.__flowPointerTrace) throw Error('Pointer diagnostic already installed')
  const output = (window.__flowPointerTrace = {
    diagnosticOnly: true,
    events: [],
    replacements: [],
    dropped: 0,
    armedWall: null,
    disarmedWall: null,
  })
  let selector,
    editor,
    tracked,
    observer,
    armed = false
  const push = (array, value) => {
    if (array.length >= 300) {
      output.dropped++
      return
    }
    array.push({ wall: Date.now(), mono: performance.now(), ...value })
  }
  const descriptor = (node) =>
    node?.nodeType === 1
      ? {
          tag: node.tagName,
          classes: String(node.className?.baseVal ?? node.className ?? '').slice(0, 120),
          from: node.getAttribute('data-presentation-from'),
          line: node.getAttribute('data-line'),
          connected: node.isConnected,
        }
      : null
  const snapshot = () => {
    const p = selector ? document.querySelector(selector) : null
    const cursor = document.querySelector('.milkup-cursor')
    const exact = document.querySelector('.milkup-line[data-from="175"]')
    const containing = [...document.querySelectorAll('.milkup-line')].find(
      (e) => Number(e.dataset.from) <= 175 && Number(e.dataset.to) >= 175,
    )
    const lineInfo = (e) =>
      e
        ? {
            dataset: { ...e.dataset },
            connected: e.isConnected,
            rect: e.getBoundingClientRect().toJSON(),
          }
        : null
    return {
      targetLine: { exact: lineInfo(exact), containing: lineInfo(containing) },
      active: descriptor(document.activeElement),
      documentFocus: document.hasFocus(),
      visibility: document.visibilityState,
      cursor: cursor?.dataset.position ?? null,
      selection: [...document.querySelectorAll('.milkup-selection')]
        .slice(0, 8)
        .map((e) => ({ from: e.dataset.from, to: e.dataset.to, line: e.dataset.line })),
      preview: descriptor(p),
      previewRect: p?.getBoundingClientRect().toJSON() ?? null,
      scrollTop: editor?.scrollTop ?? null,
      editorRect: editor?.getBoundingClientRect().toJSON() ?? null,
    }
  }
  let eventSequence = 0
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    document.addEventListener(
      type,
      (event) => {
        if (!armed) return
        const id = ++eventSequence,
          base = {
            id,
            type,
            eventWall: Date.now(),
            trusted: event.isTrusted,
            button: event.button,
            buttons: event.buttons,
            x: event.clientX,
            y: event.clientY,
            target: descriptor(event.target),
            path: event.composedPath().slice(0, 10).map(descriptor),
          }
        push(output.events, {
          ...base,
          phase: 'capture',
          defaultPrevented: event.defaultPrevented,
          snapshot: snapshot(),
        })
        queueMicrotask(() =>
          push(output.events, {
            id,
            type,
            phase: 'microtask',
            defaultPrevented: event.defaultPrevented,
            targetConnected: event.target?.isConnected,
            snapshot: snapshot(),
          }),
        )
        requestAnimationFrame(() =>
          push(output.events, {
            id,
            type,
            phase: 'raf',
            defaultPrevented: event.defaultPrevented,
            targetConnected: event.target?.isConnected,
            snapshot: snapshot(),
          }),
        )
      },
      true,
    )
    document.addEventListener(type, (event) => {
      if (armed)
        push(output.events, {
          type,
          phase: 'document-bubble',
          trusted: event.isTrusted,
          defaultPrevented: event.defaultPrevented,
          target: descriptor(event.target),
          snapshot: snapshot(),
        })
    })
  }
  window.__armFlowPointerDiagnostic = (targetSelector) => {
    if (armed) throw Error('Pointer diagnostic already armed')
    selector = targetSelector
    editor = document.querySelector('.milkup-editor')
    tracked = document.querySelector(selector)
    armed = true
    output.armedWall = Date.now()
    output.initial = snapshot()
    observer = new MutationObserver((records) => {
      const current = document.querySelector(selector)
      if (current === tracked) return
      push(output.replacements, {
        kind: 'target-replaced',
        recordCount: records.length,
        previous: descriptor(tracked),
        current: descriptor(current),
        snapshot: snapshot(),
      })
      tracked = current
    })
    observer.observe(editor, { childList: true, subtree: true })
  }
  window.__stopFlowPointerDiagnostic = () => {
    observer?.disconnect()
    armed = false
    output.disarmedWall = Date.now()
  }
})()

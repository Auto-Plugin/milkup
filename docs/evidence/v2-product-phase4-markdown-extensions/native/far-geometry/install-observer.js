;(() => {
  const result = (window.__farGeometry = {
    observationOnly: true,
    samples: [],
    dropped: 0,
    descriptors: {},
    cost: [],
  })
  for (const key of ['invoke', 'ipc']) {
    const d = Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__ ?? {}, key)
    result.descriptors[key] = d
      ? {
          writable: d.writable,
          configurable: d.configurable,
          enumerable: d.enumerable,
          hasGetter: !!d.get,
          hasSetter: !!d.set,
          valueType: typeof d.value,
        }
      : null
  }
  const rect = (e) => e?.getBoundingClientRect().toJSON() ?? null
  let root,
    observer,
    pending = false,
    reasons = new Set(),
    last = ''
  function sample() {
    pending = false
    const started = performance.now(),
      content = root.querySelector('.milkup-editor-content'),
      marker = root.querySelector('.milkup-line[data-line="160055"]'),
      notice = root.querySelector('[data-document-presentation-notice]'),
      selection = root.querySelector('.milkup-selection'),
      cursor = root.querySelector('.milkup-cursor')
    const data = {
      scrollTop: root.scrollTop,
      clientHeight: root.clientHeight,
      scrollHeight: root.scrollHeight,
      editor: rect(root),
      content: rect(content),
      contentOffsetTop: content?.offsetTop,
      spacers: [...root.querySelectorAll('.milkup-virtual-spacer')]
        .slice(0, 2)
        .map((e) => ({ rect: rect(e), height: e.style.height })),
      remoteReferenceLine: rect(root.querySelector('.milkup-line[data-line="160056"]')),
      proxy: rect(root.querySelector('.milkup-input-proxy')),
      metadata: content ? { ...content.dataset } : null,
      marker: marker
        ? {
            rect: rect(marker),
            dataset: { ...marker.dataset },
            text: marker.textContent.slice(0, 120),
          }
        : null,
      selection: selection ? { rect: rect(selection), dataset: { ...selection.dataset } } : null,
      cursor: cursor ? { rect: rect(cursor), dataset: { ...cursor.dataset } } : null,
      notice: notice
        ? { rect: rect(notice), text: notice.textContent, connected: notice.isConnected }
        : null,
      hostNotice: document.querySelector('[data-notice]')?.textContent,
      ariaDescription: content?.getAttribute('aria-description'),
      active: document.activeElement?.className,
    }
    const signature = JSON.stringify(data)
    if (signature !== last) {
      last = signature
      if (result.samples.length < 3000)
        result.samples.push({
          wall: Date.now(),
          mono: performance.now(),
          reasons: [...reasons],
          ...data,
        })
      else result.dropped++
    }
    reasons.clear()
    if (result.cost.length < 3000) result.cost.push(performance.now() - started)
  }
  function schedule(reason) {
    reasons.add(reason)
    if (!pending) {
      pending = true
      requestAnimationFrame(sample)
    }
  }
  window.__armFarGeometry = () => {
    root = document.querySelector('.milkup-editor')
    if (!root) throw Error('No editor to observe')
    observer = new MutationObserver(() => schedule('local-mutation'))
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-from-line',
        'data-to-line',
        'data-document-presentation-status',
        'aria-description',
        'data-from',
        'data-to',
        'data-position',
        'style',
      ],
      characterData: true,
    })
    root.addEventListener('scroll', () => schedule('scroll'), { passive: true })
    const host = document.querySelector('[data-notice]')
    if (host) observer.observe(host, { subtree: true, childList: true, characterData: true })
    schedule('armed')
  }
})()

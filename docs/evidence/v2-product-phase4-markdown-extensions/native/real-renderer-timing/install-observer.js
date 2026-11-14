;(() => {
  'use strict'
  if (window.__rendererTimingProbe) throw new Error('Renderer timing probe already installed')
  const diagnosticProtocol = 'milkup.renderer-timing.diagnostic.v1'
  const supervisorProtocol = 'milkup.plugin.worker-supervisor.v1'
  const renderProtocol = 'milkup.plugin.document-render.v1'
  const initProtocol = 'milkup.plugin.worker.init.v1'
  const targets = new Set(['milkup.math', 'milkup.diagrams'])
  const BaseWorker = window.Worker
  const events = [],
    modules = [],
    activeUrls = new Set()
  const probe = (window.__rendererTimingProbe = {
    diagnosticOnly: true,
    intervention:
      'Only target supervisor init.moduleSpecifier is replaced by a timing ESM wrapper; original module is dynamically imported and its default export returned unchanged.',
    diagnosticProtocol,
    installedWall: Date.now(),
    events,
    modules,
    observerDropped: 0,
    stopNewInstrumentation() {
      if (window.Worker === ObservedWorker) window.Worker = BaseWorker
      // Running Workers retain their wrapper URLs until terminate or page teardown.
    },
  })
  const push = (event) => {
    if (events.length >= 10000) {
      probe.observerDropped++
      return
    }
    events.push({ receivedWall: Date.now(), receivedMono: performance.now(), ...event })
  }
  const digest = async (source) => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  function makeWrapper(specifier) {
    return (
      `// External diagnostic only; no deadline decisions or business changes.\n` +
      `const diagnosticProtocol = ${JSON.stringify(diagnosticProtocol)};
const renderProtocol = ${JSON.stringify(renderProtocol)};
const originalPost = globalThis.postMessage;
const pending = new Set();
let emitted = 0;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const emit = (id, phase) => {
  if (emitted++ >= 4096) return;
  const marker = { protocol: diagnosticProtocol, id, phase, wall: Date.now(), mono: performance.now(), timeOrigin: performance.timeOrigin };
  try { Reflect.apply(originalPost, globalThis, [marker]); } catch { /* Observability cannot change business exceptions. */ }
};
globalThis.addEventListener('message', event => {
  const message = event.data;
  if (message?.protocol !== renderProtocol || message.type !== 'render' || !validId(message.id)) return;
  if (pending.size >= 64) pending.delete(pending.values().next().value);
  pending.add(message.id);
  emit(message.id, 'render-received-observer');
});
globalThis.postMessage = function(...args) {
  const message = args[0];
  const matched = message?.protocol === renderProtocol && message.type === 'result' && validId(message.id) && pending.has(message.id);
  if (matched) emit(message.id, 'result-posting');
  const returned = Reflect.apply(originalPost, this, args);
  if (matched) { emit(message.id, 'result-post-returned'); pending.delete(message.id); }
  return returned;
};
const originalModule = await import(${JSON.stringify(specifier)});
export default originalModule.default;
`
    )
  }
  let sequence = 0
  class ObservedWorker extends BaseWorker {
    constructor(url, options) {
      super(url, options)
      this.timingInstance = ++sequence
      this.timingPluginId = (options?.name ?? '').replace(/^milkup-supervisor-/, '')
      this.timingWrapped = false
      this.timingUrl = undefined
      if (!targets.has(this.timingPluginId)) return
      this.addEventListener('message', (event) => {
        const outer = event.data
        if (outer?.protocol !== supervisorProtocol || outer.type !== 'child') return
        const marker = outer.message
        if (
          marker?.protocol !== diagnosticProtocol ||
          typeof marker.id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(marker.id) ||
          !['render-received-observer', 'result-posting', 'result-post-returned'].includes(
            marker.phase,
          ) ||
          ![marker.wall, marker.mono, marker.timeOrigin].every(Number.isFinite) ||
          Object.keys(marker).some(
            (key) => !['protocol', 'id', 'phase', 'wall', 'mono', 'timeOrigin'].includes(key),
          )
        )
          return
        push({
          kind: 'child-timing',
          instance: this.timingInstance,
          pluginId: this.timingPluginId,
          id: marker.id,
          phase: marker.phase,
          childWall: marker.wall,
          childMono: marker.mono,
          childTimeOrigin: marker.timeOrigin,
        })
      })
    }
    postMessage(message, ...rest) {
      if (
        !this.timingWrapped &&
        targets.has(this.timingPluginId) &&
        message?.protocol === supervisorProtocol &&
        message.type === 'forward' &&
        message.message?.protocol === initProtocol &&
        message.message.type === 'init' &&
        message.message.payload?.manifest?.id === this.timingPluginId &&
        typeof message.message.payload.moduleSpecifier === 'string'
      ) {
        const inner = message.message,
          originalSpecifier = inner.payload.moduleSpecifier
        const source = makeWrapper(originalSpecifier)
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        this.timingUrl = url
        this.timingWrapped = true
        activeUrls.add(url)
        const metadata = {
          instance: this.timingInstance,
          pluginId: this.timingPluginId,
          originalSpecifierScheme: originalSpecifier.split(':', 1)[0],
          originalSpecifierLength: originalSpecifier.length,
          wrapperLength: source.length,
          wrapperSha256: null,
          originalSpecifierSha256: null,
          hashError: false,
          installedWall: Date.now(),
          revokedWall: null,
        }
        this.timingMetadata = metadata
        modules.push(metadata)
        void Promise.all([digest(source), digest(originalSpecifier)]).then(
          ([wrapper, original]) => {
            metadata.wrapperSha256 = wrapper
            metadata.originalSpecifierSha256 = original
          },
          () => {
            metadata.hashError = true
          },
        )
        push({
          kind: 'diagnostic-init-replacement',
          instance: this.timingInstance,
          pluginId: this.timingPluginId,
        })
        return super.postMessage(
          {
            ...message,
            message: { ...inner, payload: { ...inner.payload, moduleSpecifier: url } },
          },
          ...rest,
        )
      }
      return super.postMessage(message, ...rest)
    }
    terminate() {
      const result = super.terminate()
      if (this.timingUrl) {
        URL.revokeObjectURL(this.timingUrl)
        activeUrls.delete(this.timingUrl)
        this.timingMetadata.revokedWall = Date.now()
        this.timingUrl = undefined
      }
      return result
    }
  }
  window.Worker = ObservedWorker
  window.addEventListener(
    'pagehide',
    () => {
      for (const url of activeUrls) URL.revokeObjectURL(url)
      activeUrls.clear()
    },
    { once: true },
  )
})()

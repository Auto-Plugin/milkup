// Optional diagnostic, never product acceptance. Fixed WebDriver scripts only;
// no files, arbitrary native command, external URL, or unbounded CPU/memory work.
// bridge_status is verified in src-tauri/src/lib.rs to return the literal "ok".
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

function initialize(nonce, done) {
  const key = '__milkupFrontendBoundaryDiagnostic'
  if (Object.hasOwn(window, key)) {
    done({ blocked: 'existing-owned-probe' })
    return
  }
  const control =
    typeof window.__TAURI_INTERNALS__?.invoke === 'function'
      ? Promise.race([
          Promise.resolve()
            .then(() => window.__TAURI_INTERNALS__.invoke('bridge_status', {}))
            .then(
              (v) => (v === 'ok' ? 'fulfilled-ok' : 'fulfilled-unexpected'),
              () => 'rejected',
            ),
          new Promise((resolve) => setTimeout(() => resolve('timeout'), 1200)),
        ])
      : Promise.resolve('unavailable')
  control.then((parentControl) => {
    if (parentControl !== 'fulfilled-ok') {
      done({ blocked: 'parent-control-unavailable', parentControl })
      return
    }
    const state = { nonce, frames: [], sources: [], observed: {}, timers: [], parentControl }
    window[key] = state
    const loaded = []
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
    for (const role of ['navigation', 'busy']) {
      const frame = document.createElement('iframe')
      frame.sandbox = 'allow-scripts'
      frame.referrerPolicy = 'no-referrer'
      frame.title = 'Owned Mermaid boundary diagnostic'
      frame.style.cssText =
        'position:fixed;width:240px;height:60px;left:32px;top:32px;border:0;pointer-events:none;background:white;z-index:2147483647'
      frame.dataset.boundaryProbe = nonce
      loaded.push(new Promise((resolve) => frame.addEventListener('load', resolve, { once: true })))
      frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><p>Fixed ${role} probe</p>`
      document.body.append(frame)
      state.frames.push(frame)
      state.sources.push(frame.contentWindow)
    }
    state.listener = (event) => {
      if (event.origin !== 'null' || event.data?.token !== nonce) return
      const kind = event.data.kind
      if (kind === 'bridge-observed' && event.source === state.sources[0]) {
        state.observed.exactSourceAndOpaqueOrigin = true
      } else if (
        event.source === state.sources[1] &&
        ['busy-started', 'busy-finished'].includes(kind)
      ) {
        const value = event.data.at
        if (Number.isSafeInteger(value) && value > 0 && value < 1e15) state.observed[kind] = value
      }
    }
    addEventListener('message', state.listener)
    Promise.race([
      Promise.all(loaded).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
    ]).then((ready) =>
      done(
        ready
          ? { nonce, parentOrigin: location.origin, parentControl, frames: state.frames }
          : { nonce, blocked: 'owned-frame-load-timeout', parentControl },
      ),
    )
  })
}

function inspectFrame(nonce, parentOrigin, done) {
  let parentDomReadable = false
  try {
    parentDomReadable = typeof parent.document.documentElement.tagName === 'string'
  } catch {}
  const report = {
    tauriInternals: typeof window.__TAURI_INTERNALS__ === 'object',
    tauriInvoke: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
    wryIpc: typeof window.ipc?.postMessage === 'function',
    chromeWebview: typeof window.chrome?.webview?.postMessage === 'function',
    parentDomReadable,
  }
  const invocation =
    typeof window.__TAURI_INTERNALS__?.invoke !== 'function'
      ? Promise.resolve('unavailable')
      : Promise.race([
          Promise.resolve()
            .then(() => window.__TAURI_INTERNALS__.invoke('bridge_status', {}))
            .then(
              (v) => (v === 'ok' ? 'fulfilled-ok' : 'fulfilled-unexpected'),
              () => 'rejected',
            ),
          new Promise((resolve) => setTimeout(() => resolve('timeout'), 1200)),
        ])
  invocation.then((nativeInvocation) => {
    parent.postMessage({ token: nonce, kind: 'bridge-observed' }, parentOrigin)
    done({ ...report, nativeInvocation })
  })
}

function armParent(nonce) {
  const state = window.__milkupFrontendBoundaryDiagnostic
  if (state?.nonce !== nonce) throw Error('Owned probe identity mismatch')
  // Leave the local driver time to select and arm the child before either
  // timer fires. Starting removal before a frame-switch round trip can remove
  // the frame without ever exercising the bounded child computation.
  const plannedStart = Date.now() + 500
  state.plannedStart = plannedStart
  let previous = performance.now()
  state.heartbeatMaxGapMs = 0
  state.timers.push(
    setInterval(() => {
      const now = performance.now()
      state.heartbeatMaxGapMs = Math.max(state.heartbeatMaxGapMs, now - previous)
      previous = now
    }, 20),
  )
  state.timers.push(
    setTimeout(
      () => {
        state.removedAt = Date.now()
        state.frames[1].remove()
      },
      Math.max(0, plannedStart + 50 - Date.now()),
    ),
  )
  return plannedStart
}

function prepareTelemetry(nonce) {
  const state = window.__milkupFrontendBoundaryDiagnostic
  if (state?.nonce !== nonce || state.telemetry) throw Error('Owned probe identity mismatch')
  const channel = new MessageChannel()
  state.telemetry = channel.port1
  state.transferPort = channel.port2
  channel.port1.onmessage = (event) => {
    if (event.data?.token !== nonce) return
    if (event.data.kind === 'ready') state.telemetryReady = true
    else if (['busy-started', 'busy-finished'].includes(event.data.kind)) {
      const at = event.data.at
      if (Number.isSafeInteger(at) && at > 0 && at < 1e15) {
        state.observed[event.data.kind] = at
        if (state.removedAt) state.lateTelemetry = true
      }
    }
  }
  return true
}

function receiveTelemetry(nonce, parentOrigin) {
  const receive = (event) => {
    if (
      event.source !== parent ||
      event.origin !== parentOrigin ||
      event.data?.token !== nonce ||
      event.data.kind !== 'telemetry-port' ||
      event.ports.length !== 1
    )
      return
    removeEventListener('message', receive)
    window.__milkupOwnedDiagnosticPort = event.ports[0]
    event.ports[0].postMessage({ token: nonce, kind: 'ready' })
  }
  addEventListener('message', receive)
  return true
}

function transferTelemetry(nonce) {
  const state = window.__milkupFrontendBoundaryDiagnostic
  if (state?.nonce !== nonce || !state.transferPort) throw Error('Owned probe identity mismatch')
  // Opaque destination requires '*'; transfer only a fresh telemetry port to
  // the exact owned WindowProxy, never document content or native capability.
  state.frames[1].contentWindow.postMessage({ token: nonce, kind: 'telemetry-port' }, '*', [
    state.transferPort,
  ])
  state.transferPort = null
  return true
}

function telemetryReady(nonce) {
  const state = window.__milkupFrontendBoundaryDiagnostic
  return state?.nonce === nonce && state.telemetryReady === true
}

function armChild(nonce, parentOrigin, plannedStart) {
  if (!Number.isSafeInteger(plannedStart) || Math.abs(plannedStart - Date.now()) > 2000)
    throw Error('Bounded shared diagnostic start required')
  const telemetry = window.__milkupOwnedDiagnosticPort
  if (!telemetry) throw Error('Owned telemetry handshake required')
  setTimeout(
    () => {
      const before = performance.now()
      telemetry.postMessage({ token: nonce, kind: 'busy-started', at: Date.now() })
      parent.postMessage({ token: nonce, kind: 'busy-started', at: Date.now() }, parentOrigin)
      // Constant-space, bounded one second; no infinite loop or memory pressure.
      while (performance.now() - before < 1000) {
        /* fixed diagnostic work */
      }
      parent.postMessage({ token: nonce, kind: 'busy-finished', at: Date.now() }, parentOrigin)
      telemetry.postMessage({ token: nonce, kind: 'busy-finished', at: Date.now() })
    },
    Math.max(0, plannedStart - Date.now()),
  )
  return plannedStart
}

function collect(nonce) {
  const state = window.__milkupFrontendBoundaryDiagnostic
  if (state?.nonce !== nonce) throw Error('Owned probe identity mismatch')
  const start = state.observed['busy-started'] ?? null
  const end = state.observed['busy-finished'] ?? null
  const removed = state.removedAt ?? null
  return {
    exactSourceAndOpaqueOrigin: state.observed.exactSourceAndOpaqueOrigin === true,
    cancellation: {
      configuredChildWorkMs: 1000,
      requestedRemovalAfterPlannedStartMs: 50,
      childStartObserved: start !== null,
      childFinishedObserved: end !== null,
      childStartOffsetMs: start === null ? null : start - state.plannedStart,
      actualRemovalAfterPlannedStartMs: removed === null ? null : removed - state.plannedStart,
      actualRemovalAfterChildStartMs: removed === null || start === null ? null : removed - start,
      childDurationMs: start === null || end === null ? null : end - start,
      heartbeatMaxGapMs: Math.round(state.heartbeatMaxGapMs ?? 0),
      ownedFrameRemoved: !state.frames[1].isConnected,
      authenticatedTelemetryReady: state.telemetryReady === true,
      lateDiagnosticTelemetryObserved: state.lateTelemetry === true,
      lateResultsAcceptedForRendering: false,
      hardTerminationProven: false,
    },
  }
}

function cleanup(nonce) {
  const state = window.__milkupFrontendBoundaryDiagnostic
  if (!state) return true
  if (state.nonce !== nonce) throw Error('Refusing to clean another probe')
  removeEventListener('message', state.listener)
  state.telemetry?.close()
  state.transferPort?.close()
  for (const timer of state.timers) {
    clearInterval(timer)
    clearTimeout(timer)
  }
  for (const frame of state.frames) frame.remove()
  const removed = state.frames.every((frame) => !frame.isConnected)
  delete window.__milkupFrontendBoundaryDiagnostic
  return removed
}

const script = (fn) => `return (${fn.toString()})(...arguments);`
export const frontendBoundaryProbeScripts = Object.freeze({
  initialize: script(initialize),
  inspectFrame: script(inspectFrame),
  armParent: script(armParent),
  armChild: script(armChild),
  prepareTelemetry: script(prepareTelemetry),
  receiveTelemetry: script(receiveTelemetry),
  transferTelemetry: script(transferTelemetry),
  telemetryReady: script(telemetryReady),
  collect: script(collect),
  cleanup: script(cleanup),
})

// request uses decoded W3C responses from the caller's owned local driver. Test
// injection bypasses script loading, not origin isolation; no product CSP change.
export async function runFrontendBoundaryProbe({ request, session }) {
  assert.equal(typeof request, 'function')
  assert(typeof session === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(session))
  const root = `/session/${session}`
  const nonce = randomBytes(24).toString('hex')
  const execute = (name, args = [], async = false) =>
    request('POST', `${root}/execute/${async ? 'async' : 'sync'}`, {
      script: frontendBoundaryProbeScripts[name],
      args,
    })
  const frame = (id) => request('POST', `${root}/frame`, { id })
  const report = {
    schema: 1,
    diagnosticOnly: true,
    fixedScriptsInjectedByWebDriver: true,
    productionEngineResourceLoadingTested: false,
    hardMemoryLimitTested: false,
    arbitraryLoopTerminationTested: false,
    externalNetworkAttempted: false,
    command: 'bridge_status',
    cleanupConfirmed: false,
    status: 'incomplete',
    navigation: { requestedTarget: 'about:blank', exactTargetConfirmed: false },
  }
  let owned
  try {
    owned = await execute('initialize', [nonce], true)
    if (owned?.blocked) {
      report.status = owned.blocked
      report.parentControl = owned.parentControl ?? null
      return report
    }
    assert(/^[a-f0-9]{48}$/.test(owned?.nonce) && owned.frames?.length === 2)
    assert.equal(owned.nonce, nonce)
    report.parentControl = owned.parentControl
    await frame(owned.frames[0])
    report.frame = await execute('inspectFrame', [owned.nonce, owned.parentOrigin], true)
    try {
      await request('POST', `${root}/execute/sync`, {
        script: "location.replace('about:blank');return true",
        args: [],
      })
      await delay(100)
      report.navigation.exactTargetConfirmed = await request('POST', `${root}/execute/sync`, {
        script: "return location.href === 'about:blank'",
        args: [],
      })
      assert.equal(typeof report.navigation.exactTargetConfirmed, 'boolean')
    } catch {
      report.navigation.driverObservationFailed = true
    }
    await frame(null)
    await execute('prepareTelemetry', [owned.nonce])
    await frame(owned.frames[1])
    await execute('receiveTelemetry', [owned.nonce, owned.parentOrigin])
    await frame(null)
    await execute('transferTelemetry', [owned.nonce])
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await execute('telemetryReady', [owned.nonce])) break
      await delay(25)
    }
    assert.equal(await execute('telemetryReady', [owned.nonce]), true)
    const plannedStart = await execute('armParent', [owned.nonce])
    assert(Number.isSafeInteger(plannedStart))
    try {
      await frame(owned.frames[1])
      await execute('armChild', [owned.nonce, owned.parentOrigin, plannedStart])
    } catch {
      report.childExecutionDriverError = true
    }
    await frame(null)
    await delay(2100)
    Object.assign(report, await execute('collect', [owned.nonce]))
    report.status = 'observed'
    return report
  } catch {
    report.status = 'diagnostic-error'
    return report
  } finally {
    await frame(null)
    assert.equal(await execute('cleanup', [nonce]), true, 'Owned probe frames must be removed')
    report.cleanupConfirmed = true
  }
}

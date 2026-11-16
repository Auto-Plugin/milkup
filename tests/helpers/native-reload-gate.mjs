// Test-only transport scheduling: run the real read, retain its unchanged result,
// then deliver it after real keyboard input. No editor/session mutation or fake IPC.
// Serialized into the installed WebView by the native acceptance entry point.
export function installNativeReloadGate(expectedPath) {
  const bridge = globalThis.__TAURI_INTERNALS__
  if (!bridge || typeof bridge.invoke !== 'function' || globalThis.__reloadAcceptanceGate)
    throw Error('One real Tauri bridge and no existing gate required')
  const original = bridge.invoke
  let release, timer
  const events = []
  const gate = {
    events,
    received: false,
    delivered: false,
    timedOut: false,
    calls: 0,
    release() {
      if (!release) throw Error('Native result has not arrived')
      release()
    },
    restore() {
      if (gate.restored) {
        if (bridge.invoke !== original) throw Error('Bridge changed after restoration')
        return
      }
      if (bridge.invoke !== wrapped) throw Error('Bridge changed while observed')
      bridge.invoke = original
      gate.restored = true
      release?.()
    },
  }
  function wrapped(command, args, ...rest) {
    if (command !== 'reload_markdown_file' || args?.path !== expectedPath)
      return original.call(this, command, args, ...rest)
    if (++gate.calls !== 1) throw Error('Only one scoped reload per gate')
    events.push({
      phase: 'invoked',
      at: performance.now(),
      path: args.path,
      documentId: args.documentId,
    })
    return original.call(this, command, args, ...rest).then((result) => {
      gate.received = true
      events.push({
        phase: 'native-result',
        at: performance.now(),
        path: result?.file?.path,
        documentId: result?.documentId,
      })
      if (gate.restored) return result
      return new Promise((resolve) => {
        release = () => {
          if (gate.delivered) return
          clearTimeout(timer)
          gate.delivered = true
          events.push({ phase: 'delivered', at: performance.now() })
          resolve(result)
        }
        timer = setTimeout(() => {
          gate.timedOut = true
          release()
        }, 15000)
      })
    })
  }
  bridge.invoke = wrapped
  if (bridge.invoke !== wrapped) throw Error('Bridge does not permit controlled scheduling')
  globalThis.__reloadAcceptanceGate = gate
  return true
}

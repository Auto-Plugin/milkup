;(async () => {
  const input = __CONTROLLED_INPUT__
  const results = []
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  for (const endpoint of input.endpoints) {
    const base = `http://${endpoint.tcp}/${input.case}`
    const result = { family: endpoint.family }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    result.fetch = await fetch(`${base}/fetch`, { signal: controller.signal })
      .then((r) => ({ status: r.status, ok: r.ok }))
      .catch((e) => ({ error: String(e) }))
    clearTimeout(timer)
    result.xhr = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', `${base}/xhr`)
      xhr.timeout = 3000
      xhr.onload = () => resolve({ status: xhr.status })
      xhr.onerror = () => resolve({ error: 'error' })
      xhr.ontimeout = () => resolve({ error: 'timeout' })
      xhr.send()
    })
    result.beaconAccepted = navigator.sendBeacon(`${base}/beacon`, 'controlled')
    result.websocket = await new Promise((resolve) => {
      const socket = new WebSocket(`ws://${endpoint.tcp}/${input.case}/websocket`)
      const timer = setTimeout(() => {
        socket.close()
        resolve({ error: 'timeout' })
      }, 3000)
      socket.onopen = () => {
        clearTimeout(timer)
        socket.close()
        resolve({ opened: true })
      }
      socket.onerror = () => {
        clearTimeout(timer)
        resolve({ error: 'error' })
      }
    })
    // This receiver recognizes TURN/STUN wire messages but does not allocate a
    // relay. A received Allocate is request evidence, never a completed RTC link.
    try {
      const pc = new RTCPeerConnection({
        iceTransportPolicy: 'relay',
        iceServers: [
          {
            urls: `turn:${endpoint.udp}?transport=udp`,
            username: input.case,
            credential: 'controlled-canary',
          },
        ],
      })
      const candidates = []
      pc.onicecandidate = (event) => {
        if (event.candidate) candidates.push(event.candidate.candidate)
      }
      pc.createDataChannel('controlled')
      await pc.setLocalDescription(await pc.createOffer())
      await wait(3000)
      result.webrtc = { gatheringState: pc.iceGatheringState, candidates, relayOnly: true }
      pc.close()
    } catch (e) {
      result.webrtc = { error: String(e) }
    }
    results.push(result)
  }
  await wait(1000)
  return results
})()

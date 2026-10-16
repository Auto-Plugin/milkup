/* External diagnostic harness only. Install before plugin Workers are created.
 * Reads bounded debug metadata; never sends, acknowledges, or changes authority.
 * No timers, promises, microtasks, synthetic input, or production API hooks.
 */
;(() => {
  const key = '__milkupRenderTimingDiagnostic'
  if (Object.hasOwn(window, key)) throw new Error('Timing collector already installed')
  const BaseWorker = window.Worker
  const protocol = 'milkup.diagnostic.render-timing.v1'
  const supervisorProtocol = 'milkup.plugin.worker-supervisor.v1'
  const maxRecords = 8192
  const maxWorkers = 32
  const maxRealms = 64
  const stages = new Set([
    'supervisor-dispatch',
    'supervisor-result-handler',
    'supervisor-result-late',
    'supervisor-result-accepted',
    'supervisor-expire',
    'child-receive',
    'provider-enter',
    'provider-fulfilled',
    'provider-rejected',
    'output-validation-enter',
    'child-result-post-enter',
    'child-result-post-return',
  ])
  const names = new Set([
    'milkup-supervisor-milkup.math',
    'milkup-supervisor-milkup.diagrams',
    'milkup-supervisor-milkup.footnotes',
  ])
  const records = []
  const realms = new Map()
  const subscriptions = new Map()
  const totals = {
    seenFrames: 0,
    acceptedFrames: 0,
    acceptedRecords: 0,
    droppedRecords: 0,
    invalidFrames: 0,
    invalidRecords: 0,
    workerLimitDrops: 0,
    realmLimitDrops: 0,
    workerReportedDroppedLowerBound: 0,
    observationErrors: 0,
  }
  let stopped = false
  let workerSequence = 0
  const integer = (value) => Number.isSafeInteger(value) && value >= 0
  const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  const increment = (field, amount = 1) => {
    totals[field] = Math.min(Number.MAX_SAFE_INTEGER, totals[field] + amount)
  }
  const exactKeys = (value, keys) =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))

  function observe(data, workerId, workerName) {
    if (stopped) return
    // Unwrap only the host's ordinary child-data envelope. Never reinterpret a
    // child-shaped control as authority; this observer has no send/control path.
    let frame = data
    if (
      exactKeys(data, ['protocol', 'type', 'message']) &&
      data.protocol === supervisorProtocol &&
      data.type === 'child' &&
      Object.hasOwn(data, 'message')
    )
      frame = data.message
    if (!frame || typeof frame !== 'object' || frame.protocol !== protocol) return
    increment('seenFrames')
    if (
      !exactKeys(frame, [
        'protocol',
        'type',
        'realm',
        'realmInstance',
        'timeOrigin',
        'records',
        'accepted',
        'droppedLowerBound',
        'capped',
      ]) ||
      frame.type !== 'trace' ||
      !['supervisor', 'child'].includes(frame.realm) ||
      !integer(frame.realmInstance) ||
      frame.realmInstance < 1 ||
      !finite(frame.timeOrigin) ||
      !integer(frame.accepted) ||
      frame.accepted > 1024 ||
      !integer(frame.droppedLowerBound) ||
      typeof frame.capped !== 'boolean' ||
      !Array.isArray(frame.records) ||
      frame.records.length > 16
    ) {
      increment('invalidFrames')
      return
    }
    const realmKey = `${workerId}:${frame.realm}:${frame.realmInstance}:${frame.timeOrigin}`
    let realm = realms.get(realmKey)
    if (!realm) {
      if (realms.size >= maxRealms) {
        increment('realmLimitDrops')
        increment('droppedRecords', frame.records.length)
        return
      }
      realm = {
        workerId,
        workerName,
        realm: frame.realm,
        realmInstance: frame.realmInstance,
        timeOrigin: frame.timeOrigin,
        reportedAccepted: 0,
        reportedDroppedLowerBound: 0,
        capped: false,
        lastSequence: 0,
      }
      realms.set(realmKey, realm)
    }
    increment('acceptedFrames')
    realm.reportedAccepted = Math.max(realm.reportedAccepted, frame.accepted)
    const dropped = Math.max(realm.reportedDroppedLowerBound, frame.droppedLowerBound)
    increment('workerReportedDroppedLowerBound', dropped - realm.reportedDroppedLowerBound)
    realm.reportedDroppedLowerBound = dropped
    realm.capped ||= frame.capped
    for (const item of frame.records) {
      if (
        !exactKeys(item, ['sequence', 'id', 'stage', 'at', 'deadline']) ||
        !integer(item.sequence) ||
        item.sequence < 1 ||
        item.sequence <= realm.lastSequence ||
        typeof item.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) ||
        !stages.has(item.stage) ||
        !finite(item.at) ||
        (Object.hasOwn(item, 'deadline') && !finite(item.deadline))
      ) {
        increment('invalidRecords')
        continue
      }
      const safe = {
        sequence: item.sequence,
        id: item.id,
        stage: item.stage,
        at: item.at,
        ...(Object.hasOwn(item, 'deadline') ? { deadline: item.deadline } : {}),
      }
      if (JSON.stringify(safe).length > 384) {
        increment('invalidRecords')
        continue
      }
      realm.lastSequence = safe.sequence
      if (records.length >= maxRecords) {
        increment('droppedRecords')
        continue
      }
      records.push({
        workerId,
        workerName,
        realm: realm.realm,
        realmInstance: realm.realmInstance,
        timeOrigin: realm.timeOrigin,
        receivedAt: performance.now(),
        ...safe,
      })
      increment('acceptedRecords')
    }
  }

  class ObservedWorker extends BaseWorker {
    constructor(...args) {
      super(...args)
      // Observation failure must not change whether the Worker constructor succeeds.
      try {
        if (stopped) return
        const workerId = ++workerSequence
        if (subscriptions.size >= maxWorkers) {
          increment('workerLimitDrops')
          return
        }
        const name = args[1]?.name
        const workerName = names.has(name) ? name : null
        const listener = (event) => {
          try {
            observe(event.data, workerId, workerName)
          } catch {
            increment('observationErrors')
          }
        }
        this.addEventListener('message', listener)
        subscriptions.set(this, listener)
      } catch {
        increment('observationErrors')
      }
    }
  }

  function snapshot() {
    return {
      diagnosticOnly: true,
      authority: false,
      stopped,
      maxRecords,
      maxWorkers,
      maxRealms,
      collectorTimeOrigin: performance.timeOrigin,
      totals: { ...totals },
      cappedRealms: [...realms.values()].filter((realm) => realm.capped).length,
      records: records.map((record) => ({ ...record })),
      realms: [...realms.values()].map((realm) => ({ ...realm })),
      limitations: [
        'Worker-reported drops are lower bounds; terminated realms may lose queued debug frames.',
        'A missing stage is not proof it never executed; this collector cannot reconstruct unsent frames.',
        'provider-fulfilled to result-post includes validation, cleanup and microtask scheduling; it is not validation CPU time.',
        'No timers, stalls, retries, or completion acknowledgements are introduced by this collector.',
      ],
    }
  }
  function stop() {
    if (!stopped) {
      stopped = true
      for (const [worker, listener] of subscriptions)
        worker.removeEventListener('message', listener)
      subscriptions.clear()
      if (window.Worker === ObservedWorker) window.Worker = BaseWorker
    }
    return snapshot()
  }
  window.Worker = ObservedWorker
  Object.defineProperty(window, key, {
    configurable: true,
    value: Object.freeze({ snapshot, stop }),
  })
  return { installed: true, diagnosticOnly: true, maxRecords, maxWorkers, maxRealms }
})()

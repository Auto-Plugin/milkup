import assert from 'node:assert/strict'

export const FRONTEND_AUDIT_PREFIX = 'MILKUP_MERMAID_FRONTEND_AUDIT '
export const FRONTEND_RENDERER = 'frontend-mermaid-12.2.0'
const nonce = (value) => assert.match(value ?? '', /^[a-f0-9]{32}$/)
const hash = (value) => assert.match(value ?? '', /^[a-f0-9]{64}$/)

// Reuse only the exact process-generation accounting. No AppContainer, native
// helper, Job, or native protocol result is fabricated for browser rendering.
export function frontendLedgerClass(ProcessLedger) {
  return class FrontendLedger extends ProcessLedger {
    constructor(sid, session, kind, strict = true) {
      assert.equal(strict, true, 'Frontend acceptance never permits PID-only evidence')
      super(sid, session, kind, true)
      this.rendererMode = 'frontend'
      this.boundaries = new Map()
      this.released = new Set()
    }
    ownerKey(pid, birth, owner) {
      return `${pid}:${birth}:${owner}`
    }
    accept(value, pid, birth) {
      assert.equal(value?.renderer, FRONTEND_RENDERER)
      assert.equal(value.productPid, pid)
      birth = this.creationFor(pid, birth)
      assert(!this.launches.get(`${pid}:${birth}`).closed, 'No records after process close')
      assert(value.productCreationFileTime === undefined || value.productCreationFileTime === birth)
      assert(Number.isSafeInteger(value.timestampUnixMs) && value.timestampUnixMs > 0)
      assert(this.events.length < 1024, 'Bounded complete frontend evidence')
      const event = { ...value, productCreationFileTime: birth }
      this.events.push(event)
      if (event.kind) {
        assert(
          [
            'main-probe-dispatched',
            'frame-ipc-rejected',
            'frame-navigation-rejected',
            'owner-released',
          ].includes(event.kind),
        )
        if (event.kind === 'frame-ipc-rejected') {
          assert.equal(event.forwardedToTauri, false)
          assert.equal(typeof event.createdFrameNameMatched, 'boolean')
          if (!event.createdFrameNameMatched) return
        }
        nonce(event.nonce)
        const key = this.ownerKey(pid, birth, event.nonce)
        if (event.kind === 'main-probe-dispatched') {
          assert(!this.boundaries.has(key), 'Unique owner positive control')
          assert(Number.isSafeInteger(event.dispatchedProbes) && event.dispatchedProbes > 0)
          this.boundaries.set(key, { positive: event })
        } else if (event.kind === 'frame-ipc-rejected') {
          const proof = this.boundaries.get(key)
          assert(
            proof?.positive && !proof.negative,
            'Positive control before actual frame rejection',
          )
          assert.equal(
            event.dispatchedProbes,
            proof.positive.dispatchedProbes,
            'Frame attempt did not dispatch the native probe',
          )
          assert(Number.isSafeInteger(event.blockedMessages) && event.blockedMessages > 0)
          proof.negative = event
        } else if (event.kind === 'frame-navigation-rejected') {
          const proof = this.boundaries.get(key)
          assert(
            proof?.negative && !proof.navigation,
            'Navigation attempt follows real native IPC rejection',
          )
          assert.equal(event.cancelled, true)
          assert.equal(event.aboutBlank, true)
          assert(Number.isSafeInteger(event.blockedNavigations) && event.blockedNavigations > 0)
          proof.navigation = event
        } else {
          assert(!this.released.has(key), 'Unique owner release')
          assert.equal(event.frameDestroyed, true)
          assert.equal(event.pendingRequests, 0)
          assert.equal(
            event.hardTerminationProven,
            false,
            'Frame removal is not an OS kill guarantee',
          )
          for (const job of this.jobs.values())
            if (this.belongs(job, pid, birth) && job.admitted.ownerId === event.nonce)
              this.verifyFinished(job)
          this.released.add(key)
        }
        return
      }
      assert(['admitted', 'started', 'finished'].includes(event.phase))
      nonce(event.ownerId)
      nonce(event.requestId)
      hash(event.sourceSha256)
      const owner = this.ownerKey(pid, birth, event.ownerId)
      assert(!this.released.has(owner), 'No rendering after owner retirement')
      const key = `${pid}:${birth}:${event.requestId}`
      if (event.phase === 'admitted') {
        assert(!this.jobs.has(key), 'Unique request identity')
        const proof = this.boundaries.get(owner)
        assert(
          proof?.negative && proof.navigation,
          'Actual IPC and navigation rejection must precede source admission',
        )
        assert.equal(event.blockedNavigations, proof.navigation.blockedNavigations)
        assert.equal(event.nativeBridgeRejected, true)
        assert.equal(event.blockedMessages, proof.negative.blockedMessages)
        assert.equal(event.dispatchedProbes, proof.negative.dispatchedProbes)
        this.jobs.set(key, {
          productPid: pid,
          productCreationFileTime: birth,
          requestId: event.requestId,
          admitted: event,
        })
      } else {
        const job = this.jobs.get(key)
        assert(job && !job.finished, 'Request remains admitted and unfinished')
        assert.equal(event.ownerId, job.admitted.ownerId)
        assert.equal(event.sourceSha256, job.admitted.sourceSha256)
        assert(event.timestampUnixMs >= job.admitted.timestampUnixMs)
        if (event.phase === 'started') {
          assert(!job.started)
          job.started = event
        } else {
          job.finished = {
            ...event,
            successful: event.status === 'ready',
            rendererStatus:
              event.status === 'ready' ? 'ok' : event.status === 'error' ? 'error' : null,
            rendererErrorKind: event.errorCode,
            cancelled: event.status === 'cancelled',
            deadlineExpired: event.status === 'timeout',
          }
          this.verifyFinished(job)
        }
      }
    }
    verifyFinished(job) {
      const done = job.finished
      assert(done, 'Every admitted frontend request must settle')
      assert(['ready', 'error', 'cancelled', 'timeout'].includes(done.status))
      assert.equal(typeof done.consumerAborted, 'boolean')
      if (['ready', 'error'].includes(done.status))
        assert(job.started, 'Actual renderer entry is required')
      if (job.started) assert(done.timestampUnixMs >= job.started.timestampUnixMs)
      if (done.status === 'ready') {
        hash(done.pngSha256)
        assert(
          Number.isSafeInteger(done.pngBytes) &&
            done.pngBytes > 0 &&
            done.pngBytes <= 16 * 1024 * 1024,
        )
        assert(Number.isSafeInteger(done.width) && done.width > 0 && done.width <= 8192)
        assert(Number.isSafeInteger(done.height) && done.height > 0 && done.height <= 8192)
        assert(done.width * done.height <= 16 * 1024 * 1024)
      } else assert.equal(done.pngSha256, undefined, 'Rejected work cannot claim a published PNG')
      if (done.errorCode === 'unknown-diagram') {
        assert.equal(done.status, 'error')
        assert.equal(done.errorStage, 'mermaid-render')
      }
      return done
    }
    verifyReleased(pid, birth) {
      const jobs = this.verifyAll(pid, birth)
      for (const job of jobs)
        assert(
          this.released.has(
            this.ownerKey(job.productPid, job.productCreationFileTime, job.admitted.ownerId),
          ),
          'Native frame destruction and zero pending requests must be acknowledged',
        )
      return jobs
    }
    closeLaunch(record) {
      this.verifyReleased(record.productPid, record.creationFileTime)
      super.closeLaunch(record)
    }
    matchPng(pid, png, birth) {
      const result = super.matchPng(pid, png, birth)
      return { ...result, renderer: FRONTEND_RENDERER }
    }
  }
}

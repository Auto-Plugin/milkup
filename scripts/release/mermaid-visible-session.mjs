import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  source,
  fences,
  sha,
  ledgerFromLog,
  classifyEntry,
  documents,
  documentPath,
  requestSnapshot,
  cursorResult,
  collectStage,
  assertStartupRetained,
  warmApproachFrom,
} from './mermaid-visible-contract.mjs'
import {
  observe,
  decodeScript,
  startupPerformanceScript,
  validatePng,
} from '../../tests/windows/mermaid-product-e2e.mjs'
import { mermaidVisibilityScript } from '../../tests/windows/mermaid-visibility-observer.mjs'
import { openLatencyDocument } from './mermaid-visible-open.mjs'
const [mode, file] = process.argv.slice(2)
assert(['fixture', 'observe', 'verify'].includes(mode))
if (mode === 'fixture') {
  for (let i = 0; i < documents.length; i++)
    await writeFile(documentPath(file, i), documents[i].text, { flag: i === 0 ? 'w' : 'wx' })
  console.log(JSON.stringify({ documentSha256: sha(source), fences }))
} else {
  const raw = await readFile(file)
  assert(raw.length < 16384)
  const spec = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
  for (let i = 0; i < documents.length; i++)
    assert.equal(sha(await readFile(documentPath(spec.document, i))), sha(documents[i].text))
  assert.equal(spec.documentSha256, sha(source))
  const readLedger = async (final = false) =>
    ledgerFromLog(await readFile(spec.stderr), spec, final)
  if (mode === 'verify') {
    const ledger = await readLedger(true)
    ledger.verifyAll(spec.pid, spec.creationFileTime)
    ledger.verifyReleased(spec.pid, spec.creationFileTime)
    const record = JSON.parse(await readFile(spec.report, 'utf8'))
    let contractError
    try {
      assert.equal(record.status, 'observed-await-normal-close')
      assert.equal(record.spec.creationFileTime, spec.creationFileTime)
      assert.equal(record.baseline.inputCountBefore, record.baseline.inputCountAfter)
      assert.equal(record.baseline.inputCountAfter, 0, 'Initialization baseline has no input')
      assert.equal(record.baseline.last.catalogReady, true)
      assertStartupRetained(record.baseline)
      assert.deepEqual(
        cursorResult(record.cursor.before, record.cursor.after),
        record.cursor.result,
      )
      assert.equal(record.cursor.result.passed, true)
      assert(
        record.stages.every((s) => s.status === 'passed'),
        'All observation stages must pass',
      )
      assert.equal(record.images.length, 3)
      for (const image of record.images) ledger.matchPng(spec.pid, image.png)
      assert.equal(record.entries.length, 2)
      for (const entry of record.entries) {
        assert.deepEqual(classifyEntry(entry), entry.classification)
        if (entry.scenario === 'prefetch-ready')
          assert(
            entry.classification.prefetchComparisonEstablished,
            'Offscreen prefetch comparison required',
          )
      }
    } catch (error) {
      contractError = String(error)
    }
    console.log(
      JSON.stringify({
        status: contractError ? 'failed' : 'passed',
        frontendAudit: 'complete-and-released',
        records: ledger.events.length,
        requests: ledger.jobs.size,
        releasedOwners: ledger.released.size,
        productPid: spec.pid,
        creationFileTime: spec.creationFileTime,
        stderrSha256: sha(await readFile(spec.stderr)),
        stdoutSha256: sha(await readFile(spec.stdout)),
        ...(contractError ? { contractError } : {}),
        stages: record.stages,
      }),
    )
    if (contractError) process.exitCode = 1
  } else {
    const record = {
      status: 'running',
      spec,
      phases: [],
      inputs: [],
      images: [],
      entries: [],
      stages: [],
      nativeDialogs: [],
      boundary:
        'Single installed session; rAF layout evidence after attachment, not exact first paint or cold OS-cache benchmark',
    }
    const persist = () => writeFile(spec.report, JSON.stringify(record, null, 2))
    const mark = (name) =>
      record.phases.push({ name, unixMs: Date.now(), monotonicMs: performance.now() })
    const deadline = Date.now() + 225000
    let session
    const request = async (method, route, body) => {
      assert(Date.now() < deadline, 'Bounded installed session deadline')
      const r = await fetch(`http://127.0.0.1:${spec.driverPort}${route}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))),
      })
      const text = await r.text()
      assert(text.length <= 8 * 1024 * 1024, 'Bounded driver response')
      const value = JSON.parse(text)
      assert(r.ok && !value.value?.error, text.slice(0, 1500))
      return value.value ?? value
    }
    const execute = (script, ...args) =>
      request('POST', `/session/${session}/execute/sync`, { script, args })
    const until = async (fn, label, ms = 30000) => {
      const end = Math.min(Date.now() + ms, deadline)
      while (Date.now() < end) {
        const v = await fn()
        if (v) return v
        await delay(50)
      }
      throw Error('Timed out: ' + label)
    }
    const input = async (type, actions) => {
      assert(record.inputs.length < 100, 'Bounded real inputs')
      record.inputs.push({ type, actions, unixMs: Date.now() })
      await request('POST', `/session/${session}/actions`, {
        actions: [
          {
            type,
            id: type,
            ...(type === 'pointer' ? { parameters: { pointerType: 'mouse' } } : {}),
            actions,
          },
        ],
      })
    }
    const snapshot = () =>
      execute(`return {diagnostics:window.__milkupDesktopTest.getMermaidPresentationDiagnostics(),
      editorMode:document.querySelector('.milkup-editor')?.dataset.mode,
      storedPluginPolicy:localStorage.getItem('milkup.desktop.plugins.milkup.diagrams.render-mode.v1')}`)
    const checkpoint = async () => {
      const state = await execute(
        `const from=arguments[0];
        window.__latencyImageIds ||= { map:new WeakMap(), next:1 };
        const ids=window.__latencyImageIds,image=document.querySelector('[data-presentation-from="'+from+'"] img');
        if(image&&!ids.map.has(image))ids.map.set(image,ids.next++);
        const ready=performance.getEntriesByType('mark').find(m=>m.name==='milkup:startup:plugin-catalog-ready');
        return {timeOrigin:performance.timeOrigin,now:performance.now(),catalogReady:!!ready,catalogReadyAt:ready?.startTime??null,
        imageId:image?ids.map.get(image):null,decoded:!!image&&image.complete&&image.naturalWidth>0,
        diagnostics:window.__milkupDesktopTest.getMermaidPresentationDiagnostics()}`,
        fences[0].from,
      )
      state.unixMs = Date.now()
      const ledger = await readLedger()
      state.requests = requestSnapshot(ledger, fences[0].sourceSha256)
      state.allRequests = requestSnapshot(ledger)
      return state
    }
    const settled = async (timeline, requireCatalog = true, quietMs = 1500) => {
      let signature,
        quietSince = performance.now(),
        count = 0
      return until(
        async () => {
          assert(++count <= 1000, 'Bounded baseline samples')
          const current = await checkpoint()
          const next = JSON.stringify([
            current.catalogReady,
            current.imageId,
            current.decoded,
            current.requests,
            current.diagnostics,
          ])
          if (next !== signature) {
            signature = next
            quietSince = performance.now()
            assert(timeline.length < 128)
            timeline.push(current)
            await persist()
          }
          current.quietMs = performance.now() - quietSince
          return (
            (!requireCatalog || current.catalogReady) &&
            current.decoded &&
            current.diagnostics.pending === 0 &&
            !current.diagnostics.prefetchActive &&
            current.quietMs >= quietMs &&
            current
          )
        },
        'catalog and image/request quiet interval',
        45000,
      )
    }
    const readImage = async (fence, label) => {
      const script = decodeScript.replace(
        "const images=[...document.querySelectorAll('[data-document-presentation] img')];",
        "const images=[...document.querySelectorAll('[data-document-presentation] img')].filter(e=>Number(e.closest('[data-document-presentation]').dataset.presentationFrom)===" +
          fence.from +
          ');',
      )
      const result = await request('POST', `/session/${session}/execute/async`, {
        script,
        args: [null],
      })
      assert.equal(result.ok, true, result.error)
      const bytes = Buffer.from(result.value.base64, 'base64'),
        png = validatePng(bytes, 16 * 1024 * 1024)
      assert(result.value.fullyDecoded && result.value.nonuniform)
      const { match, job } = await until(
        async () => {
          const ledger = await readLedger()
          try {
            const match = ledger.matchPng(spec.pid, png)
            return {
              match,
              job: ledger.jobs.get(`${spec.pid}:${spec.creationFileTime}:${match.requestId}`),
            }
          } catch {
            return false
          }
        },
        'Matching exact PNG audit',
        5000,
      )
      assert.equal(job.admitted.sourceSha256, fence.sourceSha256)
      await writeFile(path.join(path.dirname(spec.report), `mermaid-visible-${label}.png`), bytes, {
        flag: 'wx',
      })
      const row = { label, png, native: match, ready: job.finished, started: job.started }
      record.images.push(row)
      return row
    }
    const wheel = async (fence) => {
      const point = await execute(
        `const editor=document.querySelector('.milkup-editor'),r=editor.getBoundingClientRect();
        const e=editor.querySelector('[data-presentation-from="'+arguments[0]+'"]')||editor.querySelector('.milkup-line[data-from="'+arguments[0]+'"]');
        return {x:Math.round((r.left+r.right)/2),y:Math.round((r.top+r.bottom)/2),deltaY:e?Math.round(e.getBoundingClientRect().top-r.top-25):1800}`,
        fence.from,
      )
      if (Math.abs(point.deltaY) < 2) point.deltaY = 2
      await input('wheel', [
        { type: 'scroll', origin: 'viewport', duration: 80, deltaX: 0, ...point },
      ])
    }
    try {
      await persist()
      mark('observer-started')
      await until(
        async () => {
          try {
            const r = await fetch(`http://127.0.0.1:${spec.debugPort}/json/version`, {
              signal: AbortSignal.timeout(1000),
            })
            if (!r.ok) return false
            record.devtools = await r.json()
            return true
          } catch {
            return false
          }
        },
        'owned WebView endpoint',
        45000,
      )
      mark('attach-started')
      const attached = await request('POST', '/session', {
        capabilities: {
          alwaysMatch: {
            browserName: 'webview2',
            'ms:edgeChromium': true,
            'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${spec.debugPort}` },
          },
        },
      })
      session = record.sessionId = attached.sessionId
      assert(session)
      assert.equal(attached.capabilities.browserVersion, spec.runtimeVersion)
      mark('attached')
      await persist()
      await request('POST', `/session/${session}/timeouts`, {
        script: 15000,
        pageLoad: 15000,
        implicit: 0,
      })
      await until(async () => {
        const s = await execute(observe)
        return (
          s.loading === 'ready' &&
          path.resolve(s.path).toLowerCase() === path.resolve(spec.document).toLowerCase()
        )
      }, 'exact document open')
      mark('document-ready')
      record.initialAtInstall = await execute(mermaidVisibilityScript, {
        ...fences[0],
        scenario: 'document-open',
      })
      record.initialContext = await snapshot()
      record.baseline = {
        inputCountBefore: record.inputs.length,
        first: await checkpoint(),
        transitions: [],
      }
      record.baseline.attachedAfterCatalogReady = record.baseline.first.catalogReady
      // No pointer/key/wheel before this baseline ends. The mark precedes the
      // catalog refresh, so require a further 1.5-second image/request quiet interval.
      await collectStage(
        record,
        'no-input-initialization',
        async () => {
          record.baseline.last = await settled(record.baseline.transitions)
          record.baseline.inputCountAfter = record.inputs.length
          record.baseline.sameImage =
            record.baseline.first.imageId !== null &&
            record.baseline.first.imageId === record.baseline.last.imageId
          record.initial = await execute('return window.__mermaidInitialVisibilityProbe.report')
          assert(record.initial.complete, 'Initial visibility completed')
          record.startupPerformance = await execute(startupPerformanceScript)
          await readImage(fences[0], 'open')
          assert.equal(record.baseline.inputCountAfter, 0)
          assertStartupRetained(record.baseline)
        },
        persist,
      )
      await collectStage(
        record,
        'post-catalog-cursor',
        async () => {
          assert(record.baseline.last?.catalogReady, 'Confirmed catalog baseline required')
          const quiet = []
          const before = await settled(quiet)
          record.cursor = { before, quiet, inputCountBefore: record.inputs.length }
          const point =
            await execute(`const e=document.querySelector('.milkup-line[data-from="0"]'),r=e.getBoundingClientRect();
          return {x:Math.round(r.left+12),y:Math.round(r.top+r.height/2)}`)
          await input('pointer', [
            { type: 'pointerMove', origin: 'viewport', duration: 0, ...point },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ])
          await input(
            'key',
            Array.from({ length: 20 }, () => ['\uE014', '\uE012'])
              .flat()
              .flatMap((value) => [
                { type: 'keyDown', value },
                { type: 'keyUp', value },
              ]),
          )
          record.cursor.transitions = []
          record.cursor.after = await settled(record.cursor.transitions)
          record.cursor.inputCountAfter = record.inputs.length
          record.cursor.result = cursorResult(before, record.cursor.after)
          record.postCursorStartup = await execute(startupPerformanceScript)
          assert(
            record.cursor.result.passed,
            'Isolated cursor changed requests, actual renders or image identity',
          )
        },
        persist,
      )
      for (let index = 1; index < 3; index++) {
        const fence = fences[index],
          scenario = index === 1 ? 'cold-entry' : 'prefetch-ready'
        await collectStage(
          record,
          scenario,
          async () => {
            assert(
              deadline - Date.now() > 65000,
              'Insufficient bounded time for independent document',
            )
            const target = documentPath(spec.document, index)
            const row = {
              scenario,
              ...fence,
              document: target,
              documentSha256: sha(documents[index].text),
            }
            record.entries.push(row)
            row.openStartedUnix = Date.now()
            const proof = await openLatencyDocument({
              target,
              output: path.dirname(spec.report),
              pid: String(spec.pid),
              birth: spec.creationTicks,
              image: spec.image,
              receiptIndex: index,
              until,
              trigger: () =>
                input('key', [
                  { type: 'keyDown', value: '\uE009' },
                  { type: 'keyDown', value: 'o' },
                  { type: 'keyUp', value: 'o' },
                  { type: 'keyUp', value: '\uE009' },
                ]),
            })
            record.nativeDialogs.push(proof)
            await until(async () => {
              const s = await execute(observe)
              return (
                s.loading === 'ready' &&
                path.resolve(s.path).toLowerCase() === path.resolve(target).toLowerCase()
              )
            }, 'independent exact document')
            row.documentReadyUnix = Date.now()
            row.before = await snapshot()
            const ledger = await readLedger()
            row.readyAtInstall = [...ledger.jobs.values()]
              .filter(
                (j) => j.admitted.sourceSha256 === fence.sourceSha256 && j.finished?.successful,
              )
              .map((j) => j.finished)
            row.observerAtInstall = await execute(mermaidVisibilityScript, { ...fence, scenario })
            if (index === 2) {
              // Do not wait on a target already visible after file switching.
              await until(async () => {
                const o = await execute('return window.__mermaidVisibilityProbe.report')
                return o.samples > 0
              }, 'first offscreen sample')
              row.beforePreparation = await execute('return window.__mermaidVisibilityProbe.report')
              assert.equal(
                row.beforePreparation.firstVisible,
                null,
                'Warm target must start offscreen',
              )
              assert.equal(
                row.readyAtInstall.length,
                0,
                'Independent warm source must not already be prepared',
              )
              row.preparationInputUnix = Date.now()
              await wheel({ from: warmApproachFrom })
              await until(async () => {
                const ledger = await readLedger()
                row.prefetchReady = [...ledger.jobs.values()].find(
                  (j) => j.admitted.sourceSha256 === fence.sourceSha256 && j.finished?.successful,
                )?.finished
                return row.prefetchReady
              }, 'independent offscreen source ready')
              row.before = await snapshot()
            }
            row.beforeWheelObservation = await execute(
              'return window.__mermaidVisibilityProbe.report',
            )
            row.firstInputUnix = Date.now()
            // No readiness wait in cold-entry. If prior preparation wins the race,
            // classify it as already warm rather than manufacturing a cold sample.
            for (let i = 0; i < 12; i++) {
              await wheel(fence)
              await delay(30)
              row.observation = await execute('return window.__mermaidVisibilityProbe.report')
              if (row.observation.firstVisible !== null) break
            }
            await until(async () => {
              row.observation = await execute('return window.__mermaidVisibilityProbe.report')
              return row.observation.complete
            }, 'visible target diagram')
            const image = await readImage(fence, scenario)
            row.ready = image.ready
            row.started = image.started
            row.classification = classifyEntry(row)
            row.after = await snapshot()
            if (index === 2)
              assert(
                row.classification.prefetchComparisonEstablished,
                'Warm control requires observed offscreen entry, not a left-censored visible image',
              )
            await persist()
          },
          persist,
        )
      }
      for (let i = 0; i < documents.length; i++)
        assert.equal(sha(await readFile(documentPath(spec.document, i))), sha(documents[i].text))
      assert.equal((await execute(observe)).dirty, false)
      record.finalContext = await snapshot()
      assert.equal(
        record.finalContext.editorMode,
        record.initialContext.editorMode,
        'No global mode change',
      )
      record.status = 'observed-await-normal-close'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      process.exitCode = 1
    } finally {
      if (session) {
        record.finalObservation =
          await execute(`return {initial:window.__mermaidInitialVisibilityProbe?.report,
          entry:window.__mermaidVisibilityProbe?.report}`).catch((error) => ({
            captureError: String(error),
          }))
      }
      mark('observer-finished')
      await persist()
    }
  }
}

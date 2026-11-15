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
  collectStage,
  selectMermaidEntryPolicy,
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
      assert.equal(record.scope, 'plugin-render-entry-only')
      assert.deepEqual(
        record.stages.map((s) => s.name),
        ['entry-plugin-render-policy', 'cold-entry', 'prefetch-ready'],
      )
      assert.equal(record.entryPolicy?.policy, 'preview')
      assert.equal(record.entryPolicy.after.editorMode, record.initialContext.editorMode)
      assert(
        record.stages.every((s) => s.status === 'passed'),
        'All observation stages must pass',
      )
      assert.equal(record.images.length, 2)
      for (const image of record.images) ledger.matchPng(spec.pid, image.png)
      assert.equal(record.entries.length, 2)
      for (const entry of record.entries) {
        assert.deepEqual(classifyEntry(entry), entry.classification)
        if (entry.scenario === 'cold-entry')
          assert(entry.classification.coldComparisonEstablished, 'Genuine cold entry required')
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
      scope: 'plugin-render-entry-only',
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
    const policyState = () =>
      execute(`const menu=document.querySelector('[data-app-menu]');
      return {editorMode:document.querySelector('.milkup-editor')?.dataset.mode,
      menu:!!menu&&getComputedStyle(menu).display!=='none'&&menu.getBoundingClientRect().height>0,
      details:!!document.querySelector('[data-plugin-action="back"]'),
      selectedPolicy:document.querySelector('[data-mermaid-render-mode]')?.value,
      storedPluginPolicy:localStorage.getItem('milkup.desktop.plugins.milkup.diagrams.render-mode.v1')}`)
    const pointer = async (selector) => {
      for (let i = 0; i < 16; i++) {
        const t = await execute(
          `const e=document.querySelector(arguments[0]);if(!e)return null;
          const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
          let p=e.parentElement;while(p&&!(p.scrollHeight>p.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(p).overflowY)))p=p.parentElement;
          const b=p?.getBoundingClientRect(),h=document.elementFromPoint(x,y);
          return {x:Math.round(x),y:Math.round(y),disabled:!!e.disabled,hit:!!h&&(e===h||e.contains(h))&&r.width>0&&r.height>0,
          scroll:b?{x:Math.round((b.left+b.right)/2),y:Math.round((b.top+b.bottom)/2),deltaY:y<b.top?-180:180}:null}`,
          selector,
        )
        assert(t && !t.disabled, 'Existing enabled UI control: ' + selector)
        if (t.hit) {
          await input('pointer', [
            { type: 'pointerMove', origin: 'viewport', duration: 50, x: t.x, y: t.y },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ])
          return
        }
        assert(t.scroll, 'UI control must have a real scroll path')
        await input('wheel', [
          { type: 'scroll', origin: 'viewport', duration: 100, deltaX: 0, ...t.scroll },
        ])
        await delay(100)
      }
      throw Error('Could not reveal plugin UI control: ' + selector)
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
      record.initialContext = await snapshot()
      // Prior runs already established initialization/cursor behavior. This run
      // only waits for the catalog prerequisite; it does not repeat those tests.
      await until(
        () =>
          execute(
            "return performance.getEntriesByType('mark').some(m=>m.name==='milkup:startup:plugin-catalog-ready')",
          ),
        'Catalog prerequisite',
      )
      record.startupPerformance = await execute(startupPerformanceScript)
      await collectStage(
        record,
        'entry-plugin-render-policy',
        async () => {
          record.entryPolicy = await selectMermaidEntryPolicy({
            pointer,
            observe: policyState,
            until,
            keys: (value) =>
              input(
                'key',
                [...value].flatMap((v) => [
                  { type: 'keyDown', value: v },
                  { type: 'keyUp', value: v },
                ]),
              ),
          })
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
            assert.equal(
              record.entryPolicy?.policy,
              'preview',
              'Confirmed plugin render policy required',
            )
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
            // Arm while the previous document is still open. The observer is
            // path/loading gated, so old matching offsets cannot count as entry.
            // Native file-picker acknowledgement can arrive after prefetch.
            const armedLedger = await readLedger()
            row.requestsAtArm = requestSnapshot(armedLedger, fence.sourceSha256)
            assert.equal(
              row.requestsAtArm.admitted.length,
              0,
              'No pending or completed prior source at arm',
            )
            row.readyAtArm = [...armedLedger.jobs.values()]
              .filter(
                (j) => j.admitted.sourceSha256 === fence.sourceSha256 && j.finished?.successful,
              )
              .map((j) => j.finished)
            assert.equal(row.readyAtArm.length, 0, 'Independent source must be unused when armed')
            row.observerAtInstall = await execute(mermaidVisibilityScript, {
              ...fence,
              scenario,
              expectedDocument: target,
            })
            row.policyAtArm = await snapshot()
            await persist()
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
              // Preparation may complete during picker acknowledgement, but
              // only the pre-armed offscreen timeline can authorize that case.
              if (!row.readyAtInstall.length) {
                row.preparationInputUnix = Date.now()
                await wheel({ from: warmApproachFrom })
              }
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
            if (index === 1)
              assert(row.classification.coldComparisonEstablished, 'Genuine cold entry required')
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

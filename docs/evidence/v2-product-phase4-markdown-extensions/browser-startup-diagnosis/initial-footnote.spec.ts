import { test, expect } from '/workspace/milkup/node_modules/@playwright/test/index.mjs'
import { writeFile } from 'node:fs/promises'
import {
  markdownExtensionFixture,
  seedMarkdownExtensions,
} from '/workspace/milkup/tests/helpers/markdown-extension-plugins'
const fixture = [
  '安全起点 中文😀',
  '',
  '行内 $x^2 + \\frac{1}{2}$ 末尾',
  '',
  '$$',
  '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
  '$$',
  '',
  '```mermaid',
  'flowchart LR',
  'A[中文] --> B[结束]',
  '```',
  '',
  '引用[^n]。',
  '',
  '[^n]: 脚注 **正文**',
  '',
  '终点',
].join('\n')
test('original initial footnote assertion with passive transport observation', async ({
  page,
}, info) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(() => {
    const events: unknown[] = []
    ;(window as any).__presentationDiagnostic = events
    const push = (value: object) => {
      if (events.length < 10000)
        events.push({ time: performance.now(), wall: Date.now(), ...value })
    }
    const describe = (raw: any) => {
      const outer = raw?.protocol === 'milkup.plugin.worker-supervisor.v1'
      const unwrap =
        outer && (raw.type === 'forward' || raw.type === 'child') && Object.hasOwn(raw, 'message')
      const value = unwrap ? raw.message : raw
      return {
        outerProtocol: outer ? raw.protocol : undefined,
        outerType: outer ? raw.type : undefined,
        control:
          outer && raw.type === 'control' && !Object.hasOwn(raw, 'message')
            ? { event: raw.event, id: raw.id }
            : undefined,
        protocol: value?.protocol,
        type: value?.type,
        id: value?.id,
        method: value?.method,
        ok: value?.ok,
        error: value?.error,
        pluginId: value?.payload?.pluginId,
        rendererId: value?.payload?.rendererId,
        request: value?.payload?.request
          ? {
              documentId: value.payload.request.documentId,
              version: value.payload.request.version,
              from: value.payload.request.from,
              to: value.payload.request.to,
              contextKnown: value.payload.request.contextKnown,
              selection: value.payload.request.selection,
              sourceLength: value.payload.request.source?.length,
            }
          : undefined,
        result:
          value?.value && typeof value.value === 'object'
            ? { complete: value.value.complete, fragments: value.value.fragments?.length }
            : undefined,
      }
    }
    const OriginalWorker = window.Worker
    let counter = 0
    window.Worker = class extends OriginalWorker {
      readonly diagnosticId = ++counter
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        push({
          kind: 'worker-create',
          worker: this.diagnosticId,
          name: options?.name,
          url: String(url),
        })
        this.addEventListener('message', (event) =>
          push({ kind: 'receive', worker: this.diagnosticId, ...describe(event.data) }),
        )
        this.addEventListener('error', (event) =>
          push({ kind: 'worker-error', worker: this.diagnosticId, message: event.message }),
        )
      }
      postMessage(message: any, transferOrOptions?: any) {
        push({ kind: 'send', worker: this.diagnosticId, ...describe(message) })
        super.postMessage(message, transferOrOptions)
      }
      terminate() {
        push({ kind: 'terminate', worker: this.diagnosticId })
        super.terminate()
      }
    }
    const registry = () => {
      try {
        return JSON.parse(
          localStorage.getItem('milkup.desktop.plugins.registry.v1') ?? '{}',
        ).records?.map((r: any) => ({
          id: r.manifest.id,
          state: r.state,
          enabled: r.enabled,
          updatedAt: r.updatedAt,
          errors: r.errors,
          runtimeFailure: r.runtimeFailure,
        }))
      } catch {
        return 'unreadable'
      }
    }
    const originalSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      originalSet.call(this, key, value)
      if (this === localStorage && key === 'milkup.desktop.plugins.registry.v1')
        push({ kind: 'registry-write', registry: registry() })
    }
    let last = ''
    setInterval(() => {
      const state = {
        registry: registry(),
        math: document.querySelectorAll('.milkup-document-presentation math').length,
        svg: document.querySelectorAll('.milkup-document-presentation svg').length,
        reference: document.querySelectorAll('.milkup-document-reference').length,
        presentation: document
          .querySelector('.milkup-editor-content')
          ?.getAttribute('data-document-presentation-status'),
        notice: document.querySelector('[data-document-presentation-notice]')?.textContent,
        lines: document.querySelectorAll('.milkup-line').length,
      }
      const key = JSON.stringify(state)
      if (key !== last) {
        last = key
        push({ kind: 'state', ...state })
      }
    }, 100)
  })
  try {
    await markdownExtensionFixture(page)
    await page.evaluate(() =>
      (window as any).__presentationDiagnostic.push({
        kind: 'fixture-return',
        time: performance.now(),
      }),
    )
    await seedMarkdownExtensions(page, fixture)
    await page.evaluate(() =>
      (window as any).__presentationDiagnostic.push({
        kind: 'seed-return',
        time: performance.now(),
      }),
    )
    await expect(page.locator('.milkup-document-reference').first()).toBeVisible()
  } finally {
    const events = await page.evaluate(() => (window as any).__presentationDiagnostic)
    await writeFile(
      info.outputPath('timeline.json'),
      JSON.stringify(
        {
          note: 'Passive main-realm observation; no retries, gates, increased expectation timeout, or product instrumentation. Supervisor clock is not observed.',
          pageErrors,
          events,
        },
        null,
        2,
      ),
    )
    await page.screenshot({ path: info.outputPath('final.png'), fullPage: true })
  }
})

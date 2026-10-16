import { expect, test, type Page } from '/workspace/milkup/node_modules/@playwright/test/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

async function fixture(page: Page, mode = 'valid') {
  // Real standalone Worker + real public SDK RPC. Only native transport is replaced.
  const manifest = JSON.parse(await readFile('plugins/updates/plugin.json', 'utf8'))
  const bundle = await build({
    entryPoints: ['plugins/updates/src/plugin.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  })
  manifest.main = 'data:text/javascript,' + encodeURIComponent(bundle.outputFiles[0]!.text)
  await page.addInitScript(
    ({ manifest, mode }) => {
      const state = { mode, installs: 0, cancels: 0, downloads: 0 }
      const host = window as unknown as { releaseFixture: typeof state; releaseTransport: unknown }
      host.releaseFixture = state
      host.releaseTransport = {
        async check() {
          await new Promise((resolve) => setTimeout(resolve, 180))
          if (state.mode === 'offline') throw Error('检查失败：离线')
          return {
            configured: state.mode !== 'unconfigured',
            channel: 'beta',
            update: {
              token: 1,
              version: '2.0.0-beta.2',
              notes: '改进编辑\n<script>说明按纯文本展示</script>',
              date: null,
            },
          }
        },
        async download(_token: number, progress: (event: unknown) => void) {
          const run = ++state.downloads
          for (const received of [2048, 8192]) {
            progress({
              phase: 'downloading',
              received,
              total: state.mode === 'unknown' ? null : 8192,
            })
            await new Promise((resolve) => setTimeout(resolve, 300))
            if (state.cancels >= run) throw Error('下载取消')
          }
          progress({ phase: 'verifying', received: 8192, total: null })
          if (state.mode === 'signature') throw Error('签名校验失败')
        },
        async cancel() {
          state.cancels++
        },
        async install() {
          state.installs++
          throw Error('测试安装器失败：保留编辑器')
        },
      }
      const record = {
        manifest,
        manifestPath: '/plugins/updates/plugin.json',
        rootPath: '/plugins/updates',
        sourcePath: '/plugins/updates/plugin.json',
        state: 'installed',
        enabled: false,
        installedAt: 1,
        updatedAt: 1,
        trust: 'development',
        approvals: { permissions: [], hosts: ['worker'] },
        errors: [],
      }
      localStorage.setItem(
        'milkup.desktop.plugins.registry.v1',
        JSON.stringify({ version: 1, records: [record], auditRecords: [] }),
      )
    },
    { manifest, mode },
  )
  await page.route(/\/src\/plugin-release-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function nativeReleaseTransport() {',
      'function nativeReleaseTransport() { return window.releaseTransport;',
    )
    await route.fulfill({ response, body })
  })
  await page.goto('/')
}
async function open(page: Page) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: 'Milkup Updates', exact: true }).click()
  await page.getByRole('button', { name: '批准能力', exact: true }).click()
  await page.getByRole('button', { name: '启用', exact: true }).click()
  // Activation uses the host's 10-second Worker startup budget.
  await expect(page.locator('.plugin-state')).toHaveText('已启用', { timeout: 10_000 })
  await page.getByRole('button', { name: '打开 软件更新', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '软件更新', exact: true })).toBeVisible()
}
const modal = (page: Page) => page.getByRole('dialog', { name: '软件更新', exact: true })
const installCount = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { releaseFixture: { installs: number } }).releaseFixture.installs,
  )
async function ready(page: Page) {
  await open(page)
  await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
}

test('original Updates enable assertion with passive startup observation', async ({
  page,
}, info) => {
  const delayEvents: any[] = []
  let delayed = false,
    passed = false
  await page.context().route('**/plugin-worker.ts?*', async (route) => {
    if (!delayed) {
      delayed = true
      delayEvents.push({ kind: 'delay-start', wall: Date.now() })
      await new Promise((resolve) => setTimeout(resolve, 5500))
      delayEvents.push({ kind: 'delay-end', wall: Date.now() })
    }
    await route.continue()
  })
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.addInitScript(() => {
    const events: any[] = []
    ;(window as any).__updatesDiagnostic = events
    const push = (x: any) => events.push({ time: performance.now(), wall: Date.now(), ...x })
    const Base = window.Worker
    let id = 0
    window.Worker = class extends Base {
      readonly diagnosticId = ++id
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts)
        push({ kind: 'new', worker: this.diagnosticId, url: String(url), name: opts?.name })
        this.addEventListener('message', (e) => {
          const m = e.data
          push({
            kind: 'receive',
            worker: this.diagnosticId,
            protocol: m?.protocol,
            type: m?.type,
            id: m?.id,
            method: m?.method,
            ok: m?.ok,
            error: m?.error,
          })
        })
        this.addEventListener('error', (e) => push({ kind: 'worker-error', message: e.message }))
      }
      postMessage(m: any, options?: any) {
        push({
          kind: 'send',
          worker: this.diagnosticId,
          protocol: m?.protocol,
          type: m?.type,
          id: m?.id,
          method: m?.method,
        })
        super.postMessage(m, options)
      }
      terminate() {
        push({ kind: 'terminate', worker: this.diagnosticId })
        super.terminate()
      }
    }
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      original.call(this, k, v)
      if (this === localStorage && k === 'milkup.desktop.plugins.registry.v1') {
        const s = JSON.parse(v)
        push({
          kind: 'registry',
          records: s.records.map((r: any) => ({
            id: r.manifest.id,
            state: r.state,
            enabled: r.enabled,
            updatedAt: r.updatedAt,
            errors: r.errors,
          })),
          audit: s.auditRecords,
        })
      }
    }
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target as HTMLElement
        const b = t?.closest('button')
        if (b)
          push({
            kind: 'click',
            text: b.textContent,
            action: b.dataset.pluginAction,
            trusted: e.isTrusted,
          })
      },
      true,
    )
  })
  try {
    await fixture(page)
    await page.evaluate(() =>
      (window as any).__updatesDiagnostic.push({ kind: 'fixture-return', time: performance.now() }),
    )
    await open(page)
    passed = true
  } finally {
    if (!passed) {
      delayEvents.push({ kind: 'post-failure-observation-start', wall: Date.now() })
      await page
        .waitForFunction(
          () => {
            const s = JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1') ?? '{}')
            return (
              s.records?.some(
                (r: any) =>
                  r.manifest.id === 'milkup.updates' && r.enabled && r.state === 'enabled',
              ) &&
              s.auditRecords?.some(
                (a: any) =>
                  a.pluginId === 'milkup.updates' && a.operation === 'enable' && !a.denied,
              )
            )
          },
          undefined,
          { timeout: 10000 },
        )
        .catch((e) => delayEvents.push({ kind: 'observation-error', message: String(e) }))
      delayEvents.push({ kind: 'post-failure-observation-end', wall: Date.now() })
    }
    await writeFile(
      info.outputPath('timeline.json'),
      JSON.stringify(
        {
          passed,
          delayEvents,
          pageErrors,
          events: await page.evaluate(() => (window as any).__updatesDiagnostic),
        },
        null,
        2,
      ),
    )
    await page.screenshot({ path: info.outputPath('final.png'), fullPage: true })
  }
})

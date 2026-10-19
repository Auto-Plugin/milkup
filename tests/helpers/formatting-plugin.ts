import { sealWorkerFixture } from './sealed-plugin-fixture'
import { expect, test, type ConsoleMessage, type Page, type Worker } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

// A genuine isolated Worker entry bundled solely through the public SDK.
export async function formattingFixture(page: Page) {
  const started = performance.now()
  const phases: { phase: string; elapsedMs: number }[] = []
  const events: { kind: string; elapsedMs: number; message: string }[] = []
  let droppedEvents = 0
  const phase = (phase: string) => phases.push({ phase, elapsedMs: performance.now() - started })
  const event = (kind: string, message: string) => {
    if (events.length >= 40) {
      droppedEvents++
      return
    }
    events.push({ kind, elapsedMs: performance.now() - started, message: message.slice(0, 2000) })
  }
  const onConsole = (message: ConsoleMessage) => event(`console:${message.type()}`, message.text())
  const onPageError = (error: Error) => event('pageerror', error.message)
  const onWorker = (worker: Worker) => event('worker-created', worker.url())
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('worker', onWorker)
  phase('fixture-started')
  try {
    const manifest = JSON.parse(await readFile('plugins/formatting/plugin.json', 'utf8'))
    phase('manifest-read')
    const bundle = await build({
      entryPoints: ['plugins/formatting/src/plugin.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
    })
    phase('bundle-built')
    await sealWorkerFixture(
      page,
      manifest,
      '/plugins/formatting/plugin.json',
      bundle.outputFiles[0]!.text,
    )
    phase('archive-route-sealed')
    await page.addInitScript((manifest) => {
      localStorage.setItem(
        'milkup.desktop.plugins.registry.v1',
        JSON.stringify({
          version: 1,
          records: [
            {
              manifest,
              manifestPath: '/plugins/formatting/plugin.json',
              rootPath: '/plugins/formatting',
              sourcePath: '/plugins/formatting/plugin.json',
              dataRoot: `milkup://plugin-data/${manifest.id}`,
              storageRoot: `milkup://plugin-storage/${manifest.id}`,
              state: 'installed',
              enabled: false,
              installedAt: 1,
              updatedAt: 1,
              trust: 'development',
              approvals: { permissions: [], hosts: ['worker'] },
              errors: [],
            },
          ],
          auditRecords: [],
        }),
      )
    }, manifest)
    phase('registry-seed-registered')
    await page.goto('/')
    phase('page-loaded')
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    phase('menu-clicked')
    await page.getByRole('button', { name: '插件', exact: true }).click()
    phase('plugins-clicked')
    await page.getByRole('button', { name: 'Milkup Formatting', exact: true }).click()
    phase('plugin-details-clicked')
    const approve = page.getByRole('button', { name: '批准能力', exact: true })
    if (await approve.isVisible()) await approve.click()
    else await expect(page.getByRole('button', { name: '撤销审批', exact: true })).toBeVisible()
    phase('approval-step-completed')
    await page.getByRole('button', { name: '启用', exact: true }).click()
    phase('enable-clicked')
    await page.locator('[data-menu-close]').click()
    phase('menu-close-clicked')
    await expect(
      page
        .locator('[data-plugin-slot="document-toolbar"]')
        .getByRole('button', { name: '格式', exact: true }),
    ).toBeVisible()
    phase('toolbar-visible')
  } catch (error) {
    phase('fixture-failed')
    // Failure-only observation: never change activation, retry, or the original assertion.
    try {
      const snapshot = await page
        .evaluate(() => {
          const clip = (value: unknown) => String(value ?? '').slice(0, 2000)
          let registry: unknown
          try {
            const raw = localStorage.getItem('milkup.desktop.plugins.registry.v1')
            const value = JSON.parse(raw ?? 'null')
            const record = value?.records?.find(
              (record: { manifest?: { id?: string } }) =>
                record.manifest?.id === 'milkup.formatting',
            )
            registry = record
              ? {
                  id: record.manifest.id,
                  state: clip(record.state),
                  enabled: record.enabled === true,
                  approvals: {
                    permissions: Array.isArray(record.approvals?.permissions)
                      ? record.approvals.permissions.slice(0, 32).map(clip)
                      : [],
                    hosts: Array.isArray(record.approvals?.hosts)
                      ? record.approvals.hosts.slice(0, 8).map(clip)
                      : [],
                  },
                  errors: Array.isArray(record.errors) ? record.errors.slice(0, 16).map(clip) : [],
                  runtimeFailure: record.runtimeFailure
                    ? {
                        kind: clip(record.runtimeFailure.kind),
                        message: clip(record.runtimeFailure.message),
                      }
                    : null,
                }
              : { missing: true }
          } catch (error) {
            registry = { readError: clip(error) }
          }
          return {
            registry,
            viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
            visualViewport: window.visualViewport
              ? {
                  width: window.visualViewport.width,
                  height: window.visualViewport.height,
                  scale: window.visualViewport.scale,
                }
              : null,
            cssZoom: getComputedStyle(document.documentElement).zoom,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
            toolbar: document
              .querySelector('[data-plugin-slot="document-toolbar"]')
              ?.outerHTML.slice(0, 16000),
            manager: document.querySelector('[data-plugin-manager]')?.outerHTML.slice(0, 16000),
          }
        })
        .catch((error: unknown) => ({ snapshotError: String(error).slice(0, 2000) }))
      const body = await page
        .locator('body')
        .ariaSnapshot({ timeout: 1000 })
        .then((value) => value.slice(0, 32000))
        .catch((error: unknown) => `Snapshot unavailable: ${String(error).slice(0, 2000)}`)
      await Promise.allSettled([
        test.info().attach('formatting-fixture-diagnostics', {
          body: JSON.stringify({ phases, events, droppedEvents, snapshot }, null, 2),
          contentType: 'application/json',
        }),
        test.info().attach('formatting-fixture-body', { body, contentType: 'text/plain' }),
      ])
    } catch {
      // Diagnostic failures must never replace the original fixture error.
    }
    throw error
  } finally {
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('worker', onWorker)
  }
}

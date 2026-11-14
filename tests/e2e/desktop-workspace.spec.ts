import { sealWorkerFixture } from '../helpers/sealed-plugin-fixture'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

type NativeCall = { command: string; args: Record<string, unknown> }
type WorkspaceFixture = {
  calls: NativeCall[]
  chosen: number
  opened: number
  restored: number
  chooseDelay: number
}

async function fixture(page: Page): Promise<void> {
  const manifest = JSON.parse(await readFile('plugins/workspace/plugin.json', 'utf8'))
  const bundle = await build({
    entryPoints: ['plugins/workspace/src/plugin.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  })
  await sealWorkerFixture(
    page,
    manifest,
    '/plugins/workspace/plugin.json',
    bundle.outputFiles[0]!.text,
  )
  await page.addInitScript(
    ({ manifest }) => {
      const state: WorkspaceFixture = {
        calls: [],
        chosen: 0,
        opened: 0,
        restored: 0,
        chooseDelay: 180,
      }
      const root = () => ({
        id: `root-${state.chosen}-${state.restored}`,
        key: 'stable-notes',
        label: 'Notes',
      })
      const entry = { id: 'a', name: 'a.md', kind: 'file', relativePath: 'docs/a.md' }
      Object.assign(window, {
        workspaceFixture: state,
        workspaceTransport: async (command: string, args: Record<string, unknown> = {}) => {
          state.calls.push({ command, args })
          if (command === 'workspace_create_scope') return 'scope-one'
          // Test-only native persistence surrogate. Production memory lives in Rust,
          // outside plugin storage; this fixture exercises the actual Worker RPC.
          if (command === 'workspace_restore_root') {
            if (!localStorage.getItem('fixture.native.workspace-memory')) return null
            state.restored++
            return root()
          }
          if (command === 'workspace_remember_root') {
            localStorage.setItem('fixture.native.workspace-memory', 'selected-by-native-picker')
            return undefined
          }
          if (command === 'workspace_choose_root') {
            await new Promise((resolve) => setTimeout(resolve, state.chooseDelay))
            state.chosen++
            return root()
          }
          if (command === 'workspace_refresh_root') {
            state.chosen++
            return root()
          }
          if (command === 'workspace_list_children') {
            await new Promise((resolve) => setTimeout(resolve, 50))
            return {
              entries: args.directoryId
                ? [entry]
                : [{ id: 'docs', name: 'docs', kind: 'directory', relativePath: 'docs' }],
              nextCursor: null,
            }
          }
          if (command === 'workspace_resolve_entry')
            return args.relativePath === entry.relativePath ? entry : null
          if (command === 'workspace_prepare_open')
            return { id: 'lease-one', path: '/notes/docs/a.md', sizeBytes: 24, readonly: false }
          if (command === 'workspace_read_file') {
            await new Promise((resolve) => setTimeout(resolve, 80))
            return {
              documentId: args.documentId,
              file: { path: '/notes/docs/a.md' },
              text: '# Workspace file\nBody\n',
              diskSnapshotHash: 'fixture-hash',
            }
          }
          if (command === 'workspace_finish_open' && args.accepted) state.opened++
          if (
            [
              'workspace_finish_open',
              'workspace_validate_open',
              'workspace_release_root',
              'workspace_release_scope',
              'workspace_cancel_cursor',
            ].includes(command)
          )
            return undefined
          throw Error(`Unexpected workspace command: ${command}`)
        },
      })
      const record = {
        manifest,
        manifestPath: '/plugins/workspace/plugin.json',
        rootPath: '/plugins/workspace',
        sourcePath: '/plugins/workspace/plugin.json',
        dataRoot: `milkup://plugin-data/${manifest.id}`,
        storageRoot: `milkup://plugin-storage/${manifest.id}`,
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
    { manifest },
  )
  // Exercise the actual controller, command runtime, Worker, SDK and broker. Only IPC is mocked.
  await page.route(/\/src\/plugin-workspace-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'async function nativeWorkspaceInvoke(command, args) {',
      'async function nativeWorkspaceInvoke(command, args) { return window.workspaceTransport(command, args);',
    )
    expect(body).toContain('return window.workspaceTransport(command, args);')
    await route.fulfill({ response, body })
  })
  await page.goto('/')
}

async function state(page: Page): Promise<WorkspaceFixture> {
  return page.evaluate(
    () => (window as unknown as { workspaceFixture: WorkspaceFixture }).workspaceFixture,
  )
}
async function enable(page: Page): Promise<void> {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  expect((await state(page)).calls).toHaveLength(0)
  await expect(page.getByRole('button', { name: '选择工作区文件夹' })).toHaveCount(0)
  const toggle = page
    .locator('.plugin-summary-card[data-plugin-id="milkup.workspace"]')
    .getByRole('switch')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  if ((await page.locator('#app').getAttribute('data-sidebar-collapsed')) === 'true')
    await page.locator('[data-sidebar-toggle]').click()
  await expect(page.getByRole('button', { name: '选择工作区文件夹' })).toBeVisible()
  await expect(page.getByRole('button', { name: '取消操作', exact: true })).toHaveCount(0)
}
async function chooseAndExpand(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择工作区文件夹' }).click()
  const directory = page.getByRole('treeitem', { name: 'docs', exact: true })
  await expect(directory).toBeVisible()
  await directory.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('treeitem', { name: 'docs/a.md', exact: true })).toBeVisible()
}

test('trusted workspace commands cross the actual Worker and retain asynchronous capabilities; recent paths persist', async ({
  page,
}) => {
  await fixture(page)
  await enable(page)
  await chooseAndExpand(page)
  expect((await state(page)).chosen).toBe(1)
  const originalRoot = (await state(page)).calls.find(
    (call) => call.command === 'workspace_list_children',
  )?.args.rootId
  expect(typeof originalRoot).toBe('string')
  const file = page.getByRole('treeitem', { name: 'docs/a.md', exact: true })
  await file.click()
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('file:/notes/docs/a.md')
  await expect(page.locator('.milkup-editor')).toContainText('Workspace file')
  const recent = page.getByRole('button', { name: '最近文件：docs/a.md', exact: true })
  await expect(recent).toBeVisible()
  expect((await state(page)).opened).toBe(1)
  await recent.click()
  await expect.poll(async () => (await state(page)).opened).toBe(2)
  expect((await state(page)).calls.some((call) => call.command === 'workspace_resolve_entry')).toBe(
    true,
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.entries(localStorage).filter(
            ([key, value]) =>
              key.startsWith('milkup.plugin.storage.milkup.workspace.') &&
              value === '["docs/a.md"]',
          ).length,
      ),
    )
    .toBe(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
  // Reload restores the native remembered folder with fresh IDs through the actual Worker.
  await page.reload()
  await enable(page)
  await expect(page.getByRole('button', { name: '最近文件：docs/a.md' })).toBeVisible()
  expect((await state(page)).chosen).toBe(0)
  expect((await state(page)).restored).toBe(1)
  expect(
    (await state(page)).calls.find((call) => call.command === 'workspace_list_children')?.args
      .rootId,
  ).not.toBe(originalRoot)
  expect((await state(page)).calls.some((call) => call.command === 'workspace_choose_root')).toBe(
    false,
  )
  await page.getByRole('button', { name: '最近文件：docs/a.md', exact: true }).click()
  await expect.poll(async () => (await state(page)).opened).toBe(1)
})

test('scripted workspace actions receive no authority and dirty cancellation preserves the document', async ({
  page,
}) => {
  await fixture(page)
  await enable(page)
  await page
    .getByRole('button', { name: '选择工作区文件夹' })
    .evaluate((button) => (button as HTMLButtonElement).click())
  await expect(page.getByRole('alert')).toContainText('gesture-required')
  expect((await state(page)).chosen).toBe(0)
  await chooseAndExpand(page)
  const file = page.getByRole('treeitem', { name: 'docs/a.md', exact: true })
  await file.evaluate((button) => (button as HTMLButtonElement).click())
  await expect(page.getByRole('alert')).toContainText('gesture-required')
  expect((await state(page)).opened).toBe(0)
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('keep my draft')
  await file.click()
  await expect(page.locator('[data-close-confirm]')).toBeVisible()
  await page.locator('.dialog-button[data-close-confirm-action="cancel"]').click()
  await expect(page.locator('[data-close-confirm]')).toBeHidden()
  await expect(page.locator('.milkup-editor')).toContainText('keep my draft')
  await expect(page.getByRole('button', { name: '最近文件：docs/a.md' })).toHaveCount(0)
  expect((await state(page)).opened).toBe(0)
  expect(
    (await state(page)).calls.filter((call) => call.command === 'workspace_prepare_open'),
  ).toHaveLength(0)
})

test('hiding the embedding sidebar cancels pending workspace authority and discards late chooser output', async ({
  page,
}) => {
  await fixture(page)
  await enable(page)
  await page.evaluate(() => {
    ;(window as unknown as { workspaceFixture: WorkspaceFixture }).workspaceFixture.chooseDelay =
      600
  })
  await page.getByRole('button', { name: '选择工作区文件夹' }).click()
  await expect
    .poll(
      async () =>
        (await state(page)).calls.filter((call) => call.command === 'workspace_choose_root').length,
    )
    .toBe(1)
  await page.locator('[data-sidebar-toggle]').click()
  await expect(page.locator('#app')).toHaveAttribute('data-sidebar-collapsed', 'true')
  await expect
    .poll(
      async () =>
        (await state(page)).calls.filter((call) => call.command === 'workspace_release_root')
          .length,
    )
    .toBe(1)
  expect((await state(page)).calls.some((call) => call.command === 'workspace_remember_root')).toBe(
    false,
  )
  await page.locator('[data-sidebar-toggle]').click()
  await expect(page.getByRole('treeitem')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '选择工作区文件夹' })).toBeVisible()
  await chooseAndExpand(page)
})

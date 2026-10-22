import { sealWorkerFixture } from '../helpers/sealed-plugin-fixture'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
async function fixture(page: Page, failPersistence = false) {
  const manifest = JSON.parse(await readFile('plugins/shortcuts/plugin.json', 'utf8'))
  const bundle = await build({
    entryPoints: ['plugins/shortcuts/src/plugin.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  })
  await sealWorkerFixture(
    page,
    manifest,
    '/plugins/shortcuts/plugin.json',
    bundle.outputFiles[0]!.text,
  )
  await page.addInitScript(
    ({ manifest, failPersistence }) => {
      if (!sessionStorage.getItem('shortcuts-fixture')) {
        localStorage.setItem(
          'milkup.desktop.plugins.registry.v1',
          JSON.stringify({
            version: 1,
            records: [
              {
                manifest,
                manifestPath: '/plugins/shortcuts/plugin.json',
                rootPath: '/plugins/shortcuts',
                sourcePath: '/plugins/shortcuts/plugin.json',
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
        sessionStorage.setItem('shortcuts-fixture', '1')
      }
      if (failPersistence) {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key === 'milkup.desktop.keymap.v1')
            throw new Error('simulated write failure /private')
          return original.call(this, key, value)
        }
      }
    },
    { manifest, failPersistence },
  )
  await page.goto('/')
}
const modal = (page: Page) => page.getByRole('dialog', { name: '快捷键', exact: true })
async function open(page: Page, initial = true) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  if (!initial) {
    await page.getByRole('button', { name: '插件', exact: true }).click()
    if (
      !(await page
        .locator('[data-plugin-menu-group]')
        .evaluate((group: HTMLDetailsElement) => group.open))
    )
      await page.locator('[data-plugin-menu-group] > summary').click()
    await page.locator('[data-plugin-menu-entry="milkup.shortcuts:shortcuts-modal"]').click()
    await expect(modal(page).getByLabel(/\(file.save\)/)).toBeVisible()
    return
  }
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: 'Milkup Shortcuts 详情', exact: true }).click()
  if (initial) {
    await page.getByRole('button', { name: '批准能力', exact: true }).click()
    await page.getByRole('button', { name: '启用', exact: true }).click()
  }
  await page.getByRole('button', { name: '弹出 快捷键', exact: true }).click()
  await expect(modal(page)).toBeVisible()
  await expect(modal(page).getByLabel(/\(file.save\)/)).toBeVisible()
}
async function edit(page: Page, value: string) {
  const field = modal(page).getByLabel(/\(file.save\)/)
  await field.fill(value)
  await expect(modal(page).getByRole('button', { name: '保存快捷键', exact: true })).toBeVisible()
}
async function close(page: Page) {
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
  if (await page.locator('[data-app-menu]').isVisible())
    await page.locator('[data-menu-close]').click()
  await expect(page.locator('[data-app-menu]')).toBeHidden()
}
test('standalone shortcuts plugin exposes actual commands, draft cancellation, reserved keys and conflicts', async ({
  page,
}) => {
  await fixture(page)
  await open(page)
  await expect(modal(page)).toContainText('上下文固定快捷键')
  await expect(modal(page)).toContainText('F6 / Shift+F6')
  await expect(modal(page)).toContainText('view.setMode')
  await expect(modal(page)).toContainText('不能直接绑定')
  await edit(page, 'Mod+K')
  expect(await page.evaluate(() => localStorage.getItem('milkup.desktop.keymap.v1'))).toBeNull()
  await modal(page).getByRole('button', { name: '取消修改', exact: true }).click()
  await expect(modal(page).getByLabel(/\(file.save\)/)).toHaveValue('Mod+S')
  await edit(page, 'Mod+O')
  await modal(page).getByRole('button', { name: '保存快捷键', exact: true }).click()
  await expect(modal(page).getByRole('alert')).toContainText('占用')
  await expect(modal(page).getByLabel(/\(file.save\)/)).toHaveValue('Mod+O')
  await edit(page, 'F6')
  await modal(page).getByRole('button', { name: '保存快捷键', exact: true }).click()
  await expect(modal(page).getByRole('alert')).toContainText('保留')
  await expect(modal(page).getByRole('alert')).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('shortcuts-conflict-help.png') })
})
test('saved binding survives restart, restores defaults, and search field keeps local editing plus global save', async ({
  page,
}) => {
  await fixture(page)
  await open(page)
  await edit(page, 'Mod+K')
  await modal(page).getByRole('button', { name: '保存快捷键', exact: true }).click()
  await expect(modal(page)).toContainText('快捷键已保存。')
  await page.reload()
  await open(page, false)
  await expect(modal(page).getByLabel(/\(file.save\)/)).toHaveValue('Mod+K')
  await close(page)
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('saved by custom key')
  await page.keyboard.press('Control+k')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  await open(page, false)
  await modal(page).getByRole('button', { name: '恢复默认快捷键', exact: true }).click()
  await expect(modal(page).getByLabel(/\(file.save\)/)).toHaveValue('Mod+S')
  await close(page)
  await page.locator('.milkup-editor').click()
  await page.keyboard.type(' next edit')
  await page.keyboard.press('Control+f')
  const input = page.locator('[data-search-input]')
  await expect(input).toBeFocused()
  await input.fill('search only')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('local')
  await expect(input).toHaveValue('local')
  await expect(page.locator('.milkup-editor')).toContainText('saved by custom key')
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
})
test('persistence failure keeps old shortcut, shows bounded error and retains draft', async ({
  page,
}) => {
  await fixture(page, true)
  await open(page)
  await edit(page, 'Mod+K')
  await modal(page).getByRole('button', { name: '保存快捷键', exact: true }).click()
  await expect(modal(page).getByRole('alert')).toContainText('未能保存')
  await expect(modal(page)).not.toContainText('/private')
  await expect(modal(page).getByLabel(/\(file.save\)/)).toHaveValue('Mod+K')
  await close(page)
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('fallback save')
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
})
for (const mode of ['source', 'live'])
  test(`disabled and removed shortcuts plugin leaves ${mode} edit/history/save usable`, async ({
    page,
  }) => {
    await fixture(page)
    await open(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '禁用', exact: true }).click()
    await expect(page.locator('.plugin-state')).toHaveText('已禁用')
    await expect(page.getByRole('button', { name: '弹出 快捷键', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '移除', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Milkup Shortcuts 详情', exact: true }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
    await page.locator('.milkup-editor').click()
    await page.keyboard.type('without shortcut plugin')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+Shift+z')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.milkup-editor')).toContainText('without shortcut plugin')
    await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  })

test('shadowed plugin defaults retain their context after user rebinding and restart', async ({
  page,
}) => {
  await fixture(page)
  const manifests = await Promise.all(
    ['first', 'second'].map(async (name) => {
      const output = await build({
        stdin: {
          contents: `import { insertText } from '@milkup/plugin-sdk'; export default { commands: { 'shadow.${name}': context => context.editor.dispatch({ changes: insertText(0, '${name}-hit|') }) } }`,
          resolveDir: process.cwd(),
        },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
      })
      const manifest = {
        id: `shadow-${name}`,
        name: `Shadow ${name}`,
        version: '1.0.0',
        host: 'worker',
        permissions: ['document:write'],
        main: './dist/plugin.js',
        contributes: {
          commands: [{ id: `shadow.${name}`, title: `Shadow ${name}`, action: `shadow.${name}` }],
          keymaps: [{ command: `shadow.${name}`, key: 'Mod+K', when: 'editorFocus && sourceMode' }],
        },
      }
      await sealWorkerFixture(
        page,
        manifest,
        `/plugins/${manifest.id}/plugin.json`,
        output.outputFiles[0]!.text,
      )
      return manifest
    }),
  )
  await page.evaluate((manifests) => {
    const saved = JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')!)
    saved.records.unshift(
      ...manifests.map((manifest, index) => ({
        manifest,
        manifestPath: `/plugins/${manifest.id}/plugin.json`,
        rootPath: `/plugins/${manifest.id}`,
        sourcePath: `/plugins/${manifest.id}/plugin.json`,
        dataRoot: `milkup://plugin-data/${manifest.id}`,
        storageRoot: `milkup://plugin-storage/${manifest.id}`,
        state: 'enabled',
        enabled: true,
        installedAt: index + 2,
        updatedAt: index + 2,
        trust: 'development',
        approvals: { permissions: ['document:write'], hosts: ['worker'] },
        errors: [],
      })),
    )
    localStorage.setItem('milkup.desktop.plugins.registry.v1', JSON.stringify(saved))
  }, manifests)
  await page.reload()
  await open(page)
  // These assertions inspect the real main.ts catalogue, not a hand-built service fixture.
  await expect(modal(page).getByLabel(/\(shadow.first\)/)).toHaveValue('Mod+K')
  await expect(modal(page).getByLabel(/\(shadow.second\)/)).toHaveValue('')
  await modal(page)
    .getByLabel(/\(shadow.second\)/)
    .fill('F2')
  await modal(page).getByRole('button', { name: '保存快捷键', exact: true }).click()
  await expect(modal(page)).toContainText('快捷键已保存。')
  await page.reload()
  await open(page, false)
  await expect(modal(page).getByLabel(/\(shadow.second\)/)).toHaveValue('F2')
  await close(page)
  await page.getByRole('button', { name: '菜单', exact: true }).focus()
  await page.keyboard.press('F2') // Outside editor: must not execute.
  await page.keyboard.press('Control+2')
  await page.locator('.milkup-input-proxy').focus()
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await page.keyboard.press('F2') // Live mode: must not execute.
  await page.keyboard.press('Control+1')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  await page.locator('.milkup-input-proxy').focus()
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await page.keyboard.press('F2') // Source editor: exactly this invocation may execute.
  await expect(page.locator('.milkup-editor-content')).toContainText('second-hit|')
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  expect(await page.locator('.milkup-editor-content').innerText()).toBe('second-hit|')
})

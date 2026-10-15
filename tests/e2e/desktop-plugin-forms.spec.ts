import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'

async function mountForm(page: Page): Promise<void> {
  await page.route('**/__controlled-form-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"></head><body><button id="outside">External confirmation</button><main id="fixture"><div class="plugin-modal-slot" data-plugin-slot="modal"></div></main></body></html>',
    }),
  )
  await page.goto('/__controlled-form-test')
  await page.evaluate(
    async (gestureModule) => {
      const module = '/src/desktop-plugin-ui.ts'
      const { DesktopPluginUiController } = await import(/* @vite-ignore */ module)
      const { markTrustedPluginCommand, pluginCommandGesture } = await import(
        /* @vite-ignore */ gestureModule
      )
      const values: Record<string, string> = {
        font: 'system-ui',
        size: '16',
        theme: 'light',
        locked: 'Unavailable',
      }
      const calls: {
        command: string
        input: unknown
        trusted: boolean
        type?: string
        proof: boolean
      }[] = []
      let pending: Promise<void> = Promise.resolve()
      let lag = 35
      let revision = 0
      let blurCount = 0
      const output = () => ({
        type: 'element',
        tag: 'span',
        attributes: { class: 'plugin-form' },
        children: [
          { type: 'element', tag: 'strong', text: `Preferences ${revision}` },
          {
            type: 'element',
            tag: 'button',
            text: 'Save',
            attributes: { class: 'dialog-button', 'aria-label': 'Save' },
            action: { command: 'save' },
          },
          {
            type: 'field',
            key: 'font',
            kind: 'text',
            label: 'Font family',
            value: values.font,
            onChange: { command: 'edit' },
            help:
              values.help ??
              'Choose a readable font. Long help text wraps within the available space.',
          },
          {
            type: 'field',
            key: 'size',
            kind: 'number',
            label: 'Font size',
            value: values.size,
            min: 8,
            max: 40,
            step: 1,
            invalid: values.size === '' || Number(values.size) < 8 || Number(values.size) > 40,
            help:
              values.size === '' || Number(values.size) > 40
                ? 'Enter a number from 8 to 40. The current value has not been saved.'
                : '8–40 px',
            onChange: { command: 'edit' },
          },
          {
            type: 'field',
            key: 'theme',
            kind: 'select',
            label: 'Appearance',
            value: values.theme,
            options: [
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ],
            onChange: { command: 'edit' },
          },
          {
            type: 'field',
            key: 'locked',
            kind: 'text',
            label: 'Unavailable setting',
            value: values.locked,
            disabled: true,
            onChange: { command: 'edit' },
          },
        ],
      })
      const controller = new DesktopPluginUiController(document.querySelector('#fixture'), {
        contributions: () => ({
          commands: [],
          keymaps: [],
          renderers: [],
          markdownSyntax: [],
          importers: [],
          documentTypes: [],
          ui: [
            {
              pluginId: 'fixture',
              id: 'form',
              title: 'Preferences',
              slot: 'modal',
              viewportUpdates: false,
            },
          ],
        }),
        resolveCommand: (_id: string, command: string) =>
          ['save', 'edit'].includes(command) ? command : undefined,
        runCommand: (command: string, input: { field?: string; value?: string }, event?: Event) => {
          const context = { source: 'command' }
          if (event) markTrustedPluginCommand(context, event)
          calls.push({
            command,
            input,
            trusted: event?.isTrusted === true,
            type: event?.type,
            proof: Boolean(pluginCommandGesture(context, 'fixture')),
          })
          if (command === 'edit' && input.field && typeof input.value === 'string')
            values[input.field] = input.value
          revision++
          pending = controller.invalidate('fixture', 'form')
        },
        renderUi: async (_plugin: string, _id: string, phase: string) => {
          const snapshot = output()
          if (phase === 'update') await new Promise((resolve) => setTimeout(resolve, lag))
          return snapshot
        },
      })
      document.querySelector('#outside')!.addEventListener('click', () => undefined)
      await controller.open('fixture', 'form')
      document.querySelector('input')!.addEventListener('blur', () => {
        blurCount++
      })
      Object.assign(window, {
        formFixture: {
          calls,
          done: () => pending,
          stats: () => ({ blurCount }),
          refresh: (patch: Record<string, string>, delay = 80) => {
            Object.assign(values, patch)
            revision++
            lag = delay
            pending = controller.invalidate('fixture', 'form')
            return pending
          },
        },
      })
    },
    `/@fs/${resolve('packages/plugin/src/workspace-gesture.ts')}`,
  )
}

async function done(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { formFixture: { done(): Promise<void> } }).formFixture.done(),
  )
}

test('controlled fields keep input identity, caret and selection through asynchronous validation', async ({
  page,
}) => {
  await mountForm(page)
  const font = page.getByRole('textbox', { name: 'Font family' })
  await font.focus()
  await font.evaluate((node: HTMLInputElement) => {
    node.setSelectionRange(0, node.value.length)
    ;(window as unknown as { originalInput: Element }).originalInput = node
  })
  await page.keyboard.type('Noto Sans 字体', { delay: 8 })
  await done(page)
  await expect(font).toHaveValue('Noto Sans 字体')
  await expect(font).toBeFocused()
  expect(
    await font.evaluate(
      (node) => node === (window as unknown as { originalInput: Element }).originalInput,
    ),
  ).toBe(true)
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { formFixture: { stats(): { blurCount: number } } }
        ).formFixture.stats().blurCount,
    ),
  ).toBe(0)
  await font.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 6, 'backward'))
  await page.evaluate(() =>
    (
      window as unknown as {
        formFixture: { refresh(patch: Record<string, string>): Promise<void> }
      }
    ).formFixture.refresh({}),
  )
  expect(
    await font.evaluate((node: HTMLInputElement) => [
      node.selectionStart,
      node.selectionEnd,
      node.selectionDirection,
    ]),
  ).toEqual([2, 6, 'backward'])
  await page.keyboard.type('X')
  await done(page)
  await expect(font).toHaveValue('NoXans 字体')
})

test('input/change carry real events without workspace authority and button clicks retain authority', async ({
  page,
}) => {
  await mountForm(page)
  await page.getByLabel('Font family', { exact: true }).fill('serif')
  await done(page)
  await page.getByLabel('Appearance', { exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await done(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await done(page)
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          formFixture: {
            calls: {
              command: string
              input: unknown
              trusted: boolean
              type: string
              proof: boolean
            }[]
          }
        }
      ).formFixture.calls,
  )
  expect(calls.filter((call) => call.command === 'edit')).toEqual([
    {
      command: 'edit',
      input: { field: 'font', value: 'serif' },
      trusted: true,
      type: 'input',
      proof: false,
    },
    {
      command: 'edit',
      input: { field: 'theme', value: 'dark' },
      trusted: true,
      type: 'change',
      proof: false,
    },
  ])
  expect(calls.at(-1)).toMatchObject({ command: 'save', trusted: true, type: 'click', proof: true })
})

test('invalid drafts stay editable, disabled fields skip Tab, and late output cannot steal external focus', async ({
  page,
}) => {
  await mountForm(page)
  const size = page.getByRole('spinbutton', { name: 'Font size' })
  await size.fill('999')
  await done(page)
  await expect(size).toHaveValue('999')
  await expect(size).toHaveAttribute('aria-invalid', 'true')
  await expect(size).toHaveAccessibleDescription(/not been saved/)
  await size.fill('')
  await done(page)
  await expect(size).toHaveValue('')
  await expect(size).toHaveAttribute('aria-invalid', 'true')
  const close = page.getByRole('button', { name: '关闭', exact: true })
  await close.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.evaluate(() => {
    void (
      window as unknown as {
        formFixture: { refresh(patch: Record<string, string>): Promise<void> }
      }
    ).formFixture.refresh({ font: 'Updated asynchronously' })
    document.getElementById('outside')!.focus()
  })
  await done(page)
  await expect(page.getByRole('button', { name: 'External confirmation' })).toBeFocused()
})

for (const theme of ['light', 'dark'])
  for (const zoom of [1, 2]) {
    test(`controlled form is readable and keyboard reachable in ${theme} narrow ${zoom * 100}% CSS zoom`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 760, height: 520 })
      await mountForm(page)
      await page.evaluate(
        ({ theme, zoom }) => {
          document.documentElement.dataset.theme = theme
          document.body.style.zoom = String(zoom)
        },
        { theme, zoom },
      )
      const size = page.getByRole('spinbutton', { name: 'Font size' })
      await size.fill('999')
      await done(page)
      await page.getByRole('combobox', { name: 'Appearance' }).focus()
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      const geometry = await page.evaluate(() => {
        const modal = document.querySelector<HTMLElement>('.plugin-ui-modal')!
        const control = document.querySelector<HTMLElement>('select')!
        const bounds = control.getBoundingClientRect()
        return {
          modalWidth: modal.clientWidth,
          modalScrollWidth: modal.scrollWidth,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          windowWidth: innerWidth,
          windowHeight: innerHeight,
          visibleTop:
            modal.getBoundingClientRect().top +
            modal.clientTop * (modal.getBoundingClientRect().height / modal.offsetHeight),
          visibleBottom:
            modal.getBoundingClientRect().top +
            (modal.clientTop + modal.clientHeight) *
              (modal.getBoundingClientRect().height / modal.offsetHeight),
          ring: 4 * (modal.getBoundingClientRect().height / modal.offsetHeight),
          background: getComputedStyle(control).backgroundColor,
          color: getComputedStyle(control).color,
        }
      })
      expect(geometry.modalScrollWidth).toBeLessThanOrEqual(geometry.modalWidth + 1)
      expect(geometry.left).toBeGreaterThanOrEqual(0)
      expect(geometry.right).toBeLessThanOrEqual(geometry.windowWidth)
      expect(geometry.top).toBeGreaterThanOrEqual(0)
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.windowHeight)
      expect(geometry.top - geometry.ring).toBeGreaterThanOrEqual(geometry.visibleTop)
      expect(geometry.bottom + geometry.ring).toBeLessThanOrEqual(geometry.visibleBottom)
      expect(geometry.background).not.toBe(geometry.color)
      await testInfo.attach('field-layout', {
        body: JSON.stringify(geometry, null, 2),
        contentType: 'application/json',
      })
      await page.screenshot({
        path: `/workspace/milkup-preferences-phase3-evidence/forms/${theme}-narrow-css-${zoom * 100}.png`,
      })
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
    })
  }

test('modal keeps the entire focused field and ring visible after asynchronous layout changes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 380, height: 260 })
  await mountForm(page)
  const size = page.getByRole('spinbutton', { name: 'Font size' })
  await page.getByRole('button', { name: '关闭', exact: true }).focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(size).toBeFocused()
  await page.evaluate(() =>
    (
      window as unknown as {
        formFixture: { refresh(patch: Record<string, string>): Promise<void> }
      }
    ).formFixture.refresh({
      help: 'Asynchronous validation help now needs several lines. '.repeat(8),
    }),
  )
  await expect(size).toBeFocused()
  const geometry = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('.plugin-ui-modal')!
    const active = document.activeElement as HTMLElement
    const rect = modal.getBoundingClientRect()
    const field = active.getBoundingClientRect()
    return {
      top: field.top,
      bottom: field.bottom,
      visibleTop: rect.top + modal.clientTop,
      visibleBottom: rect.top + modal.clientTop + modal.clientHeight,
      scrollTop: modal.scrollTop,
    }
  })
  await testInfo.attach('focused-control-clip', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  })
  await page.screenshot({
    path: '/workspace/milkup-preferences-phase3-evidence/forms/focused-control-layout.png',
  })
  expect(geometry.top - 4).toBeGreaterThanOrEqual(geometry.visibleTop)
  expect(geometry.bottom + 4).toBeLessThanOrEqual(geometry.visibleBottom)
})

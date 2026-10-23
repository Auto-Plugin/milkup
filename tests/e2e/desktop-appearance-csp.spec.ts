import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const cspUrl = process.env.MILKUP_APPEARANCE_CSP_URL
test.skip(!cspUrl, 'Requires the opt-in static production appearance CSP server')
test.use({ baseURL: cspUrl, viewport: { width: 1000, height: 720 } })

test('production CSP permits host appearance and opaque preview styles without unsafe-inline', async ({
  page,
}, info) => {
  const consoleMessages: string[] = []
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error.message}`))
  await page.emulateMedia({ colorScheme: 'light' })
  try {
    const response = await page.goto('/')
    const policy = response!.headers()['content-security-policy']
    expect(policy).toMatch(/style-src 'self' 'nonce-[0-9]+'/)
    expect(policy).not.toContain('unsafe-inline')
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await page.getByRole('button', { name: '外观', exact: true }).click()
    const previews = page.locator('[data-menu-panel="appearance"] iframe')
    await expect(previews).toHaveCount(4)
    const observed = []
    for (let index = 0; index < 4; index++) {
      const preview = previews.nth(index)
      await expect(preview.contentFrame().locator('.sample')).toBeAttached()
      observed.push({
        host: await preview.evaluate((element) => {
          const frame = element as HTMLIFrameElement
          const css = getComputedStyle(frame)
          return {
            width: css.width,
            height: css.height,
            sandbox: frame.getAttribute('sandbox'),
            opaque: frame.contentDocument === null,
          }
        }),
        sample: await preview
          .contentFrame()
          .locator('.milkup-editor')
          .evaluate((element) => ({
            background: getComputedStyle(element).backgroundColor,
            mode: element.ownerDocument.documentElement.dataset.theme,
          })),
      })
    }
    const host = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector('.theme-mode-options')!).display,
      themeSheet: !!(document.querySelector('[data-appearance-theme]') as HTMLStyleElement)?.sheet,
    }))
    await writeFile(
      info.outputPath('appearance-csp-observed.json'),
      JSON.stringify({ policy, host, observed }, null, 2),
    )
    await page.screenshot({ path: info.outputPath('appearance-csp-light.png') })
    expect.soft(host.display).toBe('flex')
    expect.soft(host.themeSheet).toBe(true)
    for (const preview of observed) {
      expect
        .soft(preview.host)
        .toEqual({ width: '210px', height: '119px', sandbox: '', opaque: true })
      expect
        .soft(preview.sample.background)
        .toBe(preview.sample.mode === 'dark' ? 'rgb(27, 34, 44)' : 'rgb(255, 255, 255)')
    }
    await page.getByRole('button', { name: '深色', exact: true }).click({ timeout: 5000 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('button', { name: '深色', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.screenshot({ path: info.outputPath('appearance-csp-dark.png') })
  } finally {
    await writeFile(info.outputPath('console-csp.json'), JSON.stringify(consoleMessages, null, 2))
    await page.screenshot({ path: info.outputPath('appearance-csp-final.png') })
  }
})

test('the production parent policy still blocks unapproved styles and sandbox preview capabilities', async ({
  page,
}, info) => {
  const messages: string[] = []
  const externalRequests: string[] = []
  page.on('console', (message) => messages.push(message.text()))
  await page.route('https://appearance-csp-denied.invalid/**', async (route) => {
    externalRequests.push(route.request().url())
    await route.abort()
  })
  await page.goto('/')
  // Isolated test nodes only: no application settings, stores or controller state.
  await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.id = 'appearance-csp-test-probe'
    probe.textContent = 'CSP probe'
    document.body.append(probe)
    for (const nonce of [undefined, 'incorrect-test-nonce']) {
      const style = document.createElement('style')
      if (nonce) style.nonce = nonce
      style.textContent = '#appearance-csp-test-probe{color:rgb(1,2,3)}'
      document.head.append(style)
    }
    const nonce = document.querySelector<HTMLStyleElement>('head style[nonce]')!.nonce
    const frame = document.createElement('iframe')
    frame.id = 'appearance-csp-negative-frame'
    frame.setAttribute('sandbox', '')
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style nonce="${nonce}">body{color:rgb(4,5,6)}</style><p id="probe">sandbox text</p><script>document.querySelector('#probe').textContent='SCRIPT EXECUTED'</script><img src="https://appearance-csp-denied.invalid/pixel">`
    document.body.append(frame)
  })
  await expect(page.locator('#appearance-csp-test-probe')).not.toHaveCSS('color', 'rgb(1, 2, 3)')
  const frame = page.locator('#appearance-csp-negative-frame')
  await expect(frame.contentFrame().locator('body')).toHaveCSS('color', 'rgb(4, 5, 6)')
  await expect(frame.contentFrame().locator('#probe')).toHaveText('sandbox text')
  expect(await frame.evaluate((element) => (element as HTMLIFrameElement).contentDocument)).toBe(
    null,
  )
  await expect
    .poll(() => messages.some((message) => message.includes('appearance-csp-denied.invalid')))
    .toBe(true)
  expect(externalRequests).toEqual([])
  await writeFile(info.outputPath('negative-csp-console.json'), JSON.stringify(messages, null, 2))
})

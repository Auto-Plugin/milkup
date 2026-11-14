const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }))
const fs = require('node:fs')
const path = require('node:path')
const output = process.argv[2]
if (!output) throw Error('Pass the extraction evidence directory')
;(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = [],
    responses = [],
    external = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }))
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === '127.0.0.1') return route.continue()
    external.push(u.origin)
    return route.abort()
  })
  await page.goto('http://127.0.0.1:1431/')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.locator('[data-menu-section="about"]').click()
  const version = await page.locator('[data-app-version]').innerText()
  if (version !== '2.0.0-beta.4') throw Error('unexpected version ' + version)
  const updateButtons = await page
    .locator('.application-version [data-application-update-action="check"]')
    .count()
  if (updateButtons !== 1) throw Error('missing update action count=' + updateButtons)
  await page.screenshot({ path: path.join(output, 'extracted-about.png') })
  await page.getByRole('button', { name: '插件', exact: true }).click()
  const cards = await page.locator('.plugin-summary-card').count()
  const switches = await page.getByRole('switch').count()
  const approvals = await page.locator('[data-plugin-action="approve"]').count()
  await page.screenshot({ path: path.join(output, 'extracted-plugins.png') })

  const result = {
    version,
    updateButtons,
    cards,
    switches,
    approvals,
    pluginCatalogBoundary:
      'Empty fresh browser profile has no native plugin catalog; no plugin card behavior asserted',
    expectedNativeTransportUnavailable: true,
    errors,
    external,
    failedResponses: responses.filter((r) => r.status >= 400),
    boundary:
      'Exact unmodified frontend assets extracted from delivered Windows EXE; executed in fresh Linux Chromium HTTP origin, not Windows/WebView2 or installation verification; no native transport mocked.',
  }
  fs.writeFileSync(path.join(output, 'browser-proof.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

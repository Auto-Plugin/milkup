// Measurement-only real-layout probe. No Mermaid/product latency claim.
// Uses the existing system browser and its sandbox; installs/changes nothing.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { observeMermaidVisibility } from '../windows/mermaid-visibility-observer.mjs'

test(
  'visibility observer distinguishes clipping, source exposure and decoded entry in real layout',
  { timeout: 30000 },
  async () => {
    const browser = await chromium.launch({
      ...(process.env.MILKUP_BROWSER_EXECUTABLE
        ? { executablePath: process.env.MILKUP_BROWSER_EXECUTABLE }
        : process.platform === 'win32'
          ? { channel: 'msedge' }
          : { executablePath: '/usr/bin/chromium' }),
      chromiumSandbox: true,
      headless: true,
    })
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      await page.setContent(`<style>
      .milkup-editor{position:absolute;top:10px;left:10px;width:300px;height:100px;overflow:auto}
      .lead{height:180px}.milkup-line{height:20px} img{width:100px;height:20px}
      </style><div class="milkup-editor"><div class="lead"></div>
      <div class="milkup-line" data-from="10" data-to="30">flowchart LR A--&gt;B</div>
      <div data-presentation-from="10"><img></div><div style="height:800px"></div></div>`)
      await page.evaluate((fn) => {
        window.installVisibility = (0, eval)('(' + fn + ')')
      }, observeMermaidVisibility.toString())
      await page.evaluate(() => {
        window.probe = window.installVisibility({ from: 10, to: 30, scenario: 'cold-entry' })
      })
      await page.waitForFunction(() => window.probe.report.samples >= 3)
      assert.equal(await page.evaluate(() => window.probe.report.firstVisible), null)
      // Real wheel reveals still-unrendered source. This models the evidence
      // distinction; this HTML fixture is deliberately not the actual application.
      await page.mouse.move(100, 50)
      await page.mouse.wheel(0, 190)
      await page.waitForFunction(() => window.probe.report.sourceVisibleFrames >= 2)
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 100
        canvas.height = 20
        canvas.getContext('2d').fillRect(0, 0, 100, 20)
        const image = document.querySelector('img')
        image.src = canvas.toDataURL()
        await image.decode()
        document.querySelector('.milkup-line').style.display = 'none'
      })
      await page.waitForFunction(() => window.probe.report.complete)
      const cold = await page.evaluate(() => window.probe.report)
      assert(cold.sourceVisibleFrames >= 2)
      assert(cold.decoded > cold.firstVisible)
      assert.equal(cold.decodedAtFirstSample, false)
      await page.evaluate(() => {
        window.probe = window.installVisibility({ from: 10, to: 30, scenario: 'prefetch-ready' })
      })
      await page.waitForFunction(() => window.probe.report.complete)
      const warm = await page.evaluate(() => window.probe.report)
      assert.equal(warm.decodedAtFirstSample, true)
      assert.equal(warm.sourceVisibleFrames, 0)
      assert.equal(warm.decoded - warm.firstVisible, 0)
      console.log(
        JSON.stringify({ kind: 'measurement-only', browser: browser.version(), cold, warm }),
      )
    } finally {
      await browser.close()
    }
  },
)

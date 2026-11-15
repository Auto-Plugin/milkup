// Actual host presentation class, tested with layout and sandbox enabled.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { DocumentPendingImage } from '../../packages/view-dom/src/document-pending-image.ts'
import { observeMermaidVisibility } from '../windows/mermaid-visibility-observer.mjs'

test(
  'pending host presentation preserves layout, masks only source, and exposes failure or decoded result',
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
      await page.setContent(
        `<style>.milkup-editor{width:300px;height:150px;overflow:auto}.milkup-line{white-space:pre-wrap;line-height:24px}.lead{height:180px}</style><div class="milkup-editor"><div class="lead"></div><div class="milkup-line" data-from="10" data-to="50">graph LR; A--&gt;B; A--&gt;C; A--&gt;D; 中文😀A--&gt;E</div><div style="height:500px"></div></div>`,
      )
      const before = await page.evaluate(
        ({ owner, observer }) => {
          window.Pending = (0, eval)('(' + owner + ')')
          window.observe = (0, eval)('(' + observer + ')')
          window.owner = new window.Pending()
          window.line = document.querySelector('.milkup-line')
          window.original = window.line.firstChild
          window.editor = document.querySelector('.milkup-editor')
          window.editor.scrollTop = 170
          window.geometry = () => ({
            height: window.line.getBoundingClientRect().height,
            width: window.line.getBoundingClientRect().width,
            scrollHeight: window.editor.scrollHeight,
            scrollTop: window.editor.scrollTop,
          })
          const before = window.geometry()
          window.owner.update([{ from: 10, lines: [window.line] }])
          window.probe = window.observe({ from: 10, to: 50, scenario: 'cold-entry' })
          return before
        },
        { owner: DocumentPendingImage.toString(), observer: observeMermaidVisibility.toString() },
      )
      await page.waitForFunction(() => window.probe.report.pendingVisibleFrames >= 2)
      assert.deepEqual(await page.evaluate(() => window.geometry()), before)
      const pending = await page.evaluate(() => window.probe.report)
      assert.equal(pending.sourceVisibleFrames, 0)
      assert.equal(pending.decoded, null)
      assert.equal(pending.complete, false)
      // A renderer/decode failure restores the SAME nodes, not reconstructed text.
      await page.evaluate(() => window.owner.clear())
      await page.waitForFunction(() => window.probe.report.sourceVisibleFrames >= 2)
      assert.equal(await page.evaluate(() => window.line.firstChild === window.original), true)
      assert.deepEqual(await page.evaluate(() => window.geometry()), before)
      // Warm decoded image is handed over synchronously; loading isn't counted as image.
      await page.evaluate(async () => {
        window.probe.stop()
        window.owner.update([{ from: 10, lines: [window.line] }])
        window.probe = window.observe({ from: 10, to: 50, scenario: 'prefetch-ready' })
        const canvas = document.createElement('canvas')
        canvas.width = 100
        canvas.height = 24
        canvas.getContext('2d').fillRect(0, 0, 100, 24)
        window.image = new Image()
        window.image.src = canvas.toDataURL()
        await window.image.decode()
      })
      await page.waitForFunction(() => window.probe.report.pendingVisibleFrames >= 2)
      await page.evaluate(() => {
        window.owner.clear()
        const preview = document.createElement('span')
        preview.dataset.documentPresentation = 'image'
        preview.dataset.presentationFrom = '10'
        preview.append(window.image)
        window.line.replaceChildren(preview)
      })
      await page.waitForFunction(() => window.probe.report.complete)
      const decoded = await page.evaluate(() => window.probe.report)
      assert.equal(decoded.sourceVisibleFrames, 0)
      assert(decoded.decoded > decoded.pendingFirstVisible)
      console.log(
        JSON.stringify({
          kind: 'actual-pending-class-layout',
          browser: browser.version(),
          before,
          pending,
          decoded,
        }),
      )
    } finally {
      await browser.close()
    }
  },
)

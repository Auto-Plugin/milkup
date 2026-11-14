import { test, expect } from '/workspace/milkup/node_modules/@playwright/test'
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

for (const boundary of ['End', 'Home'])
  test(`observe disabled renderer undo at ${boundary}`, async ({ page }) => {
    const activate = async (locator: any) => {
      await expect(locator).toBeVisible()
      await locator.press('Enter')
    }
    await markdownExtensionFixture(page)
    await page.evaluate(() => {
      ;(window as any).historyEvents = []
      for (const name of ['beforeinput', 'input'])
        document.addEventListener(
          name,
          (event) => {
            if (!(event.target instanceof Element) || !event.target.matches('.milkup-input-proxy'))
              return
            ;(window as any).historyEvents.push({
              event: event.type,
              wall: Date.now(),
              type: (event as InputEvent).inputType,
              data: (event as InputEvent).data,
              cursor: document.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position,
            })
          },
          true,
        )
    })
    await seedMarkdownExtensions(page, fixture)
    await expect(page.locator('.milkup-document-presentation math')).toHaveCount(2)
    await activate(page.getByRole('button', { name: '菜单', exact: true }))
    await activate(page.getByRole('button', { name: '插件', exact: true }))
    for (const name of ['数学公式', 'Milkup Diagrams', 'Milkup Footnotes']) {
      await activate(page.getByRole('button', { name, exact: true }))
      await activate(page.getByRole('button', { name: '禁用', exact: true }))
      await activate(page.locator('[data-plugin-action=back]'))
    }
    await activate(page.locator('[data-menu-close]'))
    await expect(page.locator('[data-document-presentation]')).toHaveCount(0)
    await page.keyboard.press('Control+1')
    await page.locator('.milkup-input-proxy').focus()
    await page.keyboard.press(`Control+${boundary}`)
    const state = () =>
      page.evaluate(() => ({
        cursor: document.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position,
        lines: [...document.querySelectorAll<HTMLElement>('.milkup-line')].map((line) =>
          line.dataset.from === line.dataset.to ? '' : line.textContent,
        ),
        events: (window as any).historyEvents,
      }))
    const before = await state()
    await page.keyboard.insertText('停用😀')
    const inserted = await state()
    await page.keyboard.press('Control+z')
    const undone = await state()
    await page.keyboard.press('Control+Shift+z')
    const redone = await state()
    const inputs = inserted.events.filter((event: any) => event.event === 'beforeinput')
    const inputGap = inputs.at(-1)?.wall - inputs[0]?.wall
    await writeFile(
      test.info().outputPath('history.json'),
      JSON.stringify(
        { boundary, fixtureLength: fixture.length, inputGap, before, inserted, undone, redone },
        null,
        2,
      ),
    )
    await page.screenshot({ path: test.info().outputPath('history.png') })
    expect(redone.lines).toEqual(inserted.lines)
    if (boundary === 'Home') expect(undone.lines).toEqual(fixture.split('\n'))
  })

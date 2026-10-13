import assert from 'node:assert/strict'
import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const root = '/tmp/milkup-v2-phase16/native-gtk-scale2'
await mkdir(root, { recursive: true })
const file = root + '/review.md'
await writeFile(
  file,
  '# 整界面高 DPI\n\n中文 English `code`\n\n- 列表\n\n| 名称 | 内容 |\n| --- | --- |\n| 表格 | 检查 |\n',
)
const app = await startProduction(file, root)
const states = []
const shot = async (name) => {
  await app.delay(400)
  execFileSync('import', ['-window', 'root', root + '/' + name + '.png'], { env: process.env })
  states.push({
    name,
    dom: await app.execute(
      `return {width:innerWidth,height:innerHeight,ratio:devicePixelRatio,zoom:getComputedStyle(document.documentElement).zoom,font:getComputedStyle(document.querySelector('.milkup-editor')).fontSize,focus:document.activeElement.outerHTML.slice(0,200)}`,
    ),
  })
}
try {
  assert.equal(await app.execute('return devicePixelRatio'), 2)
  await shot('mixed-200dpi')
  await app.key('F6')
  await app.key('F6')
  await app.key('Return')
  await app.until(
    () => app.execute('return !document.querySelector("[data-app-menu]").hidden'),
    'menu',
  )
  await shot('menu-200dpi')
  await app.key('Escape')
  await app.until(
    () => app.execute('return document.activeElement.matches(".milkup-input-proxy")'),
    'focus',
  )
  await app.text('X')
  await app.until(async () => (await app.probe()).dirty, 'edit')
  await app.key('ctrl+n')
  await app.until(
    () => app.execute('return !document.querySelector("[data-close-confirm]").hidden'),
    'confirm',
  )
  await shot('dialog-200dpi')
  await writeFile(
    root + '/x11-tree.txt',
    execFileSync('xwininfo', ['-root', '-tree'], { env: process.env, encoding: 'utf8' }),
  )
} finally {
  await writeFile(root + '/results.json', JSON.stringify(states, null, 2))
  await app.close()
}

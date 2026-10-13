import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const root = '/tmp/milkup-v2-phase16/zoom-before'
await mkdir(root, { recursive: true })
const file = root + '/review.md'
await writeFile(file, '# 文字\n\n正文 `code`')
const app = await startProduction(file, root)
const env = { ...process.env, DISPLAY: ':99' }
try {
  const id = execFileSync('xdotool', ['search', '--class', 'milkup-desktop'], {
    encoding: 'utf8',
    env,
  })
    .trim()
    .split('\n')
    .at(-1)
  execFileSync('xdotool', ['windowsize', id, '760', '520'], { env })
  await app.until(() => app.execute('return innerWidth===760'), 'resize')
  await app.text('X')
  await app.until(async () => (await app.probe()).dirty, 'edit')
  await app.key('ctrl+n')
  await app.until(
    () => app.execute('return !document.querySelector("[data-close-confirm]").hidden'),
    'dialog',
  )
  await app.execute(
    `document.documentElement.style.zoom=2;document.querySelector('.desktop-shell').style.height=(innerHeight/2)+'px';document.querySelector('.desktop-shell').style.width=(innerWidth/2)+'px'`,
  )
  await app.delay(300)
  execFileSync('import', ['-window', 'root', root + '/dialog-200.png'], { env })
  await writeFile(
    root + '/bounds.json',
    JSON.stringify(
      await app.execute(
        `return {viewport:{width:innerWidth,height:innerHeight},dialog:document.querySelector('.confirm-dialog').getBoundingClientRect().toJSON(),buttons:Array.from(document.querySelectorAll('.confirm-dialog button')).map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))}`,
      ),
      null,
      2,
    ),
  )
} finally {
  await app.close()
}

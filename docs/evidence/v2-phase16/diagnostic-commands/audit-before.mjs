import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const root = '/tmp/milkup-v2-phase16/before'
await mkdir(root, { recursive: true })
const file = root + '/review.md'
await writeFile(
  file,
  '# 视觉与键盘审查\n\n普通正文 中文 English `inline code`。\n\n- 项目一\n- 项目二\n\n```js\nconst answer = 42\n```\n\n| 名称 | 状态 |\n| --- | --- |\n| 键盘 | 待检查 |\n\n' +
    '长文正文 中文 abcdefghijklmnopqrstuvwxyz\n'.repeat(50000),
)
const app = await startProduction(file, root)
const log = []
const snap = async (name) => {
  await app.delay(250)
  execFileSync('import', ['-window', 'root', root + '/' + name + '.png'], {
    env: { ...process.env, DISPLAY: ':99' },
  })
  log.push({
    name,
    probe: await app.probe(),
    dom: await app.execute(
      `return {width:innerWidth,height:innerHeight,ratio:devicePixelRatio,focus:document.activeElement?.outerHTML.slice(0,300),editor:document.querySelector('[data-editor-host]').getBoundingClientRect().toJSON(),menu:!document.querySelector('[data-app-menu]').hidden}`,
    ),
  })
}
try {
  await snap('mixed-wide')
  await app.click('[data-menu-toggle]')
  await app.key('shift+Tab')
  await app.key('shift+Tab')
  await snap('menu-backward-focus')
  await app.key('Escape')
  await snap('menu-closed')
  await app.key('ctrl+plus')
  await snap('ctrl-plus')
  const win = execFileSync('xdotool', ['search', '--class', 'milkup-desktop'], {
    encoding: 'utf8',
    env: { ...process.env, DISPLAY: ':99' },
  })
    .trim()
    .split('\n')
    .at(-1)
  execFileSync('xdotool', ['windowsize', win, '760', '520'], {
    env: { ...process.env, DISPLAY: ':99' },
  })
  await app.key('ctrl+f')
  await app.text('inline')
  await snap('narrow-search')
  await app.key('Escape')
  await app.click('[data-menu-toggle]')
  await app.click('[data-menu-section="appearance"]')
  await snap('appearance-empty')
} finally {
  await writeFile(root + '/observations.json', JSON.stringify(log, null, 2))
  await app.close()
}

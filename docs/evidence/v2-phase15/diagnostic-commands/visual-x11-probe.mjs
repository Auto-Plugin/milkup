import { execFileSync } from 'node:child_process'
import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
const root = '/tmp/milkup-v2-phase15/production-toolbar-x11'
await mkdir(root, { recursive: true })
const file = root + '/table.md'
await copyFile('/tmp/milkup-v2-phase15/production-tables-complete/tables.md', file)
const app = await startProduction(file, root)
try {
  await app.key('ctrl+f')
  await app.focus('[data-search-input]')
  await app.key('ctrl+a')
  await app.text('r80')
  await app.until(async () => {
    const p = await app.probe()
    return p.count === '1/1' && p.cursor === 1540
  }, 'selection')
  await app.key('Escape')
  await app.focus('.milkup-input-proxy')
  await app.key('End')
  await app.key('shift+Return')
  await app.text('quick123')
  await app.until(async () => (await app.probe()).cursor === 1556, 'typing')
  await app.key('ctrl+s')
  await app.until(async () => {
    const p = await app.probe()
    return !p.saving && !p.dirty
  }, 'saved')
  const samples = []
  for (let i = 0; i < 15; i++) {
    samples.push(
      await app.execute(
        `const t=document.querySelector('[data-table-tools]'),r=t.getBoundingClientRect(),v=document.querySelector('.milkup-editor-content'),c=document.querySelector('.milkup-cursor');return {hidden:t.hidden,rect:{top:r.top,bottom:r.bottom,height:r.height},from:v.dataset.fromLine,to:v.dataset.toLine,cursor:c?.dataset.position,tools:t.innerText}`,
      ),
    )
    await app.delay(200)
  }
  await writeFile(root + '/samples.json', JSON.stringify(samples, null, 2))
  await app.shot('saved-table')
  execFileSync('import', ['-window', 'root', root + '/x11-root.png'], {
    env: { ...process.env, DISPLAY: ':99' },
  })
  await writeFile(
    root + '/hit-test.json',
    JSON.stringify(
      await app.execute(
        `const t=document.querySelector('[data-table-tools]'),r=t.getBoundingClientRect();return {element:document.elementFromPoint(r.left+20,r.top+20)?.outerHTML,style:getComputedStyle(t).cssText,hidden:t.hidden,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}}`,
      ),
      null,
      2,
    ),
  )
} finally {
  await app.close()
}

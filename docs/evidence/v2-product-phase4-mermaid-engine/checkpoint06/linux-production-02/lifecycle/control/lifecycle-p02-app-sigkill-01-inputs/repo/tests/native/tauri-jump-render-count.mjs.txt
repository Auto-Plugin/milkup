// Read-only DOM mutation trace: count whole-window replacements after native keys.
import assert from 'node:assert/strict'
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
const root = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
await mkdir(root, { recursive: true })
const file = path.join(root, 'render-count.md')
await copyFile(process.env.MILKUP_SEARCH_FIXTURE, file)
const expectedLength = (await readFile(file, 'utf8')).length,
  results = []
let app
try {
  app = await startProduction(file, root)
  for (const mode of ['source', 'live']) {
    await app.key(mode === 'source' ? 'ctrl+1' : 'ctrl+2')
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+Home')
    await app.delay(300)
    await app.execute(
      `window.__renderTrace=[];window.__renderObserver?.disconnect();window.__renderObserver=new MutationObserver(list=>{for(const r of list)window.__renderTrace.push({at:performance.now(),added:r.addedNodes.length,removed:r.removedNodes.length,from:document.querySelector('.milkup-editor-content').dataset.fromLine,to:document.querySelector('.milkup-editor-content').dataset.toLine})});window.__renderObserver.observe(document.querySelector('.milkup-editor-content'),{childList:true});`,
    )
    for (const key of ['End', 'Home', 'End', 'Home']) {
      await app.execute('window.__renderTrace=[]')
      await app.key('ctrl+' + key)
      await app.until(
        async () => (await app.probe()).cursor === (key === 'Home' ? 0 : expectedLength),
        'exact jump cursor',
      )
      await app.delay(250)
      const trace = await app.execute('return window.__renderTrace')
      const replacements = trace.filter((r) => r.added > 2 && r.removed > 2).length
      assert(replacements >= 1, 'must observe the real target render')
      if (process.env.MILKUP_EXPECT_SINGLE_RENDER === '1')
        assert.equal(replacements, 1, 'one owned target render')
      results.push({ mode, key, replacements, trace })
    }
  }
  await app.shot('jump-count-final')
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
  await app?.close()
}

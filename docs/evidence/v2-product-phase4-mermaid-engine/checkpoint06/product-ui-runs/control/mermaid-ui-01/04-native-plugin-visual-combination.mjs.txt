// Integration-only checks: both feature branches, real input and full disk comparisons.
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { ownedApplication } from './native-owned-process.mjs'

export async function checkPluginVisualCombination({
  getApp,
  restart,
  open,
  click,
  record,
  shot,
  output,
  launchFile,
}) {
  const heading = '**粗体中的 *斜体*** tail 😀'
  const lines = [
    heading,
    '===',
    '',
    '| L | C | R |',
    '| :--- | :---: | ---: |',
    '| identifier_without_breaks_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789 | 完成 | 123.45 |',
    '',
    '- [ ] task é 中文',
    '',
    '```js',
    'console.log("' + 'abcdefghijklmnopqrstuvwxyz'.repeat(8) + '")',
    '```',
    '',
    '末尾',
    '',
  ]
  for (const kind of ['ordinary', 'windowed']) {
    const file = path.join(output, `combined-${kind}.md`)
    const original =
      lines.join('\r\n') + (kind === 'windowed' ? 'tail 中文 😀\r\n'.repeat(180000) : '')
    await writeFile(file, original)
    await open(file)
    let app = getApp()
    const showOutline = async () => {
      if (
        await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed==="true"')
      )
        await click('[data-sidebar-toggle]')
      await app.until(
        () =>
          app.execute(
            `const e=document.querySelector('.plugin-list-item');if(!e)return false;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y))`,
          ),
        'outline row really clickable',
      )
    }
    const clickTask = async () => {
      await app.execute(
        'document.querySelector(".milkup-task-marker").scrollIntoView({block:"center",inline:"nearest"})',
      )
      let previous
      await app.until(async () => {
        const position = await app.execute(
          `const e=document.querySelector('.milkup-task-marker'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?JSON.stringify([r.x,r.y,r.width,r.height]):null`,
        )
        const stable = position && position === previous
        previous = position
        return stable
      }, 'task pointer target settled')
      await click('.milkup-task-marker')
    }
    const indexed = (label = heading) =>
      app.until(
        () =>
          app.execute(
            'return document.querySelector(".plugin-list-summary")?.textContent.startsWith("全文索引完成") && document.querySelectorAll(".plugin-list-item").length===1 && document.querySelector(".plugin-list-item").textContent===arguments[0]',
            label,
          ),
        'combined complete Setext index',
        180000,
      )
    await indexed()
    await showOutline()
    assert.equal(
      await app.execute('return !!document.querySelector(".milkup-source-document-view")'),
      kind === 'windowed',
    )
    assert.equal(
      await app.execute('return document.querySelector(".plugin-list-item").textContent'),
      heading,
    )
    await click('.plugin-list-item')
    await app.until(async () => (await app.probe()).cursor === 0, 'Setext exact navigation')
    await app.key('ctrl+2')
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+Home')
    await app.key('Down')
    await app.key('Down')
    await app.until(
      () => app.execute('return document.querySelectorAll(".milkup-table-cell").length===6'),
      'combined live table',
    )
    const dom = await app.execute(`return {
      heading:document.querySelector('.milkup-line[data-line="1"]').innerText,
      italics:[...document.querySelectorAll('.milkup-inline-emphasis')].map(e=>e.innerText),
      align:[...document.querySelectorAll('.milkup-table-cell')].map(e=>getComputedStyle(e).textAlign),
      tasks:document.querySelectorAll('[role="checkbox"]').length,
      shadow:getComputedStyle(document.querySelector('.milkup-editor')).boxShadow,
      outlineRole:document.querySelector('.plugin-tree-row').getAttribute('role')}`)
    assert.equal(dom.heading, '粗体中的 斜体 tail 😀')
    assert.deepEqual(dom.italics, ['斜体'])
    assert.deepEqual(dom.align, ['left', 'center', 'right', 'left', 'center', 'right'])
    assert.equal(dom.tasks, 1)
    assert.equal(dom.shadow, 'none')
    assert.equal(dom.outlineRole, 'treeitem')
    await shot(`combined-${kind}-live`)
    const save = async (expected) => {
      await app.focus('.milkup-input-proxy')
      await app.key('ctrl+s')
      await app.until(
        async () =>
          !(await app.probe()).dirty && (await readFile(file)).equals(Buffer.from(expected)),
        'combined exact save',
        30000,
      )
    }
    await clickTask()
    const checked = original.replace('[ ]', '[x]')
    await save(checked)
    await app.key('ctrl+z')
    await save(original)
    await app.key('ctrl+y')
    await save(checked)
    await app.focus('.milkup-task-marker')
    await app.key('space')
    await save(original)
    // The editor and plugin panel share the viewport while End reveals a long code line.
    await app.execute(
      'document.querySelector(".milkup-line[data-line=\\"11\\"]").scrollIntoView({block:"center"})',
    )
    await click('.milkup-line[data-line="11"]')
    await app.key('End')
    await app.delay(250)
    const caret = await app.execute(
      `const c=document.querySelector('.milkup-cursor'),r=c.getBoundingClientRect(),v=document.querySelector('.milkup-editor').getBoundingClientRect();return {pos:Number(c.dataset.position),left:r.left,right:r.right,viewLeft:v.left,viewRight:v.right}`,
    )
    assert.equal(caret.pos, original.indexOf(')\r\n```') + 1)
    assert(caret.left >= caret.viewLeft && caret.right <= caret.viewRight)
    await shot(`combined-${kind}-code-end`)
    await app.key('ctrl+1')
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+Home')
    await app.text('Edited ')
    await save('Edited ' + original)
    await indexed('Edited ' + heading)
    assert.equal(
      await app.execute('return document.querySelector(".plugin-list-item").textContent'),
      'Edited ' + heading,
    )
    await app.key('ctrl+z')
    await save(original)
    await indexed()
    await record(`combined-${kind}-edit-history-save`, {
      dom,
      caret,
      bytes: Buffer.byteLength(original),
    })

    // A dirty task edit must survive a real process crash with the installed outline enabled.
    await app.key('ctrl+2')
    await app.until(async () => (await app.probe()).mode === 'live', 'recovery live mode')
    await app.key('ctrl+Home')
    await app.until(async () => (await app.probe()).cursor === 0, 'recovery home rendered')
    await app.until(
      () => app.execute('return !!document.querySelector(".milkup-task-marker")'),
      'task render',
    )
    await clickTask()
    await app.until(
      async () =>
        (await app.probe()).dirty &&
        (await app.execute(
          'return document.querySelector(".milkup-task-marker")?.getAttribute("aria-checked")==="true"',
        )),
      'task edit accepted before checkpoint',
    )
    await app.until(
      () =>
        app.execute(
          'return document.querySelector("#app").dataset.recoveryPhase==="ready" && Number(document.querySelector("#app").dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]").textContent)',
        ),
      'combined durable recovery',
      30000,
    )
    const profile = process.env.MILKUP_RECOVERY_PROFILE
    assert(profile, 'Set MILKUP_RECOVERY_PROFILE for combined recovery')
    const manifests = []
    for (const name of await readdir(profile)) {
      try {
        const directory = path.join(profile, name)
        const value = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
        if (value.originalPath === file && value.disposition === 'pending')
          manifests.push({ ...value, directory })
      } catch {}
    }
    const checkpoint = manifests.sort((a, b) => b.createdAt - a.createdAt)[0]
    assert(checkpoint)
    assert.equal(
      await readFile(path.join(checkpoint.directory, checkpoint.payload), 'utf8'),
      checked,
    )
    const owner = await ownedApplication(app.application, launchFile)
    const termination = await owner.signal('SIGKILL')
    await app.close()
    await restart()
    app = getApp()
    await app.until(
      () => app.execute('return !document.querySelector(".recovery-overlay").hidden'),
      'combined recovery prompt',
    )
    await app.click(`[data-recovery-restore="${checkpoint.id}"]`)
    await app.until(
      async () =>
        (await app.probe()).path.includes('/copies/recovered-') &&
        (await app.probe()).loading === 'ready',
      'combined restored copy',
      30000,
    )
    await indexed()
    await showOutline()
    const recovered = (await app.probe()).path
    assert.equal(await readFile(recovered, 'utf8'), checked)
    assert.equal(await readFile(file, 'utf8'), original)
    await app.key('ctrl+2')
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+Home')
    await app.until(
      () =>
        app.execute(
          'return document.querySelector(".milkup-task-marker")?.getAttribute("aria-checked")==="true"',
        ),
      'restored task UI',
    )
    await shot(`combined-${kind}-restored`)
    await record(`combined-${kind}-crash-restored`, {
      recovered,
      checkpoint: checkpoint.id,
      termination,
    })
  }
  await open(launchFile)
}

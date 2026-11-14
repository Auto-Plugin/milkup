// P7 native outline: real catalog installation and input; DOM/catalog observation only.
// One fresh driver/profile per run. Required env: TAURI_APP_PATH,
// MILKUP_NATIVE_EXPECTED_BINARY_SHA256, MILKUP_NATIVE_EVIDENCE_DIR,
// MILKUP_PLUGIN_ARCHIVE, MILKUP_PLUGIN_ARCHIVE_SHA256, MILKUP_P7_OUTLINE_VERSION.
// MILKUP_P7_OUTLINE_CASE=ordinary|large|dense; PHASE=performance|keyboard|scroll|lifecycle|smoke.
// --preflight writes fixtures/provenance without launching anything.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startProduction } from '../helpers/native-production.mjs'
import { nativeFixture, action, x } from '../helpers/native-updates-fixture.mjs'

const required = (key) => (assert(process.env[key], `Set ${key}`), process.env[key])
const sha = (value) => createHash('sha256').update(value).digest('hex')
const output = path.resolve(required('MILKUP_NATIVE_EVIDENCE_DIR'))
const selected = process.env.MILKUP_P7_OUTLINE_CASE || 'dense'
const phase = process.env.MILKUP_P7_OUTLINE_PHASE || 'performance'
assert(['ordinary', 'large', 'dense'].includes(selected))
assert(['performance', 'keyboard', 'scroll', 'lifecycle', 'smoke'].includes(phase))
if (phase === 'scroll') assert.equal(selected, 'dense', 'Scroll uses the 18,000-title fixture')
if (phase === 'lifecycle')
  assert.equal(selected, 'large', 'Lifecycle uses the supported 26 MiB fixture')
if (phase === 'smoke') assert.equal(selected, 'ordinary', 'Smoke uses eight complete headings')
const samples = Number(process.env.MILKUP_P7_OUTLINE_SAMPLES || 20)
const indexSamples = Number(process.env.MILKUP_P7_OUTLINE_INDEX_SAMPLES || 3)
assert(Number.isSafeInteger(samples) && samples >= 1 && samples <= 100)
assert(Number.isSafeInteger(indexSamples) && indexSamples >= 1 && indexSamples <= 10)
const id = 'milkup.outline',
  panel = `[data-plugin-ui="${id}:outline-panel"]`
const archivePath = path.resolve(required('MILKUP_PLUGIN_ARCHIVE'))
const archiveBytes = await readFile(archivePath),
  archive = JSON.parse(archiveBytes)
assert.equal(sha(archiveBytes), required('MILKUP_PLUGIN_ARCHIVE_SHA256'))
assert.equal(archive.manifest.id, id)
assert.equal(archive.manifest.version, required('MILKUP_P7_OUTLINE_VERSION'))
const binary = path.resolve(required('TAURI_APP_PATH'))
assert.equal(sha(await readFile(binary)), required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256'))
await mkdir(output, { recursive: true })
const ordinary =
  '# Guide\nIntro 中文。\n\n## Getting started\nBody\n### Install\nBody\n#### Configure\nBody\n##### Details\nBody\n###### Deep heading\nBody\n\n## Usage\nBody\n\n# Second chapter\n```md\n# Fenced pseudo heading\n```\nTail\n'
const large = () =>
  Array.from({ length: 40000 }, (_, n) => {
    const line = n + 1
    return line === 1
      ? '# Large start'
      : line === 100
        ? '```md'
        : line === 5000
          ? '```'
          : line % 4 === 0
            ? `## Heading ${line}`
            : `Body ${line} ${'x'.repeat(850)}`
  }).join('\n') + '\n'
const dense = () =>
  Array.from({ length: 18000 }, (_, i) => {
    const within = i % 900
    const level = within === 0 ? 1 : within % 30 === 0 ? 2 : 3 + (within % 4)
    return (
      '#'.repeat(level) +
      ' ' +
      (i % 15 === 0 ? 'Duplicate' : `Dense ${i}`) +
      '\nbody ' +
      'x'.repeat(60)
    )
  }).join('\n') + '\n'
const source = selected === 'ordinary' ? ordinary : selected === 'large' ? large() : dense()
const spec =
  selected === 'ordinary'
    ? {
        total: 8,
        roots: 2,
        first: 'Guide',
        second: 'Getting started',
        secondLine: 4,
        last: 'Second chapter',
        lastLine: 18,
      }
    : selected === 'large'
      ? {
          total: 8775,
          roots: 1,
          first: 'Large start',
          second: 'Heading 4',
          secondLine: 4,
          last: 'Heading 40000',
          lastLine: 40000,
        }
      : {
          total: 18000,
          roots: 20,
          first: 'Duplicate',
          second: 'Dense 1',
          secondLine: 3,
          last: 'Dense 17999',
          lastLine: 35999,
        }
const sourcePath = path.join(output, 'outline.md'),
  emptyPath = path.join(output, 'empty.md')
await writeFile(sourcePath, source, { flag: 'wx' })
await writeFile(emptyPath, '', { flag: 'wx' })
const sourceSha256 = sha(source)
const json = (name, value) =>
  writeFile(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n')
await json('plan', {
  selected,
  phase,
  samples,
  indexSamples,
  spec,
  sourcePath,
  sourceSha256,
  bytes: Buffer.byteLength(source),
  utf16: source.length,
  lines: source.split('\n').length,
  binary,
  binarySha256: sha(await readFile(binary)),
  archivePath,
  archiveSha256: sha(archiveBytes),
  version: archive.manifest.version,
  harnessSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  timings:
    phase === 'smoke'
      ? 'Functional compatibility only: no timing samples, cold-start or performance claims.'
      : 'Trusted input capture to target DOM plus two rAF proxy. Index starts when the opened source is visible and loading is not opening; picker latency excluded. Repeated indexing within this fresh profile is warm rebuild, not OS cold cache.',
  budgets: phase === 'smoke' ? null : { interactionP95: 200, folding: 250, firstRows: 1000 },
})
await writeFile(path.join(output, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)))
if (process.argv.includes('--preflight')) process.exit(0)
assert.equal(
  process.env.MILKUP_P7_BINARY_CONFIRMED,
  '1',
  'Root must confirm frozen binary/display slot',
)
let app
const ui = nativeFixture(() => app),
  observations = [],
  measurements = []
const command = (name) => `${panel} [data-plugin-command="outline.${name}"]`
async function catalog() {
  await app.execute(
    `window.__p7Catalog={done:false};window.__TAURI_INTERNALS__.invoke('plugin_catalog_read').then(value=>window.__p7Catalog={done:true,value},error=>window.__p7Catalog={done:true,error:String(error)});`,
  )
  const result = await app.until(
    () => app.execute('return window.__p7Catalog.done?window.__p7Catalog:null'),
    'catalog observation',
  )
  assert(!result.error, result.error)
  return result.value
}
const entry = async () => (await catalog()).entries.find((record) => record.id === id)
const candidateAction = async (kind) =>
  (await ui.exists('.plugin-candidate ' + action(kind, id)))
    ? '.plugin-candidate ' + action(kind, id)
    : action(kind, id)
async function observe(name, extra = {}) {
  assert.equal(sha(await readFile(sourcePath)), sourceSha256, 'Source remains unchanged')
  const result = {
    name,
    at: new Date().toISOString(),
    document: await app.probe(),
    ...extra,
    outline: await app.execute(
      `const p=document.querySelector(arguments[0]),l=p?.querySelector('[data-virtual-list]');return {text:p?.textContent,virtual:l?.dataset,focus:document.activeElement?.getAttribute('aria-label'),items:[...p?.querySelectorAll('.plugin-list-item')??[]].map(e=>({text:e.textContent,title:e.title,current:e.getAttribute('aria-current')}))}`,
      panel,
    ),
  }
  observations.push(result)
  await json('observations', observations)
  return result
}
async function open(file) {
  await ui.closeMenu()
  await ui.click('[data-menu-toggle]')
  await ui.click('[data-menu-section="file"]')
  await ui.click('[data-command="open-sample"]')
  await ui.picker(file)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.path === file && p.loading !== 'opening'
    },
    'source opened',
    60000,
  )
}
async function install() {
  await ui.list()
  if (await ui.exists(action('details', id))) {
    await ui.details(id)
    if (await ui.exists(action('disable', id))) await ui.click(action('disable', id))
    await ui.click(action('remove', id))
    await app.until(async () => (await entry())?.tombstone, 'old bundled outline removed')
  }
  await ui.list()
  await ui.click('[data-plugin-action="install"]')
  await ui.picker(archivePath)
  await app.until(async () => {
    const e = await entry()
    return !e?.tombstone && (e.pending?.generation ?? e.active)?.sourcePath === archivePath
  }, 'exact independent outline staged')
  await ui.details(id)
  const reviewed = await entry(),
    generation = reviewed.pending?.generation ?? reviewed.active
  const approve = await candidateAction('approve')
  const explicitApprovalRequired = await ui.exists(approve)
  if (explicitApprovalRequired) await ui.click(approve)
  else {
    assert.equal(generation.manifest.host, 'worker')
    assert(generation.manifest.permissions.every((permission) => permission === 'document:read'))
    assert.equal(generation.approvedFingerprint, generation.capabilityFingerprint)
  }
  await ui.click(await candidateAction('enable'))
  await app.until(async () => {
    const e = await entry()
    return (
      e?.enabled &&
      !e.pending &&
      !e.startAttempt &&
      e.active?.verified &&
      e.active.sourcePath === archivePath
    )
  }, 'outline active')
  await json('installed', { explicitApprovalRequired, catalog: await catalog() })
  await ui.closeMenu()
  if (
    !(await app.execute(
      'return document.querySelector("[data-sidebar-toggle]")?.getAttribute("aria-pressed")==="true"',
    ))
  )
    await ui.click('[data-sidebar-toggle]')
  const toggle = panel + ' .plugin-ui-panel-toggle'
  if (
    await app.execute(
      'return document.querySelector(arguments[0])?.getAttribute("aria-expanded")==="false"',
      toggle,
    )
  )
    await ui.click(toggle)
}
async function arm(name, goal) {
  await app.execute(
    `window.__p7Measure?.dispose?.();const goal=arguments[0],panelSelector=arguments[1];
    const m=window.__p7Measure={name:arguments[2],goal,start:null,firstRows:null,done:null,frames:0,wheelEvents:0,wheelDeltaY:0,triggerFinished:false};let raf=0;
    const panel=()=>document.querySelector(panelSelector);
    const sample=(frameTime)=>{raf=0;const p=panel(),list=p?.querySelector('[data-virtual-list]'),items=[...p?.querySelectorAll('.plugin-list-item')??[]];
      const docPath=document.querySelector('[data-stat="path"]')?.textContent??(document.querySelector('[data-title-path]')?.textContent+'/'+document.querySelector('[data-title]')?.textContent+'.md');
      const currentFile=docPath===goal.path;
      if(goal.kind==='index'&&m.start===null&&currentFile&&document.querySelector('#app')?.dataset.loading!=='opening')m.start=performance.now();
      if(m.start===null)return;
      if(items.length&&m.firstRows===null)m.firstRows=performance.now();
      const full=p?.querySelector('.plugin-list-summary')?.textContent?.startsWith('全文索引完成');
      const start=Number(list?.dataset.virtualStart),end=Number(list?.dataset.virtualEnd),total=Number(list?.dataset.virtualTotal);
      const rowStates=items.map(e=>{const row=e.closest('[role="treeitem"]');return {title:e.title||e.textContent,level:Number(row?.getAttribute('aria-level')),expanded:row?.getAttribute('aria-expanded')}});
      const rangeConsistent=[start,end,total].every(Number.isSafeInteger)&&0<=start&&start<=end&&end<=total&&items.length===end-start&&items.length<=500&&(total===0||end>start);
      const foldState=goal.command==='outline.collapseAll'?start===0&&end===goal.count&&items.length===goal.count&&rowStates.every(r=>r.level===1&&r.expanded!=='true'):goal.command==='outline.expandAll'?rowStates.every(r=>r.expanded!=='false'):true;
      const renderProof={start,end,total,actualRows:items.length,revision:list?.dataset.virtualRevision,rangeConsistent,foldState,firstTitle:rowStates[0]?.title,lastTitle:rowStates.at(-1)?.title};
      const signature=goal.kind==='index'||goal.kind==='fold'?JSON.stringify([renderProof,rowStates]):undefined;
      let ok=goal.kind==='index'||goal.kind==='fold'?full&&total===goal.count&&rangeConsistent&&foldState:
        goal.kind==='navigate'?items.some(e=>e.title===goal.title&&e.getAttribute('aria-current')==='location')&&Number(document.querySelector('.milkup-cursor')?.dataset.position)===goal.cursor:
        goal.kind==='scroll'?m.triggerFinished&&list?.scrollTop!==goal.scrollTop&&Math.floor(list.scrollTop/Number(list.dataset.virtualItemHeight))>=Number(list.dataset.virtualStart)&&Math.ceil((list.scrollTop+list.clientHeight)/Number(list.dataset.virtualItemHeight))<=Number(list.dataset.virtualEnd)&&items.some(e=>{const r=e.getBoundingClientRect(),v=list.getBoundingClientRect();return r.bottom>v.top&&r.top<v.bottom}):
        document.activeElement?.textContent===goal.text&&document.activeElement?.matches('button[role="treeitem"]')&&Number(list?.dataset.virtualStart)+items.indexOf(document.activeElement)===goal.rank;
      if(!ok){m.frames=0;m.frameTimes=[];delete m.signature;return}
      if(m.signature!==signature){m.signature=signature;m.frames=0;m.frameTimes=[]}
      m.frameTimes??=[];if(typeof frameTime!=='number'||m.frameTimes.at(-1)===frameTime){raf=requestAnimationFrame(sample);return}
      m.frameTimes.push(frameTime);if(m.frames++<2){raf=requestAnimationFrame(sample);return}
      if(m.done===null){m.done=performance.now();m.elapsedMs=m.done-m.start;m.firstRowsMs=m.firstRows-m.start;m.virtual=list?.dataset?{...list.dataset}:null;m.renderProof=renderProof;m.scrollTop=list?.scrollTop;m.viewport=list?{from:Math.floor(list.scrollTop/Number(list.dataset.virtualItemHeight)),to:Math.ceil((list.scrollTop+list.clientHeight)/Number(list.dataset.virtualItemHeight))}:null;m.focusRank=items.includes(document.activeElement)?Number(list?.dataset.virtualStart)+items.indexOf(document.activeElement):null;m.dispose();}};
    m.resample=()=>{if(!raf)raf=requestAnimationFrame(sample)};
    const input=e=>{if(!e.isTrusted||goal.kind==='index')return;if(goal.kind==='scroll'&&e.type==='wheel'){m.wheelEvents++;m.wheelDeltaY+=e.deltaY}if(m.start!==null)return;
      if(goal.command&&e.type==='click'&&e.target.closest('[data-plugin-command]')?.dataset.pluginCommand===goal.command)m.start=performance.now();
      else if(goal.kind==='scroll'&&e.type==='wheel')m.start=performance.now();
      else if(!goal.command&&e.type==='keydown'&&(!goal.key||(e.key==='Unidentified'?e.code:e.key)===goal.key))m.start=performance.now();if(m.start!==null)raf=requestAnimationFrame(sample)};
    const observer=new MutationObserver(()=>{if(!raf)raf=requestAnimationFrame(sample)});observer.observe(document.querySelector('#app'),{subtree:true,childList:true,attributes:true,characterData:true});
    document.addEventListener('click',input,true);document.addEventListener('keydown',input,true);document.addEventListener('wheel',input,true);
    m.dispose=()=>{observer.disconnect();cancelAnimationFrame(raf);document.removeEventListener('click',input,true);document.removeEventListener('keydown',input,true);document.removeEventListener('wheel',input,true)};sample();`,
    goal,
    panel,
    name,
  )
}
async function measure(name, goal, trigger, timeout = 15000) {
  await arm(name, goal)
  try {
    await trigger()
    if (goal.kind === 'scroll')
      await app.execute(
        'const m=window.__p7Measure;m.triggerFinished=true;m.triggerFinishedAt=performance.now();m.resample()',
      )
    const result = await app.until(
      () =>
        app.execute(
          'const m=window.__p7Measure;return m.done===null?null:{name:m.name,start:m.start,done:m.done,elapsedMs:m.elapsedMs,firstRowsMs:m.firstRowsMs,virtual:m.virtual,renderProof:m.renderProof,stableFrameTimes:m.frameTimes,scrollTop:m.scrollTop,viewport:m.viewport,wheelEvents:m.wheelEvents,wheelDeltaY:m.wheelDeltaY,triggerFinishedAt:m.triggerFinishedAt,focusRank:m.focusRank,goal:m.goal}',
        ),
      name,
      timeout,
    )
    measurements.push({ ...result, status: 'observed' })
    await json('measurements', measurements)
    return result
  } catch (error) {
    measurements.push({
      name,
      goal,
      status: 'failed',
      error: String(error),
      raw: await app
        .execute(
          'const m=window.__p7Measure,l=document.querySelector(arguments[0]+" [data-virtual-list]");return {start:m.start,done:m.done,firstRows:m.firstRows,frames:m.frames,stableFrameTimes:m.frameTimes,actualRows:document.querySelectorAll(arguments[0]+" .plugin-list-item").length,wheelEvents:m.wheelEvents,wheelDeltaY:m.wheelDeltaY,triggerFinishedAt:m.triggerFinishedAt,scrollTop:l?.scrollTop,clientHeight:l?.clientHeight,virtual:l?{...l.dataset}:null,focus:{tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,160)}}',
          panel,
        )
        .catch(() => null),
    })
    await json('measurements', measurements)
    throw error
  }
}
async function inputClick(selector) {
  const rect = await app.execute(
    'return document.querySelector(arguments[0])?.getBoundingClientRect().toJSON()',
    selector,
  )
  assert(rect?.width > 0 && rect?.height > 0, 'Visible ' + selector)
  x(
    'windowfocus',
    '--sync',
    ui.windowId(),
    'mousemove',
    '--window',
    ui.windowId(),
    String(Math.round(rect.x + rect.width / 2)),
    String(Math.round(rect.y + rect.height / 2)),
    'click',
    '1',
  )
}
async function focusOutlineByTab() {
  for (let count = 0; count < 10; count++) {
    if (
      await app.execute(
        'return document.activeElement?.matches(arguments[0])',
        `${panel} .plugin-list-item`,
      )
    )
      return count
    await app.key('Tab')
    assert(!(await app.probe()).dirty, 'Tab traversal must not edit source')
  }
  throw Error('Outline navigation control was not reachable in 10 real Tab presses')
}
const offsetAtLine = (line) =>
  source
    .split('\n')
    .slice(0, line - 1)
    .join('\n').length + (line > 1 ? 1 : 0)
async function outlineState() {
  return app.execute(
    `const p=document.querySelector(arguments[0]);return {summary:p?.querySelector('.plugin-list-summary')?.textContent??'',rows:p?.querySelectorAll('.plugin-list-item').length??0,total:Number(p?.querySelector('[data-virtual-list]')?.dataset.virtualTotal),first:p?.querySelector('.plugin-list-item')?.textContent}`,
    panel,
  )
}
async function waitScanning(label) {
  const state = await app.until(
    async () => {
      const state = await outlineState()
      return state.rows > 0 ? state : null
    },
    label + ' first rows',
    300000,
  )
  assert(
    !state.summary.startsWith('全文索引完成'),
    label + ': no incomplete indexing input window observed',
  )
  await observe(label, { observedIncomplete: true, state })
  return state
}
async function waitFull(first = spec.first) {
  await app.until(
    async () => {
      const state = await outlineState()
      return (
        state.summary.startsWith('全文索引完成') &&
        state.total === spec.total &&
        state.first === first
      )
    },
    'full current outline and exact first heading',
    300000,
  )
}
async function lifecycle() {
  await open(sourcePath)
  await waitScanning('edit-during-index-ready')
  // Opening a native large file chooses Live; confirm Source after opening.
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'lifecycle source mode')
  await inputClick('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.until(async () => (await app.probe()).cursor === 0, 'lifecycle document start')
  await app.key('Right')
  await app.until(async () => (await app.probe()).cursor === 1, 'lifecycle first character')
  await app.key('Right')
  await app.until(async () => (await app.probe()).cursor === 2, 'lifecycle heading title')
  const before = await app.probe()
  assert.equal(before.cursor, 2, 'Insert in the first heading title')
  const beforeInput = await outlineState()
  assert(
    !beforeInput.summary.startsWith('全文索引完成'),
    'Index completed before trusted edit; active edit coverage unproven',
  )
  await app.text('P7_LIFECYCLE_')
  await app.until(
    async () => (await app.probe()).version > before.version,
    'trusted edit advances version',
  )
  await observe('edited-during-index', { before, beforeInput })
  await waitFull('P7_LIFECYCLE_' + spec.first)
  await observe('edited-version-index-complete')
  await app.key('ctrl+z')
  await app.key('ctrl+s')
  await app.until(
    async () => !(await app.probe()).dirty && sha(await readFile(sourcePath)) === sourceSha256,
    'undo and save exact original bytes',
    60000,
  )
  await waitFull()
  await observe('undo-saved-original-index-complete')
  await open(emptyPath)
  await open(sourcePath)
  await waitScanning('switch-during-index-ready')
  await app.execute(
    `window.__p7SwitchObservation={completedBeforeSwitch:false,switched:false};const expected=arguments[0],panelSelector=arguments[1];const check=()=>{const state=window.__p7SwitchObservation;if(state.switched)return;const path=document.querySelector('[data-stat="path"]')?.textContent??(document.querySelector('[data-title-path]')?.textContent+'/'+document.querySelector('[data-title]')?.textContent+'.md');if(path!==expected){state.switched=true;return}if(document.querySelector(panelSelector+' .plugin-list-summary')?.textContent?.startsWith('全文索引完成'))state.completedBeforeSwitch=true};window.__p7SwitchObserver=new MutationObserver(check);window.__p7SwitchObserver.observe(document.querySelector('#app'),{childList:true,subtree:true,characterData:true});check()`,
    sourcePath,
    panel,
  )
  await open(emptyPath)
  const switching = await app.execute(
    'window.__p7SwitchObserver.disconnect();return window.__p7SwitchObservation',
  )
  await observe('switch-index-window', { switching })
  assert(
    switching.switched && !switching.completedBeforeSwitch,
    'Document switch occurred before scan completion; otherwise active cancellation is unproven',
  )
  await app.until(
    async () => (await outlineState()).rows === 0,
    'empty document has no outline rows',
  )
  // Read-only observation spans old scan responses after switching documents.
  await app.execute(
    `window.__p7EmptyObservation={rowsSeen:false};const check=()=>{if(document.querySelectorAll(arguments[0]+" .plugin-list-item").length)window.__p7EmptyObservation.rowsSeen=true};window.__p7EmptyObserver=new MutationObserver(check);window.__p7EmptyObserver.observe(document.querySelector(arguments[0]),{childList:true,subtree:true});check()`,
    panel,
  )
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const late = await app.execute(
    'window.__p7EmptyObserver.disconnect();return window.__p7EmptyObservation',
  )
  assert.equal(
    late.rowsSeen,
    false,
    'Old scan never publishes rows into the empty document during observation',
  )
  await observe('switched-empty-no-late-rows', { observationMs: 2000, late })
  await measure(
    'lifecycle-reopen-index',
    { kind: 'index', count: spec.total, path: sourcePath },
    () => open(sourcePath),
    300000,
  )
  await observe('lifecycle-reopened-complete')
}
async function smoke() {
  await open(sourcePath)
  await waitFull()
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'smoke Source mode')
  const assertComplete = async (first = spec.first) => {
    await waitFull(first)
    assert.equal((await outlineState()).rows, spec.total, 'All eight headings are rendered')
  }
  await assertComplete()
  await observe('smoke-full-eight-headings', { catalog: await catalog() })
  await inputClick(`${panel} .plugin-list-item[title="${spec.second}（第 ${spec.secondLine} 行）"]`)
  await app.until(
    async () =>
      (await app.probe()).cursor === offsetAtLine(spec.secondLine) &&
      (await app.execute(
        'return document.querySelector(arguments[0])?.textContent',
        `${panel} .plugin-list-item[aria-current="location"]`,
      )) === spec.second,
    'smoke public heading navigation',
  )
  await observe('smoke-public-heading-click')
  await inputClick('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.until(async () => (await app.probe()).cursor === 0, 'smoke document start')
  await app.key('Right')
  await app.until(async () => (await app.probe()).cursor === 1, 'smoke first character')
  await app.key('Right')
  await app.until(async () => (await app.probe()).cursor === 2, 'smoke heading title')
  const before = await app.probe()
  // One native ASCII edit gives one unambiguous undo transaction.
  await app.text('X')
  await app.until(
    async () => (await app.probe()).version > before.version,
    'smoke trusted title edit advances version',
  )
  await assertComplete('X' + spec.first)
  await observe('smoke-edited-title', { before })
  await app.shot('smoke-edited-title')
  await app.key('ctrl+z')
  await app.key('ctrl+s')
  await app.until(
    async () => !(await app.probe()).dirty && sha(await readFile(sourcePath)) === sourceSha256,
    'smoke undo/save exact original bytes',
    60000,
  )
  await assertComplete()
  await observe('smoke-undo-saved-original')
  await app.key('shift+F6')
  const tabPresses = await focusOutlineByTab()
  for (const [key, rank, title] of [
    ['End', spec.total - 1, spec.last],
    ['Home', 0, spec.first],
  ]) {
    await app.key(key)
    const focus = await app.until(
      () =>
        app.execute(
          'const l=document.querySelector(arguments[0]+" [data-virtual-list]"),items=[...l.querySelectorAll(".plugin-list-item")],e=document.activeElement;const rank=Number(l.dataset.virtualStart)+items.indexOf(e);return e.matches("button[role=treeitem]")&&items.includes(e)&&rank===arguments[1]&&e.textContent===arguments[2]?{rank,text:e.textContent,title:e.title}:null',
          panel,
          rank,
          title,
        ),
      'smoke tree ' + key + ' focus',
    )
    await observe('smoke-keyboard-' + key, { tabPresses, focus })
    await app.shot('smoke-keyboard-' + key.toLowerCase())
  }
}
try {
  app = await startProduction(emptyPath, output)
  await install()
  if (phase === 'lifecycle') await lifecycle()
  if (phase === 'smoke') await smoke()
  for (
    let i = 0;
    i < (['lifecycle', 'smoke'].includes(phase) ? 0 : phase === 'performance' ? indexSamples : 1);
    i++
  ) {
    if (i) await open(emptyPath)
    await measure(
      'index-' + (i + 1),
      { kind: 'index', count: spec.total, path: sourcePath },
      () => open(sourcePath),
      300000,
    )
    await observe('index-' + (i + 1))
  }
  if (phase !== 'smoke') {
    await app.key('ctrl+1')
    await app.until(async () => (await app.probe()).mode === 'source', 'source mode')
  }
  if (phase === 'performance' || phase === 'scroll') {
    if (phase === 'performance') {
      for (let i = 1; i <= samples; i++) {
        await measure(
          'collapse-' + i,
          { kind: 'fold', count: spec.roots, command: 'outline.collapseAll' },
          () => inputClick(command('collapseAll')),
        )
        await measure(
          'expand-' + i,
          { kind: 'fold', count: spec.total, command: 'outline.expandAll' },
          () => inputClick(command('expandAll')),
        )
      }
      // A real input-proxy click precedes timing; no private selection mutation.
      for (let i = 1; i <= samples; i++) {
        const tail = i % 2 === 1,
          line = tail ? spec.lastLine : 1
        await inputClick('.milkup-input-proxy')
        await measure(
          'editor-cursor-follow-' + i,
          {
            kind: 'navigate',
            key: tail ? 'End' : 'Home',
            title: `${tail ? spec.last : spec.first}（第 ${line} 行）`,
            cursor: tail ? source.length : 0,
          },
          () => app.key(tail ? 'ctrl+End' : 'ctrl+Home'),
        )
      }
      // Separate real outline navigation from editor-cursor-follow latency above.
      await inputClick('.milkup-input-proxy')
      await app.key('ctrl+Home')
      await app.until(
        () =>
          app.execute(
            'return document.querySelector(arguments[0])?.textContent===arguments[1]',
            `${panel} .plugin-list-item[aria-current="location"]`,
            spec.first,
          ),
        'prepare first slice for outline clicks',
      )
      const secondOffset = offsetAtLine(spec.secondLine)
      for (let i = 1; i <= samples; i++) {
        const second = i % 2 === 1
        const title = `${second ? spec.second : spec.first}（第 ${second ? spec.secondLine : 1} 行）`
        await measure(
          'outline-click-' + i,
          {
            kind: 'navigate',
            title,
            cursor: second ? secondOffset : 0,
            command: 'outline.gotoHeading',
          },
          () => inputClick(`${panel} .plugin-list-item[title="${title}"]`),
        )
      }
    }
    if (selected === 'dense') {
      await measure(
        'middle-collapse',
        { kind: 'fold', count: 20, command: 'outline.collapseAll' },
        () => inputClick(command('collapseAll')),
      )
      await measure(
        'middle-jump',
        {
          kind: 'navigate',
          title: 'Duplicate（第 18001 行）',
          cursor: offsetAtLine(18001),
          command: 'outline.gotoHeading',
        },
        () => inputClick(`${panel} .plugin-list-item[title="Duplicate（第 18001 行）"]`),
      )
      await measure(
        'middle-expand',
        { kind: 'fold', count: 18000, command: 'outline.expandAll' },
        () => inputClick(command('expandAll')),
      )
      for (let i = 1; i <= samples; i++) {
        const before = await app.execute(
          'const l=document.querySelector(arguments[0]+" [data-virtual-list]");return {scrollTop:l.scrollTop,revision:l.dataset.virtualRevision,rect:l.getBoundingClientRect().toJSON()}',
          panel,
        )
        await measure(
          'wheel-burst-10-' + i,
          {
            kind: 'scroll',
            scrollTop: before.scrollTop,
            revision: before.revision,
            direction: i <= Math.ceil(samples / 2) ? 'down' : 'up',
          },
          () => {
            x(
              'windowfocus',
              '--sync',
              ui.windowId(),
              'mousemove',
              '--window',
              ui.windowId(),
              String(Math.round(before.rect.x + before.rect.width / 2)),
              String(Math.round(before.rect.y + before.rect.height / 2)),
              'click',
              '--repeat',
              '10',
              '--delay',
              '8',
              i <= Math.ceil(samples / 2) ? '5' : '4',
            )
          },
        )
      }
    }
  } else if (phase === 'keyboard') {
    // Begin on the first tree navigation control with native input, then key-only.
    await inputClick('.milkup-input-proxy')
    await app.key('ctrl+Home')
    await app.until(
      () =>
        app.execute(
          'return document.querySelector(arguments[0])?.textContent===arguments[1]',
          `${panel} .plugin-list-item[aria-current="location"]`,
          spec.first,
        ),
      'first heading follows',
    )
    // Native region navigation leaves the editor without inserting Tab indentation.
    await app.key('shift+F6')
    await observe('keyboard-region-reached')
    await observe('keyboard-tree-reached', {
      setup: 'native Shift+F6 from editor to sidebar, then real Tab',
      tabPresses: await focusOutlineByTab(),
    })
    await measure(
      'keyboard-End',
      { kind: 'focus', key: 'End', text: spec.last, rank: spec.total - 1 },
      () => app.key('End'),
    )
    await measure('keyboard-Home', { kind: 'focus', key: 'Home', text: spec.first, rank: 0 }, () =>
      app.key('Home'),
    )
    const end = await app.execute(
      'return Number(document.querySelector(arguments[0]+" [data-virtual-list]").dataset.virtualEnd)',
      panel,
    )
    // Real repeated arrows reach a boundary without DOM focus injection.
    for (let i = 1; i < end; i++) await app.key('Down')
    if (end < spec.total) {
      await app.key('Down')
      await app.until(
        () =>
          app.execute(
            'const l=document.querySelector(arguments[0]+" [data-virtual-list]"),items=[...l.querySelectorAll(".plugin-list-item")];return Number(l.dataset.virtualEnd)>arguments[1]&&l.contains(document.activeElement)&&Number(l.dataset.virtualStart)+items.indexOf(document.activeElement)===arguments[1]',
            panel,
            end,
          ),
        'arrow crossed virtual boundary',
      )
    }
  }
  await observe('complete', { catalog: await catalog() })
  assert(!(await app.probe()).dirty, 'Read-only outline actions do not dirty source')
  await app.shot('complete')
  const groups = {}
  for (const row of measurements.filter((row) => row.status === 'observed'))
    (groups[row.name.replace(/-\d+$/, '')] ??= []).push(row.elapsedMs)
  const summary = Object.fromEntries(
    Object.entries(groups).map(([name, values]) => {
      const ordered = values.toSorted((a, b) => a - b)
      return [
        name,
        {
          count: values.length,
          min: ordered[0],
          median:
            ordered.length % 2
              ? ordered[(ordered.length - 1) / 2]
              : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2,
          max: ordered.at(-1),
          ...(values.length >= 20 ? { p95: ordered[Math.ceil(values.length * 0.95) - 1] } : {}),
          within100ms: values.filter((value) => value <= 100).length,
          within200ms: values.filter((value) => value <= 200).length,
          over250ms: values.filter((value) => value > 250).length,
        },
      ]
    }),
  )
  await json('completion', {
    passed: true,
    scope:
      phase === 'smoke'
        ? 'Functional compatibility only; no performance, cold-start, physical-screen or reader claims'
        : 'Functional observations complete; budgets judged separately, physical screen and reader not measured',
    summary,
    sourceSha256,
    finalSourceSha256: sha(await readFile(sourcePath)),
  })
} catch (error) {
  if (app) {
    await observe('failure', { error: String(error) }).catch(() => {})
    await app.shot('failure').catch(() => {})
  }
  await json('completion', { passed: false, error: String(error), stack: error.stack })
  throw error
} finally {
  if (app) {
    await app.execute('window.__p7Measure?.dispose?.()').catch(() => {})
    await app.close()
  }
}

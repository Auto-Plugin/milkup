// Optional acceptance segment for an already owned Linux production session.
// It starts no display, driver, window manager or application. DOM is read-only;
// all input uses XTest through the existing exclusive-display fixture.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { x } from './native-updates-fixture.mjs'

export async function verifyNativeTitlebarMenu({ app, ui, windowId, pid }) {
  assert.equal(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY, '1')
  assert(/^:\d+(?:\.\d+)?$/.test(process.env.DISPLAY ?? ''))
  assert(Number.isSafeInteger(pid) && pid > 0, 'Previously verified application owner PID')
  const property = (name) =>
    execFileSync('xprop', ['-id', String(windowId), name], {
      env: process.env,
      encoding: 'utf8',
      timeout: 5000,
    })
  const verifyOwner = () => {
    assert.equal(Number(/= (\d+)/.exec(property('_NET_WM_PID'))?.[1]), pid)
    assert.equal(String(ui.windowId()), String(windowId), 'Same owned visible window')
  }
  const geometry = () => {
    const text = x('getwindowgeometry', '--shell', String(windowId))
    return Object.fromEntries(
      ['X', 'Y', 'WIDTH', 'HEIGHT'].map((key) => {
        const value = Number(new RegExp('^' + key + '=(-?\\d+)$', 'm').exec(text)?.[1])
        assert(Number.isFinite(value), key + ' geometry available')
        return [key, value]
      }),
    )
  }
  const observe = () =>
    app.execute(`
const menu=document.querySelector('[data-app-menu]'),bar=document.querySelector('.titlebar'),editor=document.querySelector('[data-editor-host]');
const r=bar.getBoundingClientRect(),x=r.left+r.width*0.6,y=r.bottom-3,hit=document.elementFromPoint(x,y);
return {phase:menu.dataset.phase,hidden:menu.hidden,width:innerWidth,bar:r.toJSON(),menu:menu.getBoundingClientRect().toJSON(),editor:editor.getBoundingClientRect().toJSON(),barInert:bar.inert,workspaceInert:document.querySelector('.workspace').inert,label:document.querySelector('[data-menu-toggle]').getAttribute('aria-label'),focusInert:!!document.activeElement?.closest('[hidden],[inert]'),controlsVisible:!!document.querySelector('.window-controls').getClientRects().length,drag:{x,y,valid:!!hit?.closest('[data-window-drag-region]')&&!hit?.closest('button,input,textarea,select,a,[inert]')}};
`)
  verifyOwner()
  assert(
    !property('_NET_WM_STATE').includes('_NET_WM_STATE_MAXIMIZED'),
    'Use a normal window for the real pointer drag',
  )
  if (!(await observe()).hidden) {
    await ui.pointer('[data-menu-toggle]')
    await app.until(async () => (await observe()).hidden, 'menu initially closed')
  }
  const before = await observe()
  const positionBeforeClick = geometry()
  await ui.pointer('[data-menu-toggle]')
  await app.until(async () => (await observe()).phase === 'open', 'menu animation complete')
  const opened = await observe()
  assert.equal(opened.label, '返回正文')
  assert.equal(opened.barInert, false)
  assert.equal(opened.controlsVisible, false, 'Linux keeps system decorations')
  assert.equal(opened.menu.top, opened.bar.bottom)
  assert.deepEqual(opened.editor, before.editor, 'Menu does not change editor layout')
  assert.deepEqual(geometry(), positionBeforeClick, 'Menu button does not drag window')
  await app.shot('menu-titlebar-open')
  assert(opened.drag.valid, 'Actual hit-test on non-control titlebar area')
  const beforeDrag = geometry()
  const scale = beforeDrag.WIDTH / opened.width
  const startX = Math.round(opened.drag.x * scale)
  const startY = Math.round(opened.drag.y * scale)
  x('mousemove', '--window', String(windowId), String(startX), String(startY))
  const pointerBefore = x('getmouselocation', '--shell')
  const px = Number(/^X=(-?\d+)$/m.exec(pointerBefore)?.[1])
  const py = Number(/^Y=(-?\d+)$/m.exec(pointerBefore)?.[1])
  assert(Number.isFinite(px) && Number.isFinite(py))
  let afterDrag
  x('mousedown', '1')
  try {
    await app.delay(120)
    x('mousemove', '--sync', String(px + 64), String(py + 40))
    afterDrag = await app.until(() => {
      const next = geometry()
      return Math.abs(next.X - beforeDrag.X) >= 20 || Math.abs(next.Y - beforeDrag.Y) >= 20
        ? next
        : false
    }, 'native pointer drag changes actual window position')
  } finally {
    x('mouseup', '1')
  }
  verifyOwner()
  const after = await observe()
  assert.equal(after.phase, 'open')
  assert.equal(after.barInert, false)
  assert.equal(after.menu.top, after.bar.bottom)
  await app.shot('menu-titlebar-after-native-drag')
  await ui.pointer('[data-menu-toggle]')
  await app.until(async () => (await observe()).hidden, 'Back hides exit overlay')
  const closed = await observe()
  assert.equal(closed.workspaceInert, false)
  assert.equal(closed.focusInert, false)
  assert.equal(closed.label, '菜单')
  assert.deepEqual(geometry(), afterDrag, 'Back button does not start drag')
  return {
    before,
    opened,
    beforeDrag,
    pointerBefore,
    afterDrag,
    after,
    closed,
    boundary:
      'Actual Linux production XTest drag with an existing WM; no Windows button, Windows DPI or installation claim.',
  }
}

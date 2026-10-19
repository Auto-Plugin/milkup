import { JSDOM } from '/workspace/milkup/packages/view-dom/node_modules/jsdom/lib/api.js'
import { canRestoreFocus, restoreDesktopFocus, moveDesktopFocus } from '/workspace/milkup/apps/desktop/src/desktop-focus.ts'
const dom = new JSDOM('<body><div id="invoker">not focusable</div><button id="fallback">Fallback</button><div id="menu"><button id="current">Current</button></div></body>')
const { document, HTMLElement } = dom.window
HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}] }
const target = document.querySelector('#invoker')
const fallback = document.querySelector('#fallback')
const current = document.querySelector('#current')
current.focus()
document.querySelector('#menu').hidden = true
let fallbackCalls = 0
const consideredRestorable = canRestoreFocus(target)
restoreDesktopFocus(target, () => { fallbackCalls++; fallback.focus() })
const record = { viewer: 'jsdom unit probe, not native/browser focus acceptance', consideredRestorable, activeId: document.activeElement.id, fallbackCalls, focusRemainsInHiddenMenu: !!document.activeElement.closest('[hidden]') }
console.log(JSON.stringify(record, null, 2))
dom.window.close()

// Beta.5 acceptance helpers. execute() is observation-only; input uses X11/GTK.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { x, nativeFixture } from './native-updates-fixture.mjs'

export function beta5Fixture(app) {
  let ui
  const pointer = async (selector, { scroll = true, left = false } = {}) => {
    for (let attempt = 0; attempt < (scroll ? 32 : 1); attempt++) {
      const target = await app.execute(
        `const e=document.querySelector(arguments[0]);if(!e)return null;
const r=e.getBoundingClientRect(),x=arguments[1]?r.left+Math.min(8,r.width/2):(r.left+r.right)/2,y=(r.top+r.bottom)/2;
let parent=e.parentElement;while(parent&&!(parent.scrollHeight>parent.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(parent).overflowY)))parent=parent.parentElement;
const p=parent?.getBoundingClientRect();const hit=document.elementFromPoint(x,y);
return {x,y,width:innerWidth,rect:r.toJSON(),hit:!!hit&&(e===hit||e.contains(hit)),disabled:!!e.disabled,scroll:p?{x:(p.left+p.right)/2,y:(p.top+p.bottom)/2,top:p.top,bottom:p.bottom}:null};`,
        selector,
        left,
      )
      assert(target, 'Native pointer target exists: ' + selector)
      assert(!target.disabled, 'Native pointer target enabled: ' + selector)
      const window = ui.windowId()
      const geometry = x('getwindowgeometry', '--shell', window)
      const scale = Number(/WIDTH=(\d+)/.exec(geometry)[1]) / target.width
      assert(Number.isFinite(scale) && scale > 0, 'Actual X11/CSS scale')
      if (target.hit && target.rect.width > 0 && target.rect.height > 0) {
        // WebKit's native wheel animation can continue after the 80ms wheel
        // pause. A measured 57px movement exceeded a 34px button's entire height.
        // Wait for the target, then verify the actual pointer before clicking.
        await app.delay(100)
        const stable = await app.execute(
          'const e=document.querySelector(arguments[0]),r=e?.getBoundingClientRect();return !!r&&Math.abs(r.left-arguments[1])<0.5&&Math.abs(r.top-arguments[2])<0.5&&r.width===arguments[3]&&r.height===arguments[4]',
          selector,
          target.rect.left,
          target.rect.top,
          target.rect.width,
          target.rect.height,
        )
        if (!stable) continue
        x(
          'mousemove',
          '--window',
          window,
          String(Math.round(target.x * scale)),
          String(Math.round(target.y * scale)),
        )
        const actual = x('getmouselocation', '--shell')
        const number = (text, key) =>
          Number(new RegExp('^' + key + '=(-?\\d+)$', 'm').exec(text)?.[1])
        const actualX = (number(actual, 'X') - number(geometry, 'X')) / scale
        const actualY = (number(actual, 'Y') - number(geometry, 'Y')) / scale
        assert(
          Number.isFinite(actualX) && Number.isFinite(actualY),
          'Actual native pointer coordinates',
        )
        const stillHit = await app.execute(
          'const e=document.querySelector(arguments[0]),r=e?.getBoundingClientRect(),hit=document.elementFromPoint(arguments[1],arguments[2]);return !!e&&!e.disabled&&!!r&&Math.abs(r.left-arguments[3])<0.5&&Math.abs(r.top-arguments[4])<0.5&&!!hit&&(e===hit||e.contains(hit))',
          selector,
          actualX,
          actualY,
          target.rect.left,
          target.rect.top,
        )
        if (!stillHit) continue
        x('click', '1')
        return target
      }
      assert(
        scroll && target.scroll && target.rect.height > 0,
        'Unobscured native pointer target: ' + selector,
      )
      const direction = target.y < target.scroll.top ? '4' : '5'
      x(
        'mousemove',
        '--window',
        window,
        String(Math.round(target.scroll.x * scale)),
        String(Math.round(target.scroll.y * scale)),
        'click',
        '--repeat',
        '2',
        '--delay',
        '45',
        direction,
      )
      await app.delay(80)
    }
    assert.fail('Native wheel could not reveal ' + selector)
  }
  // nativeFixture's shipped menu/picker orchestration is reused, but its DOM-focus
  // activation is replaced with an actual native pointer. Never expose app.focus.
  ui = nativeFixture(() => ({ ...app, click: pointer }))
  const editorFocus = async () => {
    await ui.closeMenu()
    await app.key('ctrl+1')
    await app.until(
      async () => (await app.probe()).mode === 'source',
      'source mode for native caret setup',
    )
    const selector = await app.execute(
      `const root=document.querySelector('.milkup-editor'),bounds=root.getBoundingClientRect();const line=[...root.querySelectorAll('.milkup-line')].find(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top>=bounds.top&&r.bottom<=Math.min(bounds.bottom,innerHeight)});return line?'.milkup-line[data-line="'+line.dataset.line+'"]':null;`,
    )
    assert(selector, 'Visible source line for a real editor pointer click')
    await pointer(selector, { left: true })
    await app.until(
      () => app.execute('return document.activeElement?.matches(".milkup-input-proxy")'),
      'native click focuses editor input',
    )
  }
  const position = async (source, offset, mode = 'live') => {
    assert(offset >= 0 && offset <= source.length)
    await editorFocus()
    await app.key('ctrl+Home')
    const preceding = source.slice(0, offset),
      lines = preceding.split('\n')
    if (lines.length > 1)
      x('key', '--clearmodifiers', '--repeat', String(lines.length - 1), '--delay', '5', 'Down')
    await app.key('Home')
    assert(!preceding.endsWith('\r'), 'Do not place a caret inside a CRLF pair')
    const column = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(lines.at(-1)),
    ].length
    if (column) x('key', '--clearmodifiers', '--repeat', String(column), '--delay', '5', 'Right')
    await app.until(
      async () => (await app.probe()).cursor === offset,
      'native caret at source offset ' + offset,
    )
    if (mode === 'live') await app.key('ctrl+2')
    await app.until(async () => (await app.probe()).mode === mode, 'native mode ' + mode)
  }
  return { ...ui, pointer, editorFocus, position }
}

export function readNativeClipboard() {
  // The application owns the real clipboard after Ctrl+C. This separate GTK
  // client only reads it, without synthetic ClipboardEvent or page clipboard API.
  // wait_for_text prefers text/plain and normalizes CRLF to LF while decoding it.
  // Request UTF8_STRING's raw bytes so the source equality assertion stays exact.
  return execFileSync(
    'python3',
    [
      '-c',
      `
import ctypes as c,sys
G=c.CDLL('libgtk-3.so.0');D=c.CDLL('libgdk-3.so.0')
G.gtk_init(None,None)
D.gdk_atom_intern_static_string.argtypes=[c.c_char_p];D.gdk_atom_intern_static_string.restype=c.c_void_p
G.gtk_clipboard_get.argtypes=[c.c_void_p];G.gtk_clipboard_get.restype=c.c_void_p
G.gtk_clipboard_wait_for_contents.argtypes=[c.c_void_p,c.c_void_p];G.gtk_clipboard_wait_for_contents.restype=c.c_void_p
G.gtk_selection_data_get_data.argtypes=[c.c_void_p];G.gtk_selection_data_get_data.restype=c.c_void_p
G.gtk_selection_data_get_length.argtypes=[c.c_void_p];G.gtk_selection_data_get_length.restype=c.c_int
G.gtk_selection_data_get_format.argtypes=[c.c_void_p];G.gtk_selection_data_get_format.restype=c.c_int
G.gtk_selection_data_free.argtypes=[c.c_void_p]
clip=G.gtk_clipboard_get(D.gdk_atom_intern_static_string(b'CLIPBOARD'))
selection=G.gtk_clipboard_wait_for_contents(clip,D.gdk_atom_intern_static_string(b'UTF8_STRING'))
if not selection: sys.exit('No real X11 UTF8_STRING clipboard data')
try:
 if G.gtk_selection_data_get_format(selection)!=8: sys.exit('Clipboard UTF8_STRING format is not 8-bit')
 length=G.gtk_selection_data_get_length(selection);value=G.gtk_selection_data_get_data(selection)
 if length<0 or (length>0 and not value): sys.exit('Invalid clipboard UTF8_STRING length or data')
 raw=c.string_at(value,length) if length else b''
 raw.decode('utf-8',errors='strict')
 sys.stdout.buffer.write(raw)
finally: G.gtk_selection_data_free(selection)
`,
    ],
    { encoding: 'utf8', env: process.env, timeout: 10000 },
  )
}

export const observeBeta5 = (app) =>
  app.execute(`
const rect=e=>e?.getBoundingClientRect().toJSON()??null;
const visible=e=>!!e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&e.getClientRects().length>0;
const source=e=>({text:e.textContent,from:Number(e.dataset.from),to:Number(e.dataset.to),line:e.closest('.milkup-line')?.dataset.line,hidden:e.classList.contains('milkup-marker-hidden'),display:getComputedStyle(e).display,rect:rect(e),lineRect:rect(e.closest('.milkup-line'))});
const toolbar=document.querySelector('[data-plugin-slot="document-toolbar"]'),formatting=document.querySelector('[data-plugin-ui="milkup.formatting:formatting-toolbar"]'),editor=document.querySelector('.milkup-editor'),menu=document.querySelector('[data-app-menu]');
return {url:location.href,theme:document.documentElement.dataset.theme,mode:editor?.dataset.mode,windowed:!!document.querySelector('.milkup-source-document-view'),width:innerWidth,height:innerHeight,zoom:Number(document.querySelector('#app')?.dataset.appearanceZoom),appVersion:document.querySelector('[data-app-version]')?.textContent,
focus:{tag:document.activeElement?.tagName,class:document.activeElement?.className,editor:!!document.activeElement?.matches('.milkup-input-proxy'),html:document.activeElement?.outerHTML.slice(0,500)},menu:visible(menu),menuScroll:document.querySelector('[data-menu-panel="plugins"]')?.scrollTop,
editor:rect(editor),header:rect(document.querySelector('.titlebar')),cursor:Number(document.querySelector('.milkup-cursor')?.dataset.position),selection:[...document.querySelectorAll('.milkup-selection')].map(e=>({from:Number(e.dataset.from),to:Number(e.dataset.to),line:Number(e.dataset.line)})),
vector:[...document.querySelectorAll('.milkup-document-presentation svg text')].map(e=>e.textContent),vectorColors:[...document.querySelectorAll('.milkup-document-presentation svg text')].map(e=>({text:e.textContent,fill:getComputedStyle(e).fill,color:getComputedStyle(e).color})),previews:[...document.querySelectorAll('[data-document-presentation]')].map(e=>({from:Number(e.dataset.presentationFrom),to:Number(e.dataset.presentationTo),label:e.getAttribute('aria-label'),rect:rect(e)})),notices:[...document.querySelectorAll('[data-document-presentation-notice]')].map(e=>({text:e.textContent,visible:visible(e),rect:rect(e)})),
code:[...document.querySelectorAll('.milkup-code-source')].map(source),lines:[...document.querySelectorAll('.milkup-line')].map(source),pickers:[...document.querySelectorAll('.milkup-code-language')].map(e=>({value:e.value,visible:visible(e),rect:rect(e)})),imagesInCode:document.querySelectorAll('.milkup-code-source img').length,
toolbar:{visible:visible(toolbar),display:toolbar?getComputedStyle(toolbar).display:null,rect:rect(toolbar),formattingVisible:visible(formatting),formattingHidden:formatting?.hidden??null,commands:[...toolbar?.querySelectorAll('button[data-plugin-command]')??[]].map(e=>({command:e.dataset.pluginCommand,text:e.textContent,disabled:e.disabled,visible:visible(e)}))},
cards:[...document.querySelectorAll('.plugin-summary-card[data-plugin-id]')].map(e=>({id:e.dataset.pluginId,rect:rect(e),text:e.textContent,checked:e.querySelector('[role="switch"]')?.getAttribute('aria-checked'),busy:e.querySelector('[role="switch"]')?.getAttribute('aria-busy'),focus:e.querySelector('[role="switch"]')===document.activeElement})),
};`)

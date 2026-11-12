import { afterEach, expect, it } from 'vitest'
import { EditorState, MemoryTextDocument, MemoryDocumentSource, Selection } from '@milkup/core'
import { EditorView, SourceDocumentView, type DocumentPresentationConfig } from '../index'
const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
  document.body.replaceChildren()
})
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
}
const text = '```mermaid\nflowchart TD\nA --> B\n```\n\nOutside'
const end = text.indexOf('\n\n')
function config(error = false): DocumentPresentationConfig {
  return {
    provide: async ({
      sourceIdentity: _i,
      sourceVersion: _v,
      documentVersion: _d,
      visibleFrom: _f,
      visibleTo: _t,
      ...window
    }) => ({
      declarations: [{ id: 'test', contexts: ['fence'], fenceLanguages: ['mermaid'] }],
      request: {
        ...window,
        documentId: 'test',
        version: 0,
        contextKnown: true,
        protectedRanges: [],
        blocks: [
          {
            kind: 'fence',
            from: 0,
            to: end,
            complete: true,
            info: 'mermaid',
            contentRanges: [{ from: 11, to: end - 4 }],
          },
        ],
        theme: 'light',
        target: 'screen',
      },
      result: {
        complete: true,
        fragments: [
          {
            from: 0,
            to: end,
            layout: 'block',
            accessibleText: 'Diagram',
            ...(error
              ? {
                  status: 'error',
                  message: 'Unsupported diagram syntax',
                  content: { type: 'text', text: 'Unsupported diagram syntax' },
                }
              : {
                  content: {
                    type: 'vector',
                    width: 200,
                    height: 80,
                    children: [{ type: 'text', x: 10, y: 30, text: 'A to B' }],
                  },
                }),
          },
        ],
      },
    }),
  }
}
for (const windowed of [false, true]) {
  async function setup() {
    const parent = document.createElement('main')
    document.body.append(parent)
    const doc = new MemoryTextDocument(text)
    const v = windowed
      ? new SourceDocumentView({
          parent,
          mode: 'live',
          source: new MemoryDocumentSource({ documentId: 'test', document: doc }),
        })
      : new EditorView({
          parent,
          mode: 'live',
          state: new EditorState({ doc, selection: Selection.cursor(20) }),
        })
    views.push(v)
    if (v instanceof SourceDocumentView) await v.revealSelection(2, Selection.cursor(20))
    v.inputDOM.focus()
    await settle()
    return v
  }
  it(`shows newly enabled block when old caret lost editing focus and restores source on edit (${windowed})`, async () => {
    const v = await setup()
    const card = document.createElement('button')
    document.body.append(card)
    card.focus()
    v.setDocumentPresentation(config())
    await settle()
    expect(v.contentDOM.querySelector('svg')?.textContent).toBe('A to B')
    expect(document.activeElement).toBe(card)
    v.inputDOM.focus()
    await settle()
    expect(v.contentDOM.querySelector('svg')).toBeNull()
    expect(v.contentDOM.textContent).toContain('flowchart TD')
    card.focus()
    await settle()
    expect(v.contentDOM.querySelector('svg')?.textContent).toBe('A to B')
    v.setDocumentPresentation(undefined)
    await settle()
    expect(v.contentDOM.querySelector('svg')).toBeNull()
    expect(v.contentDOM.textContent).toContain('flowchart TD')
  })
  it(`keeps error diagnostics even while caret edits the unsupported block (${windowed})`, async () => {
    const v = await setup()
    v.setDocumentPresentation(config(true))
    await settle()
    expect(v.contentDOM.querySelector('svg')).toBeNull()
    expect(v.dom.querySelector('[data-document-presentation-notice]')?.textContent).toContain(
      'Unsupported diagram syntax',
    )
    expect(v.contentDOM.textContent).toContain('flowchart TD')
  })
  it(`retains preview nodes across focus handoff when the caret is outside (${windowed})`, async () => {
    const v = await setup()
    if (v instanceof SourceDocumentView) await v.revealSelection(6, Selection.cursor(text.length))
    else
      v.updateState(new EditorState({ doc: v.state.doc, selection: Selection.cursor(text.length) }))
    v.setDocumentPresentation(config())
    await settle()
    const preview = v.contentDOM.querySelector<HTMLElement>('[data-document-presentation]')!
    const svg = preview.querySelector('svg')!
    expect(svg).not.toBeNull()
    preview.focus()
    await settle()
    expect(document.activeElement).toBe(preview)
    expect(v.contentDOM.querySelector('svg')).toBe(svg)
    v.inputDOM.focus()
    await settle()
    expect(document.activeElement).toBe(v.inputDOM)
    expect(v.contentDOM.querySelector('svg')).toBe(svg)
  })
  it(`retains block focus while the caret stays inside unrelated inline source (${windowed})`, async () => {
    const v = await setup()
    const selection = Selection.cursor(text.length - 3)
    if (v instanceof SourceDocumentView) await v.revealSelection(6, selection)
    else v.updateState(new EditorState({ doc: v.state.doc, selection }))
    const base = config()
    v.setDocumentPresentation({
      ...base,
      provide: async (...args) => {
        const response = await base.provide(...args)
        return {
          ...response,
          declarations: [{ id: 'test', contexts: ['fence', 'text'], fenceLanguages: ['mermaid'] }],
          result: {
            ...response.result,
            fragments: [
              ...response.result.fragments,
              {
                from: end + 2,
                to: text.length,
                layout: 'inline',
                accessibleText: 'Inline preview',
                content: { type: 'text', text: 'Inline preview' },
              },
            ],
          },
        }
      },
    })
    await settle()
    const preview = v.contentDOM.querySelector<HTMLElement>('[data-document-presentation]')!
    const svg = preview.querySelector('svg')!
    expect(svg).not.toBeNull()
    expect(v.contentDOM.textContent).toContain('Outside')
    preview.focus()
    await settle()
    expect(document.activeElement).toBe(preview)
    expect(v.contentDOM.querySelector('svg')).toBe(svg)
    expect(v.contentDOM.textContent).toContain('Outside')
    v.inputDOM.focus()
    await settle()
    expect(v.contentDOM.querySelector('svg')).toBe(svg)
    expect(document.activeElement).toBe(v.inputDOM)
  })
}

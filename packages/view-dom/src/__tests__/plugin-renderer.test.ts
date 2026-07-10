import { EditorState, MemoryTextDocument } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'

import { renderMarkdownLines } from '../index'

describe('controlled plugin renderers', () => {
  it('mounts renderer output inside the assigned line slot', async () => {
    const lines = renderMarkdownLines(document, createState('# Title\n'), 'live', {
      controlledRenderers: [
        {
          id: 'title-renderer',
          nodeType: 'heading',
          render: (context) => `Rendered ${context.source.trim()}`,
        },
      ],
    })

    await waitForRenderer()

    const slot = lines[0]?.querySelector<HTMLElement>('.milkup-plugin-renderer-slot')
    expect(slot?.textContent).toBe('Rendered # Title')
    expect(slot?.dataset.rendererState).toBe('ready')
  })

  it('falls back to source text when a renderer fails', async () => {
    const lines = renderMarkdownLines(document, createState('# Title\n'), 'live', {
      controlledRenderers: [
        {
          id: 'bad-renderer',
          nodeType: 'heading',
          render: () => {
            throw new Error('renderer exploded')
          },
        },
      ],
    })

    await waitForRenderer()

    const slot = lines[0]?.querySelector<HTMLElement>('.milkup-plugin-renderer-slot')
    expect(slot?.textContent).toBe('# Title')
    expect(slot?.dataset.rendererState).toBe('failed')
    expect(slot?.title).toBe('renderer exploded')
  })

  it('rejects arbitrary DOM output and falls back inside the assigned slot', async () => {
    const lines = renderMarkdownLines(document, createState('# Title\n'), 'live', {
      controlledRenderers: [
        {
          id: 'unsafe-renderer',
          nodeType: 'heading',
          render: () => document.createElement('iframe') as never,
        },
      ],
    })

    await waitForRenderer()

    const slot = lines[0]?.querySelector<HTMLElement>('.milkup-plugin-renderer-slot')
    expect(slot?.dataset.rendererState).toBe('failed')
    expect(slot?.querySelector('iframe')).toBeNull()
    expect(slot?.textContent).toBe('# Title')
  })

  it('dispatches declared command actions through the host event bridge', async () => {
    const lines = renderMarkdownLines(document, createState('# Title\n'), 'live', {
      controlledRenderers: [
        {
          id: 'action-renderer',
          nodeType: 'heading',
          render: () => ({
            type: 'element',
            tag: 'button',
            text: 'Run',
            action: { command: 'example.run', input: { source: 'renderer' } },
          }),
        },
      ],
    })
    await waitForRenderer()
    const listener = vi.fn()
    lines[0]?.addEventListener('milkup-plugin-renderer-action', listener)
    lines[0]?.querySelector('button')?.click()

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      rendererId: 'action-renderer',
      command: 'example.run',
      input: { source: 'renderer' },
    })
  })
})

function createState(text: string): EditorState {
  return new EditorState({
    doc: new MemoryTextDocument(text),
  })
}

async function waitForRenderer(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

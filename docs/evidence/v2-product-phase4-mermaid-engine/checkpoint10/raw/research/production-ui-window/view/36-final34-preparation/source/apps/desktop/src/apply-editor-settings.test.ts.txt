import { expect, it } from 'vitest'
import { applyEditorSettings, applyPresentationToCurrentViews } from './apply-editor-settings'
import { createDesktopSettingsService } from './settings-service'

it('restores actual native zoom after a subsequent view effect fails, before reporting rollback complete', async () => {
  let nativeZoom = 1
  let cachedZoom = 1
  let fail = false
  const zoomCalls: number[] = []
  const settings = createDesktopSettingsService({
    applyView: (values, signal) =>
      applyEditorSettings(
        values,
        {
          theme: async () => undefined,
          zoom: async (value) => {
            nativeZoom = value
            zoomCalls.push(value)
          },
          editor: async () => {
            if (fail) {
              fail = false
              throw Error('layout failed')
            }
          },
          applied: (value) => {
            cachedZoom = value.zoom
          },
        },
        signal,
      ),
  })
  await settings.ready
  const owner = settings.adapterForPlugin('test.preferences')
  const transaction = await owner.adapter.begin('application')
  fail = true
  await expect(owner.adapter.preview(transaction.id, { 'appearance.zoom': 2 })).rejects.toThrow()
  expect(zoomCalls).toEqual([1, 2, 1])
  expect(nativeZoom).toBe(1)
  expect(cachedZoom).toBe(1)
  await owner.dispose()
})

it('applies preferences to a replacement view when document switching races asynchronous layout', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  let oldSize = 14,
    newSize = 14
  const oldView = {
    setPresentation: async (value: { fontSize: number }) => {
      oldSize = value.fontSize
      await pending
    },
  }
  const newView = {
    setPresentation: async (value: { fontSize: number }) => {
      newSize = value.fontSize
    },
  }
  let current = oldView
  const applying = applyPresentationToCurrentViews(() => [undefined, current], {
    fontFamily: 'monospace',
    fontSize: 24,
    lineHeight: 1.5,
    contentWidth: 0,
    indentation: 'spaces-2',
  })
  expect(oldSize).toBe(24)
  current = newView
  finish()
  await applying
  expect(newSize).toBe(24)
})

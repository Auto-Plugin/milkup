import { describe, expect, it, vi } from 'vitest'
import { createPluginUiBroker, createPluginUiHostCapabilities } from './ui-broker'

const location = { documentId: 'doc', version: 3, from: 4, to: 7 }
describe('versioned plugin navigation', () => {
  it('passes an immutable range and final lifecycle guard to the host', async () => {
    const revealLocation = vi.fn((request, context) => {
      context.assertActive()
      expect(Object.isFrozen(request)).toBe(true)
    })
    const broker = createPluginUiBroker({
      pluginId: 'notes',
      viewIds: [],
      update() {},
      revealLocation,
    })
    await createPluginUiHostCapabilities(broker).revealLocation(location)
    expect(revealLocation).toHaveBeenCalledWith(
      location,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        assertActive: expect.any(Function),
      }),
    )
  })
  it('blocks invalid ranges and a revoked command before host navigation', async () => {
    const revealLocation = vi.fn()
    const broker = createPluginUiBroker({
      pluginId: 'notes',
      viewIds: [],
      update() {},
      revealLocation,
    })
    await expect(broker.revealLocation!({ ...location, to: 2 })).rejects.toThrow(/invalid/i)
    await expect(
      createPluginUiHostCapabilities(broker, () => false).revealLocation(location),
    ).rejects.toThrow(/revoked/i)
    expect(revealLocation).not.toHaveBeenCalled()
  })
  it.each(['signal', 'dispose'] as const)(
    'aborts pending navigation with %s and prevents a late host commit',
    async (kind) => {
      let finish!: () => void
      const wait = new Promise<void>((resolve) => {
        finish = resolve
      })
      const commit = vi.fn()
      const broker = createPluginUiBroker({
        pluginId: 'notes',
        viewIds: [],
        update() {},
        revealLocation: async (_request, context) => {
          await wait
          context.assertActive()
          commit()
        },
      })
      const controller = new AbortController()
      const result = broker.revealLocation!(location, { signal: controller.signal })
      if (kind === 'signal') controller.abort()
      else broker.dispose!()
      await expect(result).rejects.toThrow(/abort|revok/i)
      finish()
      await Promise.resolve()
      expect(commit).not.toHaveBeenCalled()
    },
  )
})

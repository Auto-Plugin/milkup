import { createHash, webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentPresentationRequest } from '@milkup/core'
import {
  disposeDocumentPngImages,
  documentPngResourceStats,
} from '@milkup/core/internal/document-png-image'
import { createPrivateMermaidOwner, isNativePngBase64 } from './private-mermaid-service'

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='
const sha256 = createHash('sha256').update(Buffer.from(pngBase64, 'base64')).digest('hex')
const source = '```mermaid\nflowchart LR\nA-->B\n```\n'
const request: DocumentPresentationRequest = {
  documentId: 'private-service-test',
  version: 1,
  source,
  from: 0,
  to: source.length,
  fromLine: 1,
  toLine: 5,
  completeStart: true,
  completeEnd: true,
  contextKnown: true,
  protectedRanges: [{ from: 0, to: source.length }],
  blocks: [
    {
      kind: 'fence',
      from: 0,
      to: source.length,
      complete: true,
      info: 'mermaid',
      contentRanges: [{ from: 11, to: source.indexOf('```', 3) }],
    },
  ],
  selection: { anchor: source.length, head: source.length },
  theme: 'light',
  target: 'screen',
  width: 640,
}
function image(args: Record<string, unknown>) {
  const req = args.request as { ownerId: string; requestId: string }
  return {
    leaseId: 'lease1',
    ownerId: req.ownerId,
    requestId: req.requestId,
    width: 1,
    height: 1,
    pngBase64,
    sha256,
    engine: '12.2.0',
  }
}
const owners: ReturnType<typeof createPrivateMermaidOwner>[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.retire()
  vi.unstubAllGlobals()
  expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
})
function fixture(handler?: (command: string, args: Record<string, unknown>) => Promise<unknown>) {
  vi.stubGlobal('crypto', webcrypto)
  const invoke = vi.fn(
    handler ??
      (async (command, args) => (command === 'private_mermaid_render' ? image(args) : null)),
  )
  const owner = createPrivateMermaidOwner(invoke)
  owners.push(owner)
  return { invoke, owner }
}
describe('host-private Mermaid ownership', () => {
  it('validates large base64 without recursive regex stack growth', () => {
    expect(isNativePngBase64('A'.repeat(22_369_620) + 'AA==')).toBe(true)
    expect(isNativePngBase64('A'.repeat(22_369_628))).toBe(false)
    expect(isNativePngBase64('AA=A')).toBe(false)
    expect(isNativePngBase64('A===')).toBe(false)
    expect(isNativePngBase64('A A=')).toBe(false)
  })
  it('sends only the recognized fence body and transfers a verified PNG lease', async () => {
    const { invoke, owner } = fixture()
    const deadline = performance.now() + 5000
    const result = await owner.render(request, { deadline })
    const native = invoke.mock.calls.find(([command]) => command === 'private_mermaid_render')![1]
    expect(native.request).toMatchObject({
      source: 'flowchart LR\nA-->B\n',
      width: 640,
      theme: 'default',
      look: 'classic',
    })
    expect((native.request as { remainingMs: number }).remainingMs).toBeLessThanOrEqual(5000)
    expect(result.fragments[0]?.content.type).toBe('host-png-image')
    expect(
      invoke.mock.calls.filter(([command]) => command === 'private_mermaid_release'),
    ).toHaveLength(0)
    disposeDocumentPngImages(result)
    await owner.retire()
    expect(
      invoke.mock.calls.filter(([command]) => command === 'private_mermaid_release'),
    ).toHaveLength(1)
  })
  it.each(['sha256', 'requestId', 'width', 'engine', 'pngBase64'] as const)(
    'releases an owned lease when %s is corrupt',
    async (field) => {
      const { invoke, owner } = fixture(async (command, args) =>
        command === 'private_mermaid_render'
          ? { ...image(args), [field]: field === 'width' ? 2 : 'corrupt' }
          : null,
      )
      await expect(owner.render(request, {})).rejects.toThrow()
      await owner.retire()
      expect(
        invoke.mock.calls.filter(([command]) => command === 'private_mermaid_release'),
      ).toHaveLength(1)
    },
  )
  it.each(['abort', 'retire'] as const)(
    'rejects and releases completion after %s',
    async (kind) => {
      let complete!: (value: unknown) => void
      let args!: Record<string, unknown>
      const { invoke, owner } = fixture(async (command, value) => {
        if (command !== 'private_mermaid_render') return null
        args = value
        return new Promise((resolve) => {
          complete = resolve
        })
      })
      const controller = new AbortController()
      const pending = owner.render(request, { signal: controller.signal })
      const rejected = expect(pending).rejects.toThrow()
      let retired: Promise<void> | undefined
      if (kind === 'abort') controller.abort()
      else {
        let finished = false
        retired = owner.retire().then(() => {
          finished = true
        })
        await Promise.resolve()
        expect(finished).toBe(false)
      }
      complete(image(args))
      await rejected
      await retired
      await owner.retire()
      expect(
        invoke.mock.calls.filter(([command]) => command === 'private_mermaid_cancel'),
      ).toHaveLength(1)
      expect(
        invoke.mock.calls.filter(([command]) => command === 'private_mermaid_release'),
      ).toHaveLength(1)
    },
  )
  it('does not start expired, aborted, unknown-context or export requests', async () => {
    const { invoke, owner } = fixture()
    await expect(owner.render(request, { deadline: performance.now() - 1 })).rejects.toThrow()
    await expect(owner.render(request, { signal: AbortSignal.abort() })).rejects.toThrow()
    await expect(owner.render({ ...request, contextKnown: false }, {})).rejects.toThrow()
    await expect(owner.render({ ...request, target: 'export' }, {})).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })
  it('reports cleanup failure from a late completion and retries that owned release', async () => {
    let complete!: (value: unknown) => void
    let args!: Record<string, unknown>
    let failRelease = true
    const { owner } = fixture(async (command, value) => {
      if (command === 'private_mermaid_render') {
        args = value
        return new Promise((resolve) => {
          complete = resolve
        })
      }
      if (command === 'private_mermaid_release' && failRelease) throw Error('release failed')
      return null
    })
    const rendering = owner.render(request, {})
    const rejected = expect(rendering).rejects.toThrow()
    const retirement = owner.retire()
    const failed = expect(retirement).rejects.toThrow('cleanup failed')
    complete(image(args))
    await rejected
    await failed
    failRelease = false
    await expect(owner.retire()).resolves.toBeUndefined()
  })
  it('retires without invalidating another owner and never revives', async () => {
    const first = fixture(),
      second = fixture()
    await first.owner.retire()
    await expect(first.owner.render(request, {})).rejects.toThrow()
    const result = await second.owner.render(request, {})
    disposeDocumentPngImages(result)
    expect(second.invoke.mock.calls[0]?.[0]).toBe('private_mermaid_render')
  })
})

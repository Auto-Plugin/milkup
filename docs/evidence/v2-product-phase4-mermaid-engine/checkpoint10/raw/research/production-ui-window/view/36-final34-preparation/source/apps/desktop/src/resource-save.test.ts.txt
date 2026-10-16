import { describe, expect, it, vi } from 'vitest'
import { saveWithResources } from './resource-save'

describe('resource-aware save', () => {
  function fixture() {
    return {
      prepare: vi.fn(async () => ({ id: 'copies' })),
      write: vi.fn(async () => 'saved'),
      accept: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      report: vi.fn(),
    }
  }
  it('copies before Markdown and accepts only after the disk write', async () => {
    const f = fixture()
    await expect(saveWithResources(f)).resolves.toBe('saved')
    expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.write.mock.invocationCallOrder[0]!)
    expect(f.write.mock.invocationCallOrder[0]).toBeLessThan(f.accept.mock.invocationCallOrder[0]!)
    expect(f.abort).not.toHaveBeenCalled()
  })
  it('never writes Markdown after a resource conflict', async () => {
    const f = fixture()
    f.prepare.mockRejectedValue(Error('conflict'))
    await expect(saveWithResources(f)).rejects.toThrow('conflict')
    expect(f.write).not.toHaveBeenCalled()
    expect(f.abort).not.toHaveBeenCalled()
  })
  it('cleans only its prepared transaction when the Markdown write fails', async () => {
    const f = fixture()
    f.write.mockRejectedValue(Error('disk changed'))
    await expect(saveWithResources(f)).rejects.toThrow('disk changed')
    expect(f.abort).toHaveBeenCalledWith('copies')
    expect(f.accept).not.toHaveBeenCalled()
  })
  it('retains resources and reports ACK failure after Markdown has committed', async () => {
    const f = fixture()
    f.accept.mockRejectedValue(Error('ACK failed'))
    await expect(saveWithResources(f)).resolves.toBe('saved')
    expect(f.abort).not.toHaveBeenCalled()
    expect(f.report).toHaveBeenCalledOnce()
  })
})

describe('resource service and save coordination', () => {
  async function fixture() {
    const { createDesktopResourceService } = await import('./resource-service')
    const calls: string[] = []
    let copySequence = 0
    const fail = { write: false, acknowledge: false }
    const service = createDesktopResourceService({
      currentDocument: () => ({
        documentId: 'doc',
        version: 1,
        selectionRevision: 0,
        saveLocationGeneration: 1,
        path: '/old/a.md',
      }),
      ensureDocumentSaved: async () => true,
      transport: async <T>(command: string, args: Record<string, unknown>) => {
        calls.push(`${command}:${String(args.transactionId ?? '')}`)
        if (command === 'resources_prepare_relocation')
          return { id: `copy-${++copySequence}`, replacements: {} } as T
        if (command === 'resources_commit_relocation' && fail.acknowledge)
          throw Error('ACK unavailable')
        return true as T
      },
    })
    const owner = service.adapterForPlugin('test.images')
    const report = vi.fn()
    const write = vi.fn(async () => {
      if (fail.write) throw Error('write rejected before rename')
      return { path: '/new/a.md', text: '![image](assets/local.png)' }
    })
    const save = () =>
      saveWithResources({
        prepare: () => service.prepareRelocation('doc', 'selected-target', ['assets/local.png']),
        write,
        accept: (id) => service.commitRelocation(id),
        abort: (id) => service.abort(id),
        report,
      })
    return { service, owner, calls, fail, report, write, save }
  }
  it('an acknowledgement failure retains copied files across plugin disposal and document release', async () => {
    const f = await fixture()
    f.fail.acknowledge = true
    await expect(f.save()).resolves.toMatchObject({ path: '/new/a.md' })
    f.owner.dispose()
    await f.service.releaseDocument('doc')
    expect(f.report).toHaveBeenCalledOnce()
    expect(f.calls.some((command) => command.startsWith('resources_abort:'))).toBe(false)
  })
  it('a failed Markdown write aborts only this relocation while another prepared copy remains', async () => {
    const f = await fixture()
    const unrelated = await f.service.prepareRelocation('doc', 'another-target', [
      'assets/other.png',
    ])
    f.fail.write = true
    await expect(f.save()).rejects.toThrow('write rejected before rename')
    expect(f.calls.filter((command) => command.startsWith('resources_abort:'))).toEqual([
      'resources_abort:copy-2',
    ])
    await f.service.commitRelocation(unrelated.id)
    expect(f.calls).toContain('resources_commit_relocation:copy-1')
  })
  it('the first save can write without inventing a source resource grant', async () => {
    const f = await fixture()
    await expect(
      saveWithResources({
        prepare: async () => undefined,
        write: f.write,
        accept: (id) => f.service.commitRelocation(id),
        abort: (id) => f.service.abort(id),
        report: f.report,
      }),
    ).resolves.toMatchObject({ path: '/new/a.md' })
    expect(f.calls).toEqual([])
  })
})

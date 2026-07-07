import { describe, expect, it } from 'vitest'

import { recordRecentFile, removeRecentFile } from './recent-files'

describe('recent files', () => {
  it('records opened files at the front', () => {
    const recent = recordRecentFile([], { path: 'D:/notes/a.md' }, 10)

    expect(recent).toEqual([{ path: 'D:/notes/a.md', openedAt: 10 }])
  })

  it('deduplicates by path and keeps the newest timestamp', () => {
    const first = recordRecentFile([], { path: 'D:/notes/a.md' }, 10)
    const second = recordRecentFile(first, { path: 'D:/notes/b.md' }, 20)
    const third = recordRecentFile(second, { path: 'D:/notes/a.md' }, 30)

    expect(third).toEqual([
      { path: 'D:/notes/a.md', openedAt: 30 },
      { path: 'D:/notes/b.md', openedAt: 20 },
    ])
  })

  it('enforces a maximum length', () => {
    const recent = [
      { path: 'D:/notes/a.md', openedAt: 1 },
      { path: 'D:/notes/b.md', openedAt: 2 },
    ]

    expect(recordRecentFile(recent, { path: 'D:/notes/c.md' }, 3, 2)).toEqual([
      { path: 'D:/notes/c.md', openedAt: 3 },
      { path: 'D:/notes/a.md', openedAt: 1 },
    ])
  })

  it('removes unavailable recent files', () => {
    const recent = [
      { path: 'D:/notes/a.md', openedAt: 1 },
      { path: 'D:/notes/b.md', openedAt: 2 },
    ]

    expect(removeRecentFile(recent, { path: 'D:/notes/a.md' })).toEqual([
      { path: 'D:/notes/b.md', openedAt: 2 },
    ])
  })
})

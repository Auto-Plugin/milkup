import { describe, expect, it } from 'vitest'
import { formatDisplayPath } from './display-path'
import { recoveryStatusText } from './recovery-status-presentation'

describe('beta3 display paths', () => {
  it.each([
    [String.raw`\\?\C:\笔记\文档.md`, 'C:/笔记/文档.md'],
    [String.raw`\\?\UNC\server\share\文档.md`, '//server/share/文档.md'],
    ['//?/UNC/server/share/file.md', '//server/share/file.md'],
    ['//?/c:/notes/file.md', 'c:/notes/file.md'],
    [String.raw`\\server\share\file.md`, '//server/share/file.md'],
    ['/tmp/../file.md', '/tmp/../file.md'],
    ['//?/Volume{abc}/file.md', '//?/Volume{abc}/file.md'],
  ])('formats only known extended path prefixes: %s', (native, display) => {
    const original = native
    expect(formatDisplayPath(native)).toBe(display)
    expect(native).toBe(original)
  })
  it('does not truncate long paths', () => {
    const tail = '目录/'.repeat(300) + '文档.md'
    expect(formatDisplayPath('//?/C:/' + tail)).toBe('C:/' + tail)
  })
})

describe('beta3 recovery presentation', () => {
  it('hides ordinary internal revision status', () => {
    expect(recoveryStatusText({ phase: 'ready', version: 123 })).toBe('')
    expect(recoveryStatusText({ phase: 'idle' })).toBe('')
  })
  it('keeps unbacked edits and failures visible without version labels', () => {
    expect(recoveryStatusText({ phase: 'pending' })).toBe('尚未生成恢复备份')
    expect(recoveryStatusText({ phase: 'pending', version: 123 })).toBe('新编辑尚未备份')
    expect(recoveryStatusText({ phase: 'error', version: 123 })).toBe('恢复备份失败')
    expect(recoveryStatusText({ phase: 'writing', version: 123 })).toBe('正在备份未保存编辑…')
  })
})

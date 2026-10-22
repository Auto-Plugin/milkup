import { describe, expect, it } from 'vitest'
import { renderApplicationUpdates } from './application-updates-ui'
import type { ApplicationUpdateState } from './application-updates'

const state: ApplicationUpdateState = {
  phase: 'available',
  hasUpdate: true,
  currentVersion: '2.0.0',
  channel: 'beta',
  release: {
    id: 'opaque',
    version: '2.0.1',
    notes: '<script>alert("x")</script>\nsecond line',
    date: null,
  },
}
const actions = (html: string) =>
  [...html.matchAll(/data-application-update-action="([^"]+)"/g)].map((match) => match[1])

describe('built-in updates presentation', () => {
  it.each([
    ['download', 'available', undefined, '下载更新'],
    ['cancel', 'downloading', undefined, '取消下载'],
    ['install', 'ready', undefined, '请求安装更新'],
    ['check', 'error', 'check', '重试检查'],
  ] as const)(
    'renders %s with a decorative icon and its unchanged text label',
    (action, phase, retry, label) => {
      const html = renderApplicationUpdates({ ...state, phase, retry })
      const button = html.match(
        new RegExp(`<button[^>]*data-application-update-action="${action}"[^>]*>(.*?)</button>`),
      )?.[1]
      expect(button).toMatch(/<svg[^>]*aria-hidden="true"[^>]*focusable="false"/)
      expect(button).toContain(`<span>${label}</span>`)
    },
  )
  it('renders untrusted metadata as plain text and never exposes opaque IDs', () => {
    const html = renderApplicationUpdates({
      ...state,
      channel: '<img src=x>',
      release: { ...state.release!, version: '<b>next</b>' },
    })
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x&gt;')
    expect(html).toContain('&lt;b&gt;next&lt;/b&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('opaque')
    expect(html).toContain('second line')
    expect(actions(html)).toEqual(['download'])
  })
  it('distinguishes failure and unconfigured channels from current', () => {
    expect(renderApplicationUpdates({ phase: 'unavailable', hasUpdate: false })).toContain(
      '尚未配置',
    )
    const error = renderApplicationUpdates({
      phase: 'error',
      hasUpdate: false,
      error: '<b>离线</b>',
      retry: 'check',
    })
    expect(error).toContain('role="alert"')
    expect(error).toContain('&lt;b&gt;离线&lt;/b&gt;')
    expect(error).not.toContain('最新版本')
    expect(actions(error)).toEqual(['check'])
    expect(renderApplicationUpdates({ phase: 'current', hasUpdate: false })).toContain('最新版本')
  })
  it.each(['downloading', 'verifying'] as const)(
    'exposes cancellation and accessible unknown progress in %s',
    (phase) => {
      const html = renderApplicationUpdates({ ...state, phase, received: 1024, total: null })
      expect(html).toContain('aria-busy="true"')
      expect(html).toContain('role="status"')
      expect(html).toContain('总大小未知')
      expect(actions(html)).toEqual(['cancel'])
    },
  )
  it('allows installation only in ready and exposes stage-specific retries', () => {
    expect(actions(renderApplicationUpdates({ ...state, phase: 'ready' }))).toEqual([
      'cancel',
      'install',
    ])
    expect(
      actions(renderApplicationUpdates({ ...state, phase: 'error', retry: 'download' })),
    ).toEqual(['download'])
    expect(
      actions(renderApplicationUpdates({ ...state, phase: 'error', retry: 'cancel' })),
    ).toEqual(['cancel'])
    for (const phase of ['checking', 'cancelling', 'confirming', 'installing'] as const) {
      const html = renderApplicationUpdates({ ...state, phase })
      expect(actions(html)).toEqual([])
      expect(html).toContain('aria-busy="true"')
    }
  })
  it('does not render a blank release heading or extra check button before a release exists', () => {
    const html = renderApplicationUpdates({
      phase: 'idle',
      hasUpdate: false,
      currentVersion: '2.0.0',
    })
    expect(actions(html)).toEqual([])
    expect(html).not.toContain('更新版本')
    expect(html).toContain('2.0.0')
  })
})

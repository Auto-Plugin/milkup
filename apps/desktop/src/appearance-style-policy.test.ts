// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import {
  applyCompiledThemeStyle,
  hostStyleNonce,
  previewStyleNonce,
  validateStyleNonce,
} from './appearance-style-policy'

afterEach(() => {
  document.head.replaceChildren()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

function seed(nonce: string): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = 'milkup-style-authority'
  style.nonce = nonce
  style.textContent = 'body { color: black; }'
  document.head.append(style)
  return style
}

it('uses the current static style nonce property before appending compiled CSS', () => {
  const authority = seed('123456789012345678')
  // Browsers can hide the content attribute while preserving the IDL property.
  authority.getAttribute = () => ''
  const style = document.createElement('style')
  applyCompiledThemeStyle(style, ':root { --theme-proof: blue; }')
  expect(style.nonce).toBe('123456789012345678')
  expect(style.sheet?.cssRules.length).toBe(1)
  expect(previewStyleNonce(document)).toBe(style.nonce)
  authority.nonce = '987654321012345678'
  expect(hostStyleNonce(document)).toBe('987654321012345678')
})

it('never substitutes a script nonce or generates native authority when the style seed is missing', () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  const script = document.createElement('script')
  script.id = 'milkup-style-authority'
  script.nonce = '123456'
  document.head.append(script)
  const style = document.createElement('style')
  expect(() => applyCompiledThemeStyle(style, 'body { color: blue; }')).toThrow('样式授权缺失')
  expect(() => previewStyleNonce(document)).toThrow('样式授权缺失')
  expect(style.isConnected).toBe(false)
  expect(style.textContent).toBe('')
})

it('rejects nonce text that could alter HTML attributes or the preview CSP', () => {
  for (const nonce of ['', 'abc" onload="bad', "abc'; script-src *", '<style>', 'x'.repeat(131)])
    expect(() => validateStyleNonce(nonce)).toThrow('样式授权无效')
  seed('bad nonce')
  expect(() => hostStyleNonce(document)).toThrow('样式授权无效')
})

it('reports a blocked sheet and restores the previous owned style instead of reporting success', () => {
  seed('123456')
  const style = document.createElement('style')
  style.nonce = 'previous'
  style.textContent = 'body { color: green; }'
  document.head.append(style)
  Object.defineProperty(style, 'sheet', { get: () => null })
  expect(() => applyCompiledThemeStyle(style, 'body { color: red; }')).toThrow('内容安全策略阻止')
  expect(style.textContent).toBe('body { color: green; }')
  expect(style.nonce).toBe('previous')
  expect(style.isConnected).toBe(true)
})

it('removes a newly blocked sheet and permits nonce-only previews in ordinary browser development', () => {
  const style = document.createElement('style')
  Object.defineProperty(style, 'sheet', { get: () => null })
  expect(() => applyCompiledThemeStyle(style, 'body { color: red; }')).toThrow('内容安全策略阻止')
  expect(style.isConnected).toBe(false)
  expect(previewStyleNonce(document)).toMatch(/^[a-f0-9]{32}$/)
  expect(hostStyleNonce(document)).toBeUndefined()
})

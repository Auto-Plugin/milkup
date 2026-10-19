import { describe, expect, it } from 'vitest'
import { validateClosedWorkerBundle } from './closed-worker-bundle'

describe('closed Worker bundle boundary', () => {
  it.each([
    `import 'https://example.test/payload.js'`,
    `import x from './payload.js'; export { x }`,
    `export * from 'data:text/javascript,export default 1'`,
    `export { x } from './payload.js'`,
    `export function activate() { return import('https://example.test/payload.js') }`,
    `export function activate(x) { return import(x) }`,
    `export const x = () => import(/* comment */ './pay\\u006coad.js')`,
    `export const x = () => import(\`https://example.test/${'${name}'}\`)`,
  ])('rejects an unsealed import: %s', (source) => {
    expect(() => validateClosedWorkerBundle(source)).toThrow(/single closed bundle/)
  })

  it('allows bundled code, import.meta, strings, regexes, and comments', () => {
    const source = `// import('bad')\nexport const text = "import('bad')";
      export const pattern = /import\\('bad'\\)/;
      export const url = import.meta.url;
      export function activate() { return { commands: {} } }`
    expect(validateClosedWorkerBundle(source)).toBe(source)
  })

  it('rejects malformed import syntax and bounds decoded UTF-8 bytes', () => {
    expect(() => validateClosedWorkerBundle(`import {`)).toThrow()
    expect(() => validateClosedWorkerBundle('中'.repeat(12), 32)).toThrow(/byte limit/)
    expect(validateClosedWorkerBundle('a'.repeat(32), 32)).toHaveLength(32)
  })
})

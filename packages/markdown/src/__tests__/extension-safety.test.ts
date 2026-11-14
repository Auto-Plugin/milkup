import { describe, expect, it } from 'vitest'

import { parseMarkdown, runMarkdownExtensionSafely } from '../index'

describe('markdown extension safety', () => {
  it('returns values from successful extension hooks', () => {
    expect(
      runMarkdownExtensionSafely({ extensionName: 'example', hook: 'inline' }, () => 'ok'),
    ).toEqual({
      ok: true,
      value: 'ok',
    })
  })

  it('captures thrown extension parser failures', () => {
    const error = new Error('plugin parser exploded')
    const result = runMarkdownExtensionSafely(
      { extensionName: 'bad-plugin', hook: 'block' },
      () => {
        throw error
      },
    )

    expect(result).toEqual({
      ok: false,
      error,
      context: {
        extensionName: 'bad-plugin',
        hook: 'block',
      },
    })
  })

  it('keeps base parsing independent from extension failures', () => {
    runMarkdownExtensionSafely({ extensionName: 'bad-plugin', hook: 'block' }, () => {
      throw new Error('plugin parser exploded')
    })

    expect(parseMarkdown('# Still parses').root.children?.[0]).toMatchObject({
      type: 'heading',
      status: 'valid',
    })
  })
})

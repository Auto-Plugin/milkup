import { describe, expect, it } from 'vitest'

import { convertHtmlToMarkdown, normalizePaste } from './paste'

describe('paste pipeline', () => {
  it('prefers plain text when it is available', () => {
    expect(
      normalizePaste({
        plainText: '# Title\n\n- item',
        html: '<h1>Title</h1><ul><li>item</li></ul>',
      }),
    ).toEqual({
      text: '# Title\n\n- item',
      strategy: 'plain-text',
      handled: true,
    })
  })

  it('uses plain text inside code blocks even when html is available', () => {
    expect(
      normalizePaste(
        {
          plainText: 'def f():\n\n    return 1',
          html: '<p><strong>def f</strong></p>',
        },
        { inCodeBlock: true },
      ),
    ).toEqual({
      text: 'def f():\n\n    return 1',
      strategy: 'plain-text',
      handled: true,
    })
  })

  it('converts simple html to markdown when plain text is missing', () => {
    expect(
      normalizePaste({
        html: '<h1>Answer</h1><p>This is <strong>bold</strong> and <em>em</em>.</p>',
      }),
    ).toEqual({
      text: '# Answer\n\nThis is **bold** and *em*.',
      strategy: 'html-to-markdown',
      handled: true,
    })
  })

  it('converts links, lists, quotes, and code blocks from html', () => {
    expect(
      convertHtmlToMarkdown(
        '<p><a href="https://example.com">site</a></p><ul><li>one</li><li><code>two</code></li></ul><blockquote>quoted</blockquote><pre><code>const x = 1\n</code></pre>',
      ),
    ).toBe('[site](https://example.com)\n\n- one\n- `two`\n\n> quoted\n\n```\nconst x = 1\n```')
  })

  it('converts html tables to markdown tables', () => {
    expect(
      convertHtmlToMarkdown(
        '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>alpha</td><td>a | b</td></tr></tbody></table>',
      ),
    ).toBe('| Name | Value |\n| --- | --- |\n| alpha | a \\| b |')
  })

  it('preserves common AI answer structure from nested html', () => {
    expect(
      convertHtmlToMarkdown(
        '<div><h2>Plan</h2><p>Use <strong>transactions</strong>.</p><ol><li>Parse</li><li>Render</li></ol><pre><code>const ok = true\n\nconsole.log(ok)</code></pre><table><tr><th>Risk</th><th>Status</th></tr><tr><td>history</td><td>covered</td></tr></table></div>',
      ),
    ).toBe(
      '## Plan\n\nUse **transactions**.\n\n1. Parse\n2. Render\n\n```\nconst ok = true\n\nconsole.log(ok)\n```\n\n| Risk | Status |\n| --- | --- |\n| history | covered |',
    )
  })

  it('defers file-only paste to the future asset pipeline', () => {
    expect(
      normalizePaste({
        files: [{ name: 'image.png', type: 'image/png' }],
      }),
    ).toEqual({
      text: '',
      strategy: 'files-deferred',
      handled: false,
    })
  })

  it('does not handle empty clipboard payloads', () => {
    expect(normalizePaste({})).toEqual({
      text: '',
      strategy: 'empty',
      handled: false,
    })
  })
})

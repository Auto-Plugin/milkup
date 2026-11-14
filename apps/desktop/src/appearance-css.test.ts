import { describe, expect, it, vi } from 'vitest'
import { compileThemeCss, maximumThemeBytes } from './appearance-css'
import defaultCss from './appearance-default.css?raw'
vi.mock('./appearance-default.css?raw', async () => ({
  default: (await import('node:fs')).readFileSync(
    new URL('./appearance-default.css', import.meta.url),
    'utf8',
  ),
}))
const compile = (css: string) => compileThemeCss(css, () => true)
describe('bounded CSS themes', () => {
  it('compiles both default palettes and actual editor styles', () => {
    const result = compile(defaultCss)
    expect(result.ruleCount).toBeGreaterThan(8)
    expect(result.css).toContain(':root[data-theme="dark"]')
    expect(result.css).toContain('.milkup-block-code:where(.milkup-editor, .milkup-editor *)')
  })
  it('supports typography, gradients, custom variables and descendant selectors', () => {
    const result = compile(
      ':root{--theme-ink:rgb(12 30 42);--text:var(--theme-ink)} .milkup-editor .milkup-line{font-family:"Noto Sans CJK";color:var(--text);background:linear-gradient(90deg,#fff,#eee)}',
    )
    expect(result.css).toContain('.milkup-editor   .milkup-line:where(')
    expect(result.css).toContain('linear-gradient(90deg,#fff,#eee)')
  })
  it('uses application mode for authored media queries, without delegating explicit mode to OS', () => {
    expect(compile('@media(prefers-color-scheme:dark){p{color:white}}').css).toContain(
      ':root[data-theme="dark"] p:where(',
    )
  })
  it.each([
    '@import "https://example.invalid/css";',
    '@font-face{font-family:x;src:url(file:///secret)}',
    'p{background:url(https://example.invalid)}',
    'p{background:u\\72l("file:///secret")}',
    'p{background:U\\000052L("https://example.invalid")}',
    ':root{--theme-image:url(https://example.invalid)}p{background:var(--theme-image)}',
    ':root{--theme-image:image-set("https://example.invalid/a" 1x)}',
    'p{background:var(--theme-x,image-set("https://example.invalid" 1x))}',
    'p{color:attr(data-secret type(<color>))}',
    'p{background:paint(x)}',
    'p{font-family:expression(x)}',
    '.app-menu{color:red}',
    '#app{color:red}',
    'body{color:red}',
    'p{position:fixed}',
    'p{display:none}',
    'p{color:red!important}',
    'p::before{content:"spoof"}',
    '[data-secret]{color:red}',
    ':root{--text:var(--unrelated-host-state)}',
    ':root{color:red}',
    ':root{--theme-a:var(--theme-b);--theme-b:var(--theme-a)}',
    ':root{--theme-a:var(--theme-a)}',
    'p{color:red',
    'p{color:rgb(1 2 3}',
    'p{color:red}/*',
    'p{margin:-30px}',
    'p{color:red;@import "https://example.invalid"}',
    ':root[data-theme="dark"]{--text:#fff}@media(prefers-color-scheme:light){:root[data-theme="dark"]{--text:#000}}',
  ])('rejects unsafe or unsupported input before stylesheet application: %s', (source) => {
    expect(() => compile(source)).toThrow()
  })
  it('rejects spacing substitution and arithmetic bypasses while allowing mode-specific variable overrides', () => {
    expect(() =>
      compile(':root{--theme-offset:-10000px}.milkup-line{margin-top:var(--theme-offset)}'),
    ).toThrow()
    expect(() => compile('.milkup-line{margin-top:calc(0px - 10000px)}')).toThrow()
    expect(() =>
      compile(
        ':root{--theme-a:red;--theme-b:var(--theme-a)}:root[data-theme="dark"]{--theme-b:blue;--theme-a:var(--theme-b)}',
      ),
    ).not.toThrow()
  })
  it('keeps CSS comment token boundaries without inventing descendant whitespace', () => {
    expect(compile('.milkup-line/**/.milkup-block-code{color:red}').css).toContain(
      '.milkup-line.milkup-block-code:where(',
    )
    expect(compile('.milkup-line/* note */:first-child{color:red}').css).toContain(
      '.milkup-line:first-child:where(',
    )
    expect(compile('[data-mode="live"]{color:red}').css).toContain('[data-mode="live"]:where(')
    expect(compile('p{color:gr/**/een}').css).toContain('gr/**/een')
  })
  it('limits geometry to explicit uniform editor font size and line height', () => {
    expect(compile('.milkup-editor{font-size:20px;line-height:30px}').css).toContain(
      'font-size:20px',
    )
    for (const css of [
      '.milkup-line{font-size:28px}',
      '.milkup-line{line-height:2}',
      '.milkup-editor{line-height:normal}',
      '.milkup-editor{font-size:var(--theme-size)}',
      '.milkup-editor{line-height:0}',
      '.milkup-line{border:2px solid red}',
      '.milkup-line{padding:2px}',
    ])
      expect(() => compile(css)).toThrow()
    expect(
      compile(
        '.milkup-line{font-family:serif;font-weight:700;letter-spacing:0.2px;border-color:red;outline:1px solid blue}',
      ).css,
    ).toContain('outline:1px solid blue')
  })
  it('bounds paint cost and only elevates validated uniform root font declarations above editor inline metrics', () => {
    for (const css of [
      'p{box-shadow:0 0 100000px black}',
      ':root{--theme-blur:100000px}',
      'p{box-shadow:0 0 calc(64px * 64) black}',
      'p{box-shadow:var(--theme-shadow)}',
      'p{border-radius:100000px}',
      'p{letter-spacing:10000px}',
      'p{background:linear-gradient(' + Array.from({ length: 70 }, () => 'red').join(',') + ')}',
    ])
      expect(() => compile(css)).toThrow()
    const css = compile(
      '.milkup-editor{font-size:18px;line-height:27px;font-family:serif;color:red}.milkup-line{font-weight:700}',
    ).css
    expect(css).toContain('font-size:18px!important')
    expect(css).toContain('line-height:27px!important')
    expect(css).toContain('font-family:serif!important')
    expect(css).not.toContain('color:red!important')
    expect(() => compile('.milkup-editor{font-size:18px!important}')).toThrow()
  })
  it('does not interpret URL-like text inside harmless font strings as resource requests', () => {
    expect(compile('p{font-family:"url(https://example.invalid)",monospace}').css).toContain(
      'font-family:',
    )
  })
  it('rejects invalid CSS values through the browser grammar validator', () => {
    expect(() => compileThemeCss('p{color:broken}', () => false)).toThrow('无法解析')
  })
  it('bounds total source and rule counts', () => {
    expect(() => compile(' '.repeat(maximumThemeBytes + 1))).toThrow('128 KiB')
    expect(() => compile('p{color:red}'.repeat(257))).toThrow('256')
  })
  it('intersects every final selector with the editor subtree, even after sibling combinators', () => {
    expect(compile('.milkup-editor + p, :where(.milkup-line,pre) ~ code{color:red}').css).toBe(
      '.milkup-editor + p:where(.milkup-editor, .milkup-editor *),:where(.milkup-line,pre) ~ code:where(.milkup-editor, .milkup-editor *){color:red;}',
    )
  })
})

const { createRequire } = require('node:module')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const requireWorkspace = createRequire('/workspace/milkup/package.json')
const { chromium } = requireWorkspace('@playwright/test')
async function main() {
  const input = process.argv[2]
  const sourcePath = process.argv[3]
  const output = process.argv[4]
  const screenshot = process.argv[5]
  const source = await fs.readFile(sourcePath, 'utf8')
  const raw = await fs.readFile(input)
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, offline: true })
    const requests = [], blockedExternal = [], pageErrors = [], consoleErrors = []
    await context.route(/https?:\/\//, async route => { blockedExternal.push(route.request().url()); await route.abort('internetdisconnected') })
    const page = await context.newPage()
    page.on('request', request => requests.push(request.url()))
    page.on('pageerror', error => pageErrors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.setContent(raw.toString('utf8'), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const dom = await page.evaluate(() => {
      const all = selector => [...document.querySelectorAll(selector)]
      const count = selector => all(selector).length
      const ids = all('[id]').map(e => e.id)
      return {
        title: document.title, language: document.documentElement.lang,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
        structure: { html: count('html'), head: count('head'), body: count('body'), heading1: count('h1'), heading2: count('h2'), tables: count('table'), tableHeaders: count('thead tr'), tableBodyRows: count('tbody tr'), fencedCode: count('pre > code'), blockquotes: count('blockquote') },
        unsafeElements: all('script,iframe,object,embed,base,form,link').map(e => e.outerHTML),
        eventHandlerAttributes: all('*').flatMap(e => [...e.attributes].filter(a => /^on/i.test(a.name)).map(a => ({ tag: e.tagName, name: a.name, value: a.value }))),
        externalAttributes: all('[src],[href],[poster],[srcset]').flatMap(e => [...e.attributes].filter(a => ['src','href','poster','srcset'].includes(a.name) && !a.value.startsWith('data:') && !a.value.startsWith('#')).map(a => ({ tag: e.tagName, name: a.name, value: a.value }))),
        duplicateIds: ids.filter((id,i) => ids.indexOf(id)!==i),
        brokenLocalLinks: all('a[href^="#"]').filter(a => !document.getElementById(a.getAttribute('href').slice(1))).map(a => a.outerHTML),
        mathCount: count('math'), svgCount: count('svg'), images: all('img').map(e => ({ alt:e.alt, complete:e.complete, naturalWidth:e.naturalWidth, naturalHeight:e.naturalHeight, dataUrl:e.src.startsWith('data:'),bounds:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height} })),
        footnoteLocalLinks: all('a[href^="#source-"]').map(a => ({ label:a.textContent, href:a.getAttribute('href') })),
        sourceFallbacks: all('.source-fallback').map(e => e.textContent),
        imagePlaceholders: all('.image-placeholder').map(e => e.textContent),
        visibleWarnings: all('.export-warning li').map(e => e.textContent),
        codeText: all('pre > code').map(e => e.textContent),
        inlineScriptLiteral: all('td code').some(e => e.textContent === '<script>alert(1)</script>'),
        bodyText: document.body.innerText,
        dimensions: { viewportWidth:innerWidth, documentWidth:document.documentElement.scrollWidth, documentHeight:document.documentElement.scrollHeight },
        styles: { bodyFont:getComputedStyle(document.body).fontFamily, bodyFontSize:getComputedStyle(document.body).fontSize, codeWhiteSpace:document.querySelector('pre') ? getComputedStyle(document.querySelector('pre')).whiteSpace : null, printRuleText:all('style').map(e=>e.textContent).join('\n') },
        userAgent:navigator.userAgent,
      }
    })
    await page.screenshot({ path:screenshot, fullPage:true })
    const fallbackSourceMatches = dom.sourceFallbacks.map(text => ({ text, exactSubstringOfSource:source.includes(text) }))
    const imagePlaceholderSourceMatches = dom.imagePlaceholders.map(text => ({ text, exactSubstringOfSource:source.includes(text) }))
    const result = {
      reviewedAt:new Date().toISOString(),input,sourcePath,sha256:crypto.createHash('sha256').update(raw).digest('hex'),bytes:raw.length,
      mode:'Read-only review of actual production file bytes using setContent; independent headless Chromium with offline network context; no DISPLAY used.',
      loadMethod:{method:'page.setContent(exactUTF8FileBytes)',directFileNavigation:'Not retried in this run; earlier review encountered Chromium environment administrator policy ERR_BLOCKED_BY_ADMINISTRATOR',limitation:'DOM/pixel review is not proof of successful direct file:// opening.'},
      resourceScope:{supported:'existing managed resource paths assets/ or document.assets/; no permission widening',rootLogoFixture:'Root-level logo-fixture.png is outside managed scope; assets/logo-fixture.png is supported. Each reviewed artifact is counted independently below.',claim:'Do not generalize this result to embedding every relative path.'},
      browserVersion:browser.version(),screenshot,dom,
      fallbackSourceMatches,imagePlaceholderSourceMatches,
      network:{offline:true,requests,blockedExternal},pageErrors,consoleErrors,
      conclusions:{
        structuralAndSafetyChecksPassed:dom.unsafeElements.length===0 && dom.eventHandlerAttributes.length===0 && dom.externalAttributes.length===0 && dom.duplicateIds.length===0 && dom.brokenLocalLinks.length===0 && dom.inlineScriptLiteral && pageErrors.length===0,
        fallbackSourcePreserved:fallbackSourceMatches.every(x=>x.exactSubstringOfSource),
        imagesEmbeddedSuccessfully:dom.images.length>0 && dom.images.every(x=>x.dataUrl&&x.complete&&x.naturalWidth>0),
        richMathPresent:dom.mathCount>0,richDiagramPresent:dom.svgCount>0,richFootnoteLinksPresent:dom.footnoteLocalLinks.length>0,
        fallbackIsNotRichRenderingSuccess:true,
        networkFetchesAttempted:requests.filter(url=>/^https?:/.test(url)),
        horizontalOverflow:dom.dimensions.documentWidth>dom.dimensions.viewportWidth,
      },
      remainingAcceptance:['This browser inspection does not replace native WebKit HTML/PDF/print visual acceptance.','Fallback output only proves explicit source-preserving degradation, not rich math/diagram/footnote/image support.']
    }
    await fs.writeFile(output,JSON.stringify(result,null,2)+'\n')
    console.log(JSON.stringify({output,conclusions:result.conclusions,counts:{math:dom.mathCount,svg:dom.svgCount,images:dom.images.length,footnoteLinks:dom.footnoteLocalLinks.length,fallbacks:dom.sourceFallbacks.length,imagePlaceholders:dom.imagePlaceholders.length,warnings:dom.visibleWarnings.length}},null,2))
  } finally { await browser.close() }
}
main().catch(error=>{console.error(error);process.exit(1)})

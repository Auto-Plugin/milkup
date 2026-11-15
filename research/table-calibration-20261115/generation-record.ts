// Archived local generation test, executed in the integration export test directory.
// Paths below record that execution, not a CI entry point. Fixtures are frozen and hash-checked.
import { it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { renderStaticMarkdownDocument } from './static-html'
it('generates frozen baseline and controls from the exact accepted serializer', () => {
  const source = readFileSync('/workspace/milkup-pagination-evidence/43688690760/raw/gui/complex-pagination.md','utf8')
  const out='/workspace/milkup-table-calibration-20261115/research/table-calibration-20261115/fixtures/'
  const rows=source.match(/^\| T[A-Z]{2} .*$/gm)!
  expect(rows).toHaveLength(72)
  const controls: Record<string,string> = { baseline:source }
  let short=source
  for(const row of rows.slice(3)) short=short.replace(row+'\n','')
  controls['short-edge']=short
  const loose=(s:string)=>s.replace(/\nP[A-Z]{2} A short paragraph before the long blocks\. ENDP[A-Z]{2}\n/g, (line)=>line.includes('PAA ')?line:'')
  controls['long-room']=loose(source)
  controls['short-room']=loose(short)
  for(const [name,s] of Object.entries(controls)) {
    const result=renderStaticMarkdownDocument(s,{documentId:'doc',version:1,pageSize:'a4',landscape:false})
    expect(result.warnings).toHaveLength(0)
    expect(result.html).not.toContain('<caption')
    writeFileSync(out+name+'.html',result.html)
    writeFileSync(out+name+'.md',s)
  }
})

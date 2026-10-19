#!/usr/bin/env python3
"""Materialize a separate diagnostic source copy. Does not install, build, or test."""
from pathlib import Path
import argparse,hashlib,json,shutil,datetime
HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser()
p.add_argument('--repo',type=Path,default=Path('/workspace/milkup'))
p.add_argument('--output',type=Path,default=HERE/'prepared')
a=p.parse_args(); repo=a.repo.resolve(); out=a.output.resolve()
if out.exists(): raise SystemExit('Output already exists; preserve prior copy and choose a new path')
if out.is_relative_to(repo): raise SystemExit('Diagnostic output must be outside the product repository')
source=repo/'plugins/outline'
# Review snapshot is the exact pin. Fail closed after source changes.
proof=json.loads((HERE.parent/'outline-index-readonly-source-proof.json').read_text())
for name in ['src/plugin.ts','src/outline-index.ts']:
    f=source/name
    pin=next(x['sha256'] for x in proof['sources'] if x['path']==str(f))
    if hashlib.sha256(f.read_bytes()).hexdigest()!=pin: raise SystemExit('Source pin changed: '+str(f))
for name in ['src/plugin.ts','src/outline-index.ts','scripts/build.mjs','package.json','plugin.json','tsconfig.json']:
    target=out/name; target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(source/name,target)
shutil.copy2(HERE/'diagnostics.ts',out/'src/diagnostics.ts')
def once(s,old,new):
    if s.count(old)!=1: raise SystemExit(f'Expected unique anchor, got {s.count(old)}: {old[:90]}')
    return s.replace(old,new,1)
def wrap(s,start,next_marker,indent,diagnostics,key):
    begin=s.index(start)+len(start)
    limit=s.index(next_marker,begin)
    end=s.rfind('\n'+indent+'}',begin,limit)
    if end<begin: raise SystemExit('Closing brace not found: '+start)
    body=s[begin:end]
    return s[:begin]+f"\n{indent}  const diagnosticEnd = {diagnostics}.start('{key}')\n{indent}  try {{"+body+f"\n{indent}  }} finally {{ diagnosticEnd() }}"+s[end:]

f=out/'src/plugin.ts'; s=f.read_text()
s="import { Diagnostics, diagnosticStore, diagnosticScanner } from './diagnostics'\n"+s
s=once(s,'interface Session {','interface Session {\n  diagnostics: Diagnostics')
s=once(s,'    generation: ++generation,','    generation: ++generation,\n    diagnostics: new Diagnostics(generation, version),')
s=once(s,'new OutlineIndex(store, current.version)','new OutlineIndex(diagnosticStore(store, current.diagnostics), current.version, current.diagnostics)')
s=once(s,'for await (const event of scanner)','for await (const event of diagnosticScanner(scanner, current.diagnostics))')
s=once(s,'    const scanner = document.scan({','    current.diagnostics.add(\'scan.ranges\')\n      const scanner = document.scan({')
s=once(s,'await enqueue(current, async () => {\n            for (const item',"await enqueue(current, async () => {\n            for (const item") # Explicit uniqueness guard before category edits.
s=once(s,'            }\n          })\n        }\n        current.scannedLines','            }\n          }, \'append\')\n        }\n        current.scannedLines')
s=once(s,'          current.followActive = true\n        })','          current.followActive = true\n        }, \'finish\')')
s=once(s,'await enqueue(current, () => current.records!.flush())',"await enqueue(current, () => current.records!.flush(), 'rangeFlush')")
s=once(s,'      await updatePanel(current)\n    }).catch',"      await updatePanel(current)\n    }, 'refresh').catch")
old="""function enqueue<T>(current: Session, task: () => Promise<T>): Promise<T> {
  const pending = current.queue.then(() => {
    assertCurrent(current)
    return task()
  })"""
new="""function enqueue<T>(current: Session, task: () => Promise<T>, kind: 'command' | 'append' | 'finish' | 'rangeFlush' | 'refresh' = 'command'): Promise<T> {
  const queued = performance.now()
  const pending = current.queue.then(async () => {
    current.diagnostics.duration('queue.wait.' + kind, performance.now() - queued)
    assertCurrent(current)
    const end = current.diagnostics.start('queue.work.' + kind)
    try { return await task() } finally { end() }
  })"""
s=once(s,old,new)
s=wrap(s,'async function prepareRows(current: Session, request: number): Promise<void> {','\nfunction panel(', '', 'current.diagnostics','prepareRows')
s=wrap(s,'async function updatePanel(current: Session): Promise<void> {','\nfunction positiveInteger(', '', 'current.diagnostics','updatePanel')
s=once(s,"  return span(children, 'plugin-list-panel')","  return span(children, 'plugin-list-panel', { title: current.diagnostics.title(current.status, count, current.scannedLines) })")
s=once(s,'  commands: {',"""  commands: {
    'outline.diagnosticSnapshot': async () => {
      const current = session
      if (!current) throw new Error('No diagnostic outline session')
      // Invoke only after measurement. Capture excludes this dump's own UI work.
      await current.queue
      assertCurrent(current)
      const snapshot = current.diagnostics.capture(current.status, current.records?.size ?? 0, current.scannedLines)
      await host?.ui?.requestUpdate('outline-panel')
      return snapshot
    },""")
f.write_text(s)

f=out/'src/outline-index.ts'; s=f.read_text()
s="import type { Diagnostics } from './diagnostics'\n"+s
s=once(s,'constructor(private readonly store: SdkTemporaryStore) {}','constructor(private readonly store: SdkTemporaryStore, readonly diagnostics: Diagnostics) {}')
s=once(s,'    private readonly version: number,','    private readonly version: number,\n    private readonly diagnostics: Diagnostics,')
s=once(s,'this.pages = new Pages(store)','this.pages = new Pages(store, diagnostics)')
s=once(s,'    if (hit) {',"    if (hit) {\n      this.diagnostics.add('cache.hit')")
s=once(s,'    const json = await this.store.get(key)',"    this.diagnostics.add('cache.miss')\n    const json = await this.store.get(key)")
s=once(s,'    if (!this.cache.has(key)) await this.room()',"    this.diagnostics.add('cache.put')\n    if (!this.cache.has(key)) await this.room()")
s=once(s,'    for (let start = 0; start < missing.length; start += 4) {',"    this.diagnostics.add('cache.prefetch.missing', missing.length)\n    for (let start = 0; start < missing.length; start += 4) {")
s=once(s,'    if (this.cache.size < cachedPages) return\n    await this.flush()',"    if (this.cache.size < cachedPages) return\n    this.diagnostics.add('cache.eviction.round')\n    await this.flush()")
s=once(s,'      const value = JSON.stringify(entry.value)\n      const size = encoder.encode(value).length',"      const diagnosticSerialization = performance.now()\n      const value = JSON.stringify(entry.value)\n      const size = encoder.encode(value).length\n      this.diagnostics.duration('flush.serializeEncode', performance.now() - diagnosticSerialization)\n      this.diagnostics.add('flush.pages.' + (key.startsWith('m-') ? 'metadata' : key.startsWith('t-') ? 'title' : 'visibility'))\n      this.diagnostics.add('flush.utf8', size)")
s=wrap(s,'  async flush(): Promise<void> {','\n  private async room()', '  ', 'this.diagnostics','pages.flush')
s=wrap(s,'  async selectRange(start: number, end: number): Promise<number[]> {','\n  private async selectFrom(', '  ', 'this.pages.diagnostics','rows.selectRange')
# This async method previously returned a promise; await is needed for elapsed duration.
s=once(s,'    return this.selectFrom(','    return await this.selectFrom(')
s=wrap(s,'  async rank(ordinal: number): Promise<number> {','\n  async atLine(', '  ', 'this.pages.diagnostics','rows.rank')
s=wrap(s,'  async atLine(line: number): Promise<number> {','\nexport interface Heading', '  ', 'this.pages.diagnostics','rows.atLine')
# rows is last method of final class, so add sentinel only for deterministic closing lookup.
s+='\n// diagnostic-end-of-index\n'
s=wrap(s,'  async rows(start: number, end: number): Promise<Heading[]> {','// diagnostic-end-of-index', '  ', 'this.diagnostics','rows.load')
f.write_text(s)

for name in ['package.json','plugin.json']:
    f=out/name; data=json.loads(f.read_text()); data['version']='1.3.2-p7diag.1'
    if name=='plugin.json':
        data['description']='Diagnostic copy only: bounded P7 outline phase aggregates; not a product release.'
        data['contributes']['commands'].append({'id':'outline.diagnosticSnapshot','title':'Diagnostic outline snapshot (after measurement)','action':'outline.diagnosticSnapshot','category':'navigation'})
    f.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
manifest={'preparedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PREPARED_NOT_BUILT_OR_TYPECHECKED','productSourceUnchanged':True,'sourceHead':proof['head'],'output':str(out),'publicSdkUnchanged':True,'version':'1.3.2-p7diag.1','files':[{'path':str(x.relative_to(out)),'sha256':hashlib.sha256(x.read_bytes()).hexdigest()} for x in sorted(out.rglob('*')) if x.is_file()]}
(out/'preparation.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'output':str(out),'status':manifest['status'],'files':len(manifest['files'])},indent=2))

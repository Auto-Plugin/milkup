import { createFootnoteController } from '/workspace/milkup/plugins/footnotes/src/controller.ts'
import { collectOutputPresentations } from '/workspace/milkup/apps/desktop/src/output-presentations.ts'
import { writeFileSync } from 'node:fs'
const records=[]
for (const source of ['A[^x]\n[^x]: body', 'Plain document without footnotes']) {
 let invalidate!:()=>void
 const ready=new Promise<void>(r=>invalidate=r)
 let offset=0, reads=0, invalidations=0
 const lines=source.split('\n').map((text,i)=>{const line={number:i+1,from:offset,to:offset+text.length,text};offset+=text.length+1;return line})
 const controller=createFootnoteController({readWindow:async()=>{reads++;return {documentId:'doc',version:7,fromLine:1,toLine:lines.length,from:0,to:source.length,text:source,totalLines:lines.length,completeStart:true,completeEnd:true,lines}},invalidatePresentation:async()=>{invalidations++;invalidate()}} as any)
 const options={source,sourceOffset:0,documentId:'doc',version:7,fromLine:1,selection:{anchor:0,head:0},signal:new AbortController().signal,assertCurrent:()=>{},renderers:()=>[{pluginId:'any-enabled-plugin',id:'arbitrary-text-renderer',contexts:['text'] as const}],render:async(_p:string,_r:string,request:any,operation:any)=>controller.render(request,operation)}
 const first=await collectOutputPresentations(options)
 const readsAtFirstReturn=reads
 await Promise.race([ready,new Promise((_,rej)=>setTimeout(()=>rej(Error('scan did not finish')),1000))])
 const repeat=await collectOutputPresentations(options)
 records.push({source,readsAtFirstReturn,reads,invalidations,first,repeat})
 controller.dispose()
}
writeFileSync('/workspace/milkup-plugin-lifecycle-evidence/milestone01/reproduce-readiness.json',JSON.stringify({baseline:'1388f646',scope:'Local controlled production-controller/collector reproduction, not nativeUI. No product files modified.',records},null,2)+'\n')
const reproduces=records.every(r=>r.readsAtFirstReturn===0&&r.first.warnings.some(w=>w.code==='presentation-incomplete')&&r.first.presentations.every(b=>b.result.fragments.length===0&&!b.result.complete)&&r.repeat.warnings.length===0&&r.repeat.presentations.every(b=>b.result.complete))
console.log(JSON.stringify({reproduces,firstComplete:records.map(r=>r.first.presentations.every(b=>b.result.complete)),repeatComplete:records.map(r=>r.repeat.presentations.every(b=>b.result.complete))}))
process.exit(process.argv.includes('--expect-ready-first') ? (records.every(r=>r.first.presentations.every(b=>b.result.complete))?0:1) : reproduces?0:2)

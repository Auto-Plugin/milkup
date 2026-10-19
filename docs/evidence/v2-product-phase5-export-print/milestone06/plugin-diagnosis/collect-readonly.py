from pathlib import Path
import hashlib,json,re,subprocess
repo=Path('/workspace/milkup'); root=Path(__file__).parent
runs=Path('/workspace/milkup-export-print-evidence/milestone01/native-ui/runs'); logs=runs.parent/'logs'
summary={'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'kind':'read-only historical evidence and source audit; no new renderer execution','runs':[]}
for name in ['p5-pdf-05','p5-html-10','p5-print-file-04']:
 d=runs/name; source=(d/'source.md').read_text(); match=re.search(r'```mermaid\n.*?```',source,re.S); fence=match.group()
 events=[]
 for line in (logs/(name+'-driver.log')).read_text().splitlines():
  if line.startswith('DOM_NATIVE_TIMING '): events.append(json.loads(line.removeprefix('DOM_NATIVE_TIMING ')))
 first=next(e for e in events if e['requestId']=='render_1' and e['phase']=='dispatch')
 instance=[e for e in events if e['instanceId']==first['instanceId']]
 dispatches=[e for e in instance if e['phase']=='dispatch']
 summary['runs'].append({'name':name,'sourceSha256':hashlib.sha256((d/'source.md').read_bytes()).hexdigest(),'sourceUtf16':len(source.encode('utf-16-le'))//2,'sourceLines':len(source.split('\n')),'fence':fence,'fenceSha256':hashlib.sha256(fence.encode()).hexdigest(),'fenceFromUtf16':len(source[:match.start()].encode('utf-16-le'))//2,'fenceToUtf16':len(source[:match.end()].encode('utf-16-le'))//2,'nativeInstanceEvents':instance,'firstToNextDispatchMs':(dispatches[1]['monotonicNs']-first['monotonicNs'])/1e6 if len(dispatches)>1 else None,'firstRequestPayloadRecorded':False,'diagramTypeFromSource':'flowchart, not eligible for Sankey-only memo','productionOrigin':json.loads((d/'production-origin.json').read_text())})
(root/'historical-comparison.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
paths=['plugins/diagrams/src/plugin.ts','plugins/diagrams/src/renderer.ts','plugins/diagrams/src/success-memo.ts','plugins/diagrams/src/renderer.test.ts','plugins/diagrams/scripts/build-support.mjs','plugins/diagrams/package.json','apps/desktop/src/output-presentations.ts','apps/desktop/src/document-presentation-service.ts','apps/desktop/src/output-service.ts','packages/plugin-sdk/src/index.d.ts','packages/core/src/document-presentation.ts','apps/desktop/src-tauri/src/plugin_dom_process.rs','plugins/diagrams/node_modules/mermaid/dist/mermaid.core.mjs','plugins/diagrams/node_modules/mermaid/dist/mermaid.d.ts']
manifest=[]
for path in paths:
 b=(repo/path).read_bytes();manifest.append({'path':path,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
(root/'source-manifest.json').write_text(json.dumps({'gitHead':summary['gitHead'],'files':manifest},indent=2)+'\n')
print(json.dumps({'head':summary['gitHead'],'runs':[{'name':x['name'],'fenceSHA':x['fenceSha256'],'firstToNextDispatchMs':x['firstToNextDispatchMs']} for x in summary['runs']]},ensure_ascii=False))

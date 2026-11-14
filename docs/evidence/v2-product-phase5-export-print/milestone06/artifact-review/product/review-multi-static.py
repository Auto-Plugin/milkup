#!/usr/bin/env python3
"""Read-only actual product HTML structure/bytes review. No browser, UI or raster."""
from pathlib import Path
import hashlib,json,re,subprocess,runpy
base=Path('/workspace/milkup-export-print-evidence')
runs=base/'milestone01/native-ui/runs'
run=runs/'p5-m06-product-multi-html'
out=Path(__file__).resolve().parent
classes=runpy.run_path(str(base/'milestone06/content/audit-artifact.py'))
Tree=classes['Tree']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
plan=json.loads((run/'plan.json').read_text());observations=json.loads((run/'observations.json').read_text())
expected_source=json.loads(Path('/workspace/milkup/tests/fixtures/p5-output/milestone06/manifest.json').read_text())['fixtures']
expected_source=next(x for x in expected_source if x['id']=='multiple-r1')
reports=[]
for variant in ['first','repeat']:
 artifact=run/(variant+'.html');folder=out/('multi-html-'+variant);folder.mkdir(exist_ok=True)
 command=['python3',str(base/'milestone06/content/audit-artifact.py'),'--fixture','multiple-r1','--kind','html','--artifact',str(artifact),'--output',str(folder/'content-precheck.json')]
 result=subprocess.run(command,capture_output=True,text=True)
 (folder/'content-precheck.log').write_text(result.stdout+result.stderr);(folder/'content-precheck.exit').write_text(str(result.returncode)+'\n')
 precheck=json.loads((folder/'content-precheck.json').read_text());tree=Tree();raw=artifact.read_bytes();tree.feed(raw.decode());nodes=list(tree.root.walk())
 diagrams=[n for n in nodes if n.has_class('presentation-block') and any(x.tag=='svg' for x in n.walk())]
 geometry=[]
 for index,n in enumerate(diagrams,1):
  children=list(n.walk());svgs=[x for x in children if x.tag=='svg'];boxes=[]
  for svg in svgs:
   value=svg.attrs.get('viewbox');values=[float(x) for x in value.split()] if value else []
   boxes.append({'viewBox':values,'positiveSize':len(values)==4 and values[2]>0 and values[3]>0})
  geometry.append({'ordinal':index,'svgCount':len(svgs),'declaredViewBoxes':boxes,'rectCount':sum(x.tag=='rect' for x in children),'nonemptyPathCount':sum(x.tag=='path' and bool(x.attrs.get('d','').strip()) for x in children),'arrowReferenceCount':sum('marker-end' in x.attrs or 'marker-start' in x.attrs for x in children),'textLabels':[x.text() for x in children if x.tag=='text']})
 comparisons=[]
 for name,reference in [('old1.1.1-first',runs/'p5-m06-old-multi-html/first.html'),('rejected1.1.2-first',runs/'p5-m06-new-multi-html-02/first.html'),('rejected1.1.2-repeat',runs/'p5-m06-new-multi-html-02/repeat.html')]:
  comparisons.append({'reference':name,'path':str(reference),'sha256':sha(reference),'bytesExactlyEqual':raw==reference.read_bytes()})
 report={'classification':'ACTUAL_QUEUE_FIX_PRODUCT_RUN_STATIC_REVIEW_ONLY','input':str(artifact),'artifactSHA256':sha(artifact),'artifactBytes':len(raw),'sourceSHA256':sha(run/'source.md'),'sourceMatchesFrozenFixture':sha(run/'source.md')==expected_source['sourceSHA256'],'binarySHA256FromProducerPlan':plan['binarySha256'],'binaryPath':plan['binary'],'diagramPackage':next(x for x in plan['packages'] if x['manifest']['id']=='milkup.diagrams'),'fixtureId':'multiple-r1','geometryScope':'Declared SVG structure and local reference validity only; no browser/computed geometry or new pixel capture was performed.','diagrams':geometry,'unsafeElementCount':sum(n.tag in ['script','iframe','object','embed','base','form','link'] for n in nodes),'eventAttributes':[(n.tag,k) for n in nodes for k in n.attrs if k.startswith('on')],'externalAttributes':[(n.tag,k,v) for n in nodes for k,v in n.attrs.items() if k in ['src','href','srcset','poster'] and not v.startswith(('data:','#'))],'warnings':precheck['warnings'],'unexpectedWarnings':precheck['unexpectedWarnings'],'sourceFallbackCount':len(precheck['fallbackSource']),'duplicateIds':precheck['duplicateIds'],'brokenSvgRefs':precheck['brokenSvgRefs'],'bodyMarkerCounts':precheck['bodyMarkerCounts'],'svgStructurePassed':precheck['svgStructurePassed'],'byteComparisons':comparisons,'cleanCompletionStatus':'FAIL_INCOMPLETE_RENDER_WARNING' if precheck['unexpectedWarnings'] else 'PASS_NO_WARNING_IN_SAVED_HTML','newVisualReview':'NOT_RUN_PENDING_PARENT_CPU_SLOT','overall':'NOT_FULL_ACCEPTANCE: actual saved bytes and static graph structure only; first warning remains failure. No broad timeout reliability claim.'}
 (folder/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');reports.append(report)
first=(run/'first.html').read_text();repeat=(run/'repeat.html').read_text();warning=re.search(r'<aside class="export-warning".*?</aside>',first,re.S)
versions=[{'name':x['name'],'at':x['at'],'version':x.get('document',{}).get('version'),'loading':x.get('document',{}).get('loading'),'sourcePath':x.get('document',{}).get('path'),'fixtureSourceSHA256RecordedByHarness':x.get('sourceSha256'),'statuses':x.get('statuses')} for x in observations if x.get('document',{}).get('path','').endswith('/source.md')]
summary={'classification':'ACTUAL_QUEUE_FIX_PRODUCT_STATIC_AUDIT','binarySHA256FromProducerPlan':plan['binarySha256'],'diagramPluginVersion':reports[0]['diagramPackage']['manifest']['version'],'sourceSHA256':reports[0]['sourceSHA256'],'firstMinusWarningEqualsRepeatExactly':bool(warning) and first.replace(warning[0],'',1)==repeat,'runtimeVersionObservations':versions,'outputs':[{'variant':v,'sha256':r['artifactSHA256'],'diagramCount':len(r['diagrams']),'svgStructurePassed':r['svgStructurePassed'],'bodyMarkers':r['bodyMarkerCounts'],'warningCount':len(r['warnings']),'cleanCompletionStatus':r['cleanCompletionStatus'],'byteComparisons':r['byteComparisons']} for v,r in zip(['first','repeat'],reports)],'pixelReview':'No browser/native UI/rasterization launched. Existing rejected-candidate viewer evidence has byte-identical corresponding inputs, but is not mislabeled as a fresh formal-product screenshot.','status':'FIRST_HAS_INCOMPLETE_WARNING; REPEAT_STATIC_CONTENT_PASS; VISUAL_REVIEW_PENDING'}
(out/'multi-html-static-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='runtimeVersionObservations'},ensure_ascii=False,indent=2))

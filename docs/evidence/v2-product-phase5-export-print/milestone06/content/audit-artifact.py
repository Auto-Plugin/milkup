#!/usr/bin/env python3
"""Draft read-only acceptance aid. Never treats extracted source labels as a diagram.
No UI/native launch; no converter imports. Visual review is a separate required gate.
"""
import argparse, base64, hashlib, json, re, subprocess
from pathlib import Path
from html.parser import HTMLParser

class Element:
    def __init__(self, tag='', attrs=()):
        self.tag=tag; self.attrs=dict(attrs); self.children=[]; self.data=[]
    def walk(self):
        yield self
        for child in self.children: yield from child.walk()
    def text(self): return ''.join(self.data)+''.join(c.text() for c in self.children)
    def has_class(self, name): return name in self.attrs.get('class','').split()

class Tree(HTMLParser):
    def __init__(self):
        super().__init__(); self.root=Element(); self.stack=[self.root]
    def handle_starttag(self,tag,attrs):
        node=Element(tag,attrs); self.stack[-1].children.append(node)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}: self.stack.append(node)
    def handle_endtag(self,tag):
        if len(self.stack)>1 and self.stack[-1].tag==tag:self.stack.pop()
    def handle_data(self,data):self.stack[-1].data.append(data)

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def count_marker(text,marker):return len(re.findall(re.escape(marker)+r'(?![A-Za-z0-9_-])',text))
def visible_text(text):return re.sub(r'\s','',text) # Display label layout only, never PDF codepoint fidelity.

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fixture',required=True)
    p.add_argument('--manifest',type=Path,default=Path('/workspace/milkup/tests/fixtures/p5-output/milestone06/manifest.json'))
    p.add_argument('--artifact',type=Path,required=True)
    p.add_argument('--kind',choices=['html','pdf'],required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();manifest=json.loads(a.manifest.read_text());f=next(x for x in manifest['fixtures'] if x['id']==a.fixture)
    fixture_file=a.manifest.parent/f['file'];fixture_matches=sha(fixture_file)==f['sourceSHA256']
    report={'scope':'Draft independent content audit; actual production provenance, source version and visual review remain mandatory.','fixture':f['id'],'fixtureSHA256':sha(fixture_file),'fixtureMatchesManifest':fixture_matches,'artifact':str(a.artifact.resolve()),'artifactSHA256':sha(a.artifact),'kind':a.kind,'expectedDiagramCount':len(f['diagrams']),'richDiagramVisuallyVerified':False,'knownPdfBoundaries':['Original-codepoint copy/search remains independently required; no normalization waiver.','Existing long-block heading orphan fixtures remain open; these small diagrams do not cover them.']}
    if a.kind=='html':
        parser=Tree();parser.feed(a.artifact.read_text());nodes=list(parser.root.walk());text=parser.root.text()
        presentations=[n for n in nodes if n.has_class('presentation-block') and any(c.tag=='svg' for c in n.walk())]
        ids=[n.attrs['id'] for n in nodes if 'id' in n.attrs]
        references=[r for n in nodes for v in n.attrs.values() for r in re.findall(r'url\(\s*[\"\']?#([^\s\)\"\']+)',v)]
        fallback=[n.text() for n in nodes if n.has_class('source-fallback')]
        graph_checks=[]
        for index,expected in enumerate(f['diagrams']):
            node=presentations[index] if index<len(presentations) else Element()
            children=list(node.walk());labels=[n.text() for n in children if n.tag=='text']
            graph_checks.append({'ordinal':index+1,'labels':labels,'expectedLabels':expected['nodeLabels'],'labelsMatch':all(any(visible_text(e)==visible_text(v) for v in labels) for e in expected['nodeLabels']),'rectCount':sum(n.tag=='rect' for n in children),'minimumExpectedNodeCount':expected['nodeCount'],'arrowReferenceCount':sum('marker-end' in n.attrs or 'marker-start' in n.attrs for n in children),'minimumExpectedEdgeCount':expected['edgeCount']})
        warnings=[n.text() for n in nodes if n.tag=='li' and any(n in list(a.walk()) for a in nodes if a.has_class('export-warning'))]
        unexpected_warnings=[w for w in warnings if not (f['allowedWarningKinds'] and '图片' in w and '增强' not in w)]
        resource_hashes=[]
        for node in nodes:
            if node.tag=='img' and node.attrs.get('src','').startswith('data:'):
                try:resource_hashes.append(hashlib.sha256(base64.b64decode(node.attrs['src'].split(',',1)[1],validate=True)).hexdigest())
                except (ValueError,IndexError):resource_hashes.append('INVALID_DATA_IMAGE')
        resource_checks=[{'file':resource['file'],'expectedSHA256':resource['sha256'],'embeddedCount':resource_hashes.count(resource['sha256'])} for resource in manifest.get('resources',[]) if resource['file'] in f.get('resourceFiles',[])]
        report['requiredEmbeddedResources']=resource_checks
        resources_pass=all(x['embeddedCount']==1 for x in resource_checks)
        structure_pass=len(presentations)==len(f['diagrams']) and all(x['labelsMatch'] and x['rectCount']>=x['minimumExpectedNodeCount'] and x['arrowReferenceCount']>=x['minimumExpectedEdgeCount'] for x in graph_checks) and len(ids)==len(set(ids)) and all(ids.count(r)==1 for r in references)
        report.update(svgPresentationCount=len(presentations),graphChecks=graph_checks,svgStructurePassed=structure_pass,duplicateIds=[x for x in set(ids) if ids.count(x)>1],brokenSvgRefs=[r for r in references if ids.count(r)!=1],fallbackSource=fallback,warnings=warnings,unexpectedWarnings=unexpected_warnings)
        rejected=bool(fallback or unexpected_warnings) or not structure_pass or not resources_pass
    else:
        text=subprocess.check_output(['pdftotext','-raw',str(a.artifact),'-']).decode('utf8')
        pages=text.split('\f');pages=[x for x in pages if x.strip()]
        # These markers are source grammar, not labels inside a drawn SVG.
        fallback_pages=[i+1 for i,t in enumerate(pages) if re.search(r'flowchart\s+LR|```\s*mermaid',t)]
        probes=['中文输入','冻结内容','打印',"'中文代码 P5-CODE-MARKER'",'👩🏽\u200d💻'] if f['id']=='print04-regression' else ['👩🏽\u200d💻'] if '👩🏽\u200d💻' in fixture_file.read_text() else []
        report.update(pageCount=len(pages),fallbackGrammarPages=fallback_pages,copySearchExactProbes={v:v in text for v in probes},copySearchNormalization='NONE',svgStructurePassed=None)
        rejected=bool(fallback_pages)
    counts={m:count_marker(text,m) for m in f['bodyMarkersExactlyOnce']}
    forbidden=[m for m in f['forbiddenRevisionMarkers'] if m in text]
    marker_pass=all(v==1 for v in counts.values())
    report.update(bodyMarkerCounts=counts,bodyMarkersPassed=marker_pass,forbiddenRevisionMarkersPresent=forbidden)
    passed=fixture_matches and marker_pass and not forbidden and not rejected
    report['status']='CONTENT_PRECHECK_PASS_VISUAL_AND_PROVENANCE_PENDING' if passed else 'FAIL_CONTENT_OR_SOURCE_FALLBACK'
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':str(a.output),'status':report['status']}))
    return 0 if passed else 1
if __name__=='__main__':raise SystemExit(main())

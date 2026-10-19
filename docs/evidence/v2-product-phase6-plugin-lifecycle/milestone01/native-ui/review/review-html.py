"""Read-only saved HTML structure audit; no browser, rasterizer or producer calls."""
from pathlib import Path
from html.parser import HTMLParser
import argparse,base64,hashlib,json,re
class Node:
 def __init__(self,tag='',attrs=(),parent=None):self.tag=tag;self.attrs=dict(attrs);self.parent=parent;self.children=[]
 def walk(self):
  yield self
  for child in self.children:
   if isinstance(child,Node):yield from child.walk()
 def text(self):return ''.join(c.text() if isinstance(c,Node) else c for c in self.children)
class Parser(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=Node();self.current=self.root
 def handle_starttag(self,tag,attrs):
  n=Node(tag,attrs,self.current);self.current.children.append(n)
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.current=n
 def handle_startendtag(self,tag,attrs):
  self.current.children.append(Node(tag,attrs,self.current))
 def handle_endtag(self,tag):
  n=self.current
  while n.parent and n.tag!=tag:n=n.parent
  if n.parent:self.current=n.parent
 def handle_data(self,text):self.current.children.append(text)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def audit(file,fixture,run):
 raw=file.read_text();p=Parser();p.feed(raw);nodes=list(p.root.walk());body=next(n for n in nodes if n.tag=='body');text=body.text();ids=[n.attrs['id'] for n in nodes if 'id'in n.attrs]
 refs=[(n.attrs.get('href'),n.text()) for n in nodes if n.tag=='a' and n.attrs.get('href','').startswith('#source-')]
 markers=fixture['bodyMarkersExactlyOnce'];count=lambda s,m:len(re.findall(re.escape(m)+r'(?![A-Za-z0-9_-])',s))
 graphs=[n for n in nodes if n.tag=='svg'];images=[]
 for n in nodes:
  if n.tag=='img' and n.attrs.get('src','').startswith('data:image/'):
   media,b64=n.attrs['src'].split(',',1);payload=base64.b64decode(b64,validate=True);images.append({'alt':n.attrs.get('alt'),'media':media,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()})
 expectedImage=digest(run/'assets/logo-fixture.png')
 warnings=[n.text() for n in nodes if n.tag=='li' and any('export-warning' in a.attrs.get('class','').split() for a in ancestors(n))]
 return {'artifact':str(file),'sha256':digest(file),'bytes':file.stat().st_size,'bodyMarkerCounts':{m:count(text,m) for m in markers},'forbiddenRevisionMarkerCounts':{m:raw.count(m) for m in fixture.get('forbiddenRevisionMarkers',[])},'rawFootnoteMarkerOccurrences':raw.count(next(m for m in markers if 'FOOTNOTE-MARKER'in m)),'textFootnoteMarkerOccurrences':text.count(next(m for m in markers if 'FOOTNOTE-MARKER'in m)),'attributeFootnoteOccurrences':[{'tag':n.tag,'attribute':k,'value':v} for n in nodes for k,v in n.attrs.items() if v and 'FOOTNOTE-MARKER' in v],'footnoteLinks':[{'href':h,'label':label,'resolved':h[1:] in ids} for h,label in refs],'mathCount':sum(n.tag=='math' for n in nodes),'diagramPresentationCount':sum('presentation-block' in n.attrs.get('class','').split() and any(a.tag=='svg' for a in n.walk()) for n in nodes),'svgElementCount':len(graphs),'svgs':[{'viewBox':n.attrs.get('viewbox'),'labelTexts':[a.text() for a in n.walk() if a.tag=='text'],'rects':sum(a.tag=='rect' for a in n.walk()),'paths':sum(a.tag=='path' for a in n.walk()),'arrowReferences':sum('marker-end'in a.attrs or 'marker-start'in a.attrs for a in n.walk())} for n in graphs],'images':images,'originalLocalPNGByteExact':any(i['sha256']==expectedImage for i in images),'warnings':warnings,'rawFootnoteFallback':'[^p5]'in text,'mermaidSourceFallback':'flowchart LR'in text,'fallbackElements':[n.text() for n in nodes if 'source-fallback'in n.attrs.get('class','').split()],'duplicateIds':sorted({i for i in ids if ids.count(i)>1}),'unsafeElements':[n.tag for n in nodes if n.tag in ['script','iframe','object','embed','base','form','link','foreignobject']],'eventAttributes':[{'tag':n.tag,'attribute':k} for n in nodes for k in n.attrs if k.startswith('on')],'csp':[n.attrs.get('content') for n in nodes if n.tag=='meta'and n.attrs.get('http-equiv','').lower()=='content-security-policy'],'visualReview':'NOT_RUN: structure only; actual HTML browser pixels not reviewed','network':'No browser/network requests made by this parser; no browser-load behavior claimed'}
def ancestors(node):
 while node.parent:node=node.parent;yield node
if __name__=='__main__':
 arg=argparse.ArgumentParser();arg.add_argument('run');arg.add_argument('--diagnostic',action='store_true');a=arg.parse_args();run=Path(a.run);control=run.parent/'control'/(run.name+'-p6-command.json');command=json.loads(control.read_text());completion=run/'completion.json';completed=command.get('exitCode')==0 and completion.exists() and json.loads(completion.read_text()).get('automatedChecksPassed') is True
 if not completed and not a.diagnostic:raise SystemExit('Run not completed with exit0; refusing acceptance audit')
 plan=json.loads((run/'plan.json').read_text());report={'run':str(run),'control':str(control),'controlExit':command.get('exitCode'),'completionExists':completion.exists(),'scope':'DIAGNOSTIC_FAILED_HARNESS_NOT_ACCEPTANCE' if not completed else 'COMPLETED_RUN_STATIC_CONTENT_REVIEW_VISUAL_PENDING','producerBinarySHA256':plan['binarySha256'],'planFixtureSHA256':plan['fixture']['sourceSHA256'],'sourceSHA256Now':digest(run/'source.md'),'artifacts':[audit(f,dict(plan['fixture'],bodyMarkersExactlyOnce=[m.replace('P5-','P6R2-') for m in plan['fixture']['bodyMarkersExactlyOnce']],forbiddenRevisionMarkers=['P5-']) if f.name.startswith('edited-r2') else plan['fixture'],run) for f in sorted(run.glob('*.html'))]}
 if (run/'observations.json').exists():
  report['sourceObservations']=[{'name':o['name'],'version':o.get('document',{}).get('version'),'sourceSHA256':o.get('sourceSha256'),'statuses':o.get('statuses'),'artifact':o.get('artifact')} for o in json.loads((run/'observations.json').read_text()) if o.get('document',{}).get('path','').endswith('/source.md')]
 if (run/'expected-r2.md').exists():report['expectedR2SHA256']=digest(run/'expected-r2.md')
 if (run/'failure.json').exists():report['failure']=json.loads((run/'failure.json').read_text())['error']
 out=Path(__file__).parent/(run.name+'.html-review.json');out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(out)

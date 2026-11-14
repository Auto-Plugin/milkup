import json,re,sys,hashlib,base64,io
from pathlib import Path
from html.parser import HTMLParser
from PIL import Image,ImageChops
out=Path(sys.argv[1]);data=json.loads(out.read_text())
class Check(HTMLParser):
 def __init__(self): super().__init__(); self.stack=[]; self.errors=[]; self.starts={};self.images=[]
 def handle_starttag(self,tag,attrs):
  self.starts[tag]=self.starts.get(tag,0)+1
  if tag=='img':self.images.append(dict(attrs))
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}: self.stack.append(tag)
 def handle_endtag(self,tag):
  if not self.stack or self.stack[-1]!=tag:self.errors.append({'end':tag,'stack':self.stack.copy()})
  elif self.stack:self.stack.pop()
p=Check();p.feed(Path(data['input']).read_text())
directives=dict((part.strip().split(' ',1)+[''])[:2] for part in data['dom']['csp'].split(';') if part.strip())
required={'default-src':"'none'",'img-src':'data:','style-src':"'unsafe-inline'",'script-src':"'none'",'base-uri':"'none'",'form-action':"'none'",'connect-src':"'none'",'font-src':"'none'",'object-src':"'none'"}
data['rawStructureReview']={'unclosedTags':p.stack,'mismatchedEndTags':p.errors,'htmlHeadBodyCounts':{k:p.starts.get(k,0) for k in ['html','head','body']}}
data['cspReview']={'directives':directives,'matchesFixedPolicy':directives==required,'sourceStylesContainExternalUrl':bool(re.search(r'url\(\s*["\']?(?:https?:|//)',data['dom']['styles']['printRuleText'],re.I))}
data['conclusions']['structuralAndSafetyChecksPassed'] &= not p.stack and not p.errors and directives==required
if len(sys.argv)>2:
 fixture=Path(sys.argv[2]);fixture_bytes=fixture.read_bytes(); embedded=base64.b64decode(p.images[0]['src'].split(',',1)[1]);bounds=data['dom']['images'][0]['bounds']
 shot=Image.open(data['screenshot']).convert('RGB');expected=Image.open(io.BytesIO(embedded)).convert('RGB')
 x,y,w,h=[round(bounds[k]) for k in ['x','y','width','height']];crop=shot.crop((x,y,x+w,y+h));pixel_match=crop.size==expected.size and ImageChops.difference(crop,expected).getbbox() is None
 crop_path=out.with_name(out.stem+'-embedded-image-crop.png');crop.save(crop_path)
 data['embeddedImageReview']={'fixture':str(fixture),'fixtureSHA256':hashlib.sha256(fixture_bytes).hexdigest(),'embeddedSHA256':hashlib.sha256(embedded).hexdigest(),'embeddedBytesExactlyMatchFixture':embedded==fixture_bytes,'decodedSize':expected.size,'screenshotBounds':bounds,'screenshotCrop':str(crop_path),'screenshotCropPixelsExactlyMatchDecodedFixture':pixel_match,'pixelColors':crop.getcolors(256)}
out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'structure':data['rawStructureReview'],'embeddedImageReview':data.get('embeddedImageReview')},ensure_ascii=False))

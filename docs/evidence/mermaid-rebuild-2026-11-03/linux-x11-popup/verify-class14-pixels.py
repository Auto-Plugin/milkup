from pathlib import Path
from PIL import Image
import hashlib,json
root=Path('/workspace/mermaid-rebuild-evidence/linux-x11-popup')
old=Path('/workspace/mermaid-rebuild-evidence/native-corpus-688fc89a/14-classDiagram.png')
new=root/'native-corpus-ee305c4c-02/corpus/png/14-classDiagram.png'
a=Image.open(old).convert('RGBA');b=Image.open(new).convert('RGBA');assert a.size==b.size==(170,192)
changes=[];alpha=0;maximum=0
for y in range(a.height):
 for x in range(a.width):
  p,q=a.getpixel((x,y)),b.getpixel((x,y))
  if p!=q:changes.append((x,y))
  if p[3]!=q[3]:alpha+=1
  maximum=max(maximum,max(abs(v-w) for v,w in zip(p,q)))
regions=[]
for label,box in [('title',(30,35,140,60)),('attribute',(30,82,140,106)),('method',(30,125,140,160))]:
 x0,y0,x1,y1=box;changed=0;old_dark=[];new_dark=[]
 for y in range(y0,y1):
  for x in range(x0,x1):
   p,q=a.getpixel((x,y)),b.getpixel((x,y));changed+=p!=q
   if max(p[:3])<100 and p[3]>0:old_dark.append((x,y))
   if max(q[:3])<100 and q[3]>0:new_dark.append((x,y))
 regions.append({'label':label,'boxExclusive':box,'differentPixels':changed,'oldDarkPixels':len(old_dark),'newDarkPixels':len(new_dark),'darkPixelCoordinatesEqual':old_dark==new_dark})
report={'kind':'read-only-independent-class14-pixel-verification','old':{'path':str(old),'sha256':hashlib.sha256(old.read_bytes()).hexdigest()},'new':{'path':str(new),'sha256':hashlib.sha256(new.read_bytes()).hexdigest()},'size':a.size,'differentPixels':len(changes),'changedBoxExclusive':[min(x for x,y in changes),min(y for x,y in changes),max(x for x,y in changes)+1,max(y for x,y in changes)+1],'maximumChannelDifference':maximum,'alphaDifferentPixels':alpha,'textInteriorRegions':regions,'correction':'The earlier visual interpretation that +save() was missing was incorrect. The method interior is pixel-identical, with the same nonzero dark glyph pixels. Differences are small non-text-interior pixel variations; no definite causal attribution.'}
(root/'class14-independent-pixel-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

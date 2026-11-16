"""Read-only independent audit of the ten actual Type3 Noto glyph mappings.
No PDF rewrite; protected unrelated fonts/complex text are not generalized.
"""
import argparse,json,pathlib,re
from pypdf import PdfReader
def mappings(path):
 rows=[]
 for name,ref in PdfReader(path).pages[0]['/Resources']['/Font'].items():
  font=ref.get_object();encoding=font.get('/Encoding')
  if not hasattr(encoding,'get')or '/ToUnicode'not in font:continue
  code=None;glyphs={}
  for item in encoding.get('/Differences',[]):
   if isinstance(item,int):code=item
   else:
    assert code is not None
    if re.fullmatch('/g[0-9a-fA-F]+',str(item)):glyphs[code]=int(str(item)[2:],16)
    code+=1
  if not any(63153<=g<=63162 for g in glyphs.values()):continue
  raw=font['/ToUnicode'].get_data().decode('ascii');assert len(raw)<1024*1024
  cmap={}
  for block in re.findall(r'beginbfchar\s*(.*?)\s*endbfchar',raw,re.S):
   for a,b in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>',block):
    key=int(a,16);assert key not in cmap;cmap[key]=int(b,16)
  for block in re.findall(r'beginbfrange\s*(.*?)\s*endbfrange',raw,re.S):
   assert '['not in block,'Array destination requires a separately reviewed parser'
   for a,b,c in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>',block):
    low,high,start=int(a,16),int(b,16),int(c,16);assert 0<=high-low<=255
    for key in range(low,high+1):assert key not in cmap;cmap[key]=start+key-low
  for key,glyph in glyphs.items():
   if 63153<=glyph<=63162:
    assert key in cmap;rows.append({'font':str(name),'pdfCode':key,'glyph':glyph,'unicode':cmap[key]})
 assert len(rows)==10 and {r['glyph']for r in rows}==set(range(63153,63163)),'All ten exact substituted glyphs required'
 return sorted(rows,key=lambda r:r['glyph'])
def audit(root):
 rows={name:mappings(root/(name+'.pdf'))for name in ['digit-baseline','digit-candidate']}
 assert all(r['unicode']==0 for r in rows['digit-baseline'])
 assert [r['unicode']for r in rows['digit-candidate']]==list(range(48,58))
 return {'status':'passed-ten-Noto-mappings-only','rows':rows,'scope':'Same-run raw Type3 encoding plus ToUnicode, not general text or clipboard acceptance'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);a=p.parse_args();r=audit(a.root);a.output.write_text(json.dumps(r,indent=2)+'\n');print(r['status'])

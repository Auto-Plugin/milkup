#!/usr/bin/env python3
"""Bind the corrected HTML to actual font/language/shaping before native work."""
import argparse, hashlib, json, pathlib, tempfile
from html.parser import HTMLParser
from digit_pdf_contract import fixtures
from test_digit_probe import shape

FONT = pathlib.Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
FONT_SHA = 'b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a'

class Text(HTMLParser):
    def __init__(self): super().__init__(); self.language=None; self.paragraph=False; self.paragraphs=[]
    def handle_starttag(self, tag, attrs):
        if tag=='html': self.language=dict(attrs).get('lang')
        if tag=='p': self.paragraph=True; self.paragraphs.append('')
    def handle_endtag(self, tag):
        if tag=='p': self.paragraph=False
    def handle_data(self, value):
        if self.paragraph: self.paragraphs[-1]+=value

def check():
    assert hashlib.sha256(FONT.read_bytes()).hexdigest()==FONT_SHA
    with tempfile.TemporaryDirectory() as d:
        root=pathlib.Path(d); identity=fixtures(root)
        html=(root/'digit-baseline.html').read_text(); parser=Text(); parser.feed(html)
        assert parser.language=='en' and html==(root/'digit-candidate.html').read_text()
        token='WRAP0123456789'; assert parser.paragraphs.count(token)==1
        version,direction,glyphs=shape(FONT,2,token,parser.language)
        assert direction==4 and [g['utf16Cluster'] for g in glyphs]==list(range(len(token)))
        assert [g['glyph'] for g in glyphs[:4]]==[56,51,34,49]
        assert [g['glyph'] for g in glyphs[4:]]==list(range(63153,63163))
        assert ''.join(token[g['utf16Cluster']] for g in glyphs)==token
        _,plain_direction,plain=shape(FONT,2,'0123456789',parser.language)
        assert plain_direction==4 and [g['glyph'] for g in plain]==list(range(17,27))
    return {'status':'passed-local-HarfBuzz-not-native-PDF','fixture':identity,'fontSha256':FONT_SHA,'face':2,'language':'en','harfbuzz':version,'source':token,'glyphs':glyphs,'plainDigitControl':plain,'contract':'Ten distinct substituted glyphs; complete ordered one-scalar clusters; pure digits retain nominal glyphs and are an unsuitable defect baseline'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output',type=pathlib.Path);a=p.parse_args();r=check();a.output.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))

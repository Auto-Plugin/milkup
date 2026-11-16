"""Attach only non-style IDs and an opt-in document title to retained fixtures."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


class Semantics(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.tokens = []; self.in_title = False
    def handle_starttag(self, tag, attrs):
        self.in_title = tag == 'title' or self.in_title
        self.tokens.append(('start',tag,[(k,v) for k,v in attrs if k != 'id']))
    def handle_endtag(self, tag):
        self.tokens.append(('end',tag))
        if tag == 'title': self.in_title = False
    def handle_data(self, data):
        if not self.in_title: self.tokens.append(('data',data))


def annotate(text):
    changes = [
        ('<title>Document</title>', '<title>MILKUP_PAGINATION_LAYOUT_V1</title>'),
        ('<div class="heading-lead"><h2>TABLESECTION</h2>', '<div class="heading-lead" id="mkp-wrapper"><h2 id="mkp-heading">TABLESECTION</h2>'),
        ('<table>', '<table id="mkp-table">'),
        ('<thead><tr>', '<thead id="mkp-header"><tr id="mkp-header-row">'),
        ('<tbody><tr>', '<tbody><tr id="mkp-first-row">')]
    assert 'mkp-' not in text and ' id=' not in text, 'unexpected fixture IDs'
    original = text
    for a,b in changes:
        assert text.count(a) == 1, ('fixture structure',a)
        text = text.replace(a,b)
    a=Semantics(); a.feed(original); b=Semantics(); b.feed(text)
    assert a.tokens == b.tokens, 'visible content/style/structure changed'
    return text


def generate(out):
    out.mkdir(parents=True,exist_ok=False)
    receipt=json.loads((HERE/'fixtures/source-receipt.json').read_text()); results={}
    for name, item in receipt.items():
        raw=(HERE/'fixtures'/(name+'.html')).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item['originalHtmlSha256']
        annotated=annotate(raw.decode()).encode()
        (out/(name+'.html')).write_bytes(annotated)
        results[name]={**item,'annotatedHtmlSha256':hashlib.sha256(annotated).hexdigest(),
                       'scope':'IDs/title only; layout equivalence still requires native coordinate comparison'}
    (out/'manifest.json').write_text(json.dumps(results,indent=2)+'\n')
    return results


if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('out',type=Path);a=p.parse_args();generate(a.out)

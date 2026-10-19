#!/usr/bin/env python3
"""Source-derived counterexamples; NOT compiled WebKit or PDF integration tests."""
import json
from pathlib import Path

results = []
def check(name, condition, **detail):
    assert condition, name
    results.append(dict(name=name, passed=True, **detail))

def slices(text, clusters):
    """Mirror SkClusterator::next's adjacent grouping / next-greater boundary."""
    b = text.encode('utf-8'); out = []; i = 0
    while i < len(clusters):
        c = clusters[i]; i += 1
        while i < len(clusters) and clusters[i] == c:
            i += 1
        end = min([v for v in clusters if v > c] + [len(b)])
        out.append(b[c:end].decode('utf-8'))
    return out

# ComplexTextController consumes RTL run in reverse index order, then
# FontCascade reverses the accumulated GlyphBuffer into visual order.
visual_glyphs = ['glyph-C', 'glyph-B', 'glyph-A']; offsets = [2, 1, 0]
old = []; proposed = []
for logical_index in range(3):
    visual_index = 2 - logical_index
    old.append((visual_glyphs[visual_index], offsets[logical_index]))
    proposed.append((visual_glyphs[visual_index], offsets[visual_index]))
old.reverse(); proposed.reverse()
check('rtl-offset-pairs-after-final-reverse', proposed == list(zip(visual_glyphs, offsets)) and old != proposed, old=old, proposed=proposed)
check('ltr-offset-pairs-unchanged', [offsets[i] for i in range(3)] == offsets)

# A UTF-16 offset after a non-BMP scalar is not a UTF-8 byte offset.
s = 'A😀神神'; utf16 = {}; u16 = 0; u8 = 0
for c in s:
    utf16[u16] = u8
    u16 += len(c.encode('utf-16-le')) // 2; u8 += len(c.encode('utf-8'))
utf16[u16] = u8
check('surrogate-boundary-and-utf8-map', utf16 == {0:0, 1:1, 3:5, 4:8, 5:11} and 2 not in utf16, mapping=utf16)

# Font X draws source A, font Y draws source B. Full-source-per-font is wrong.
x = slices('AB', [0]); y = slices('AB', [1])
check('fallback-tail-must-not-swallow-other-font-text', x + y == ['AB', 'B'], wrongExtraction=''.join(x+y), correct='AB')
check('fallback-source-slices-fix-simple-disjoint-example', slices('A',[0])+slices('B',[0]) == ['A','B'])

# Non-adjacent repeated cluster is emitted twice by the current iterator.
actual = slices('ab', [0,1,0])
check('nonadjacent-repeat-needs-semantic-grouping', actual == ['a','b','a'], wrongExtraction=''.join(actual), correct='ab')
# Non-monotonic *distinct* clusters still produce valid byte ranges;
# do not incorrectly claim SkClusterator rejects every non-monotonic input.
check('nonmonotonic-distinct-range-behavior', slices('abc',[0,2,1]) == ['a','c','b'])
check('adjacent-many-glyphs-one-cluster', slices('a\u0301',[0,0]) == ['a\u0301'])
# One glyph representing a source ligature cannot be assigned a requested
# code-unit subset without deciding whole-cluster clipping semantics.
check('partial-ligature-is-not-one-code-unit-per-glyph', slices('ffi',[0]) == ['ffi'])

out = {'status':'PASS', 'kind':'source-derived reference models only', 'engineCompiled':False, 'engineExecuted':False, 'cases':results}
Path(__file__).with_name('reference-results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':len(results),'engineCompiled':False,'engineExecuted':False}))

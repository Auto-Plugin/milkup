#!/usr/bin/env python3
"""Generate an observation-only patch for exact unpatched Ubuntu 2.52.6 sources."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def once(text, old, new):
    assert text.count(old) == 1, ('unique anchor', old[:100])
    return text.replace(old, new)


def function(text, signature, edit):
    start = text.index(signature)
    end = text.index('\n}', start) + 2
    return text[:start] + edit(text[start:end]) + text[end:]


def wrap(body, name, value='0', actor='child', result=True):
    body = once(body, '\n{', '\n{\n    MilkupPaginationResearch::Scope mkp(' + actor + ', "' + name + '", ' + value + ');')
    if result:
        body = re.sub(r'(?m)^(\s*)return ([^;\n]+);', r'\1return mkp.result(\2);', body)
    return body


def prepare(source, out):
    locked = json.loads((HERE / 'source-lock.json').read_text())
    originals = {}
    for rel, expected in locked.items():
        data = (source / 'Source/WebCore' / rel).read_bytes()
        assert sha(data) == expected, ('source hash mismatch', rel)
        originals[rel] = data.decode()
    modified = dict(originals)
    flow = modified['rendering/RenderBlockFlow.cpp']
    for method, label in [('applyBeforeBreak', 'before-break'), ('applyAfterBreak', 'after-break')]:
        signature = 'LayoutUnit RenderBlockFlow::' + method + '('
        def edit(body, label=label):
            body = wrap(body, label, 'logicalOffset.toDouble()')
            anchor = '    bool checkFragmentBreaks = false;'
            return once(body, anchor, anchor + '\n    mkp.point("page-height", pageLogicalHeightForOffset(logicalOffset).toDouble());\n    mkp.point("remaining-height", pageRemainingLogicalHeightForOffset(logicalOffset, ExcludePageBoundary).toDouble());')
        flow = function(flow, signature, edit)

    def adjustment(body):
        body = wrap(body, 'adjust', 'logicalTopAfterClear.toDouble()')
        body = once(body, '        child.layoutIfNeeded();', '        mkp.point("child-relayout-enter");\n        child.layoutIfNeeded();\n        mkp.point("child-relayout-exit");')
        body = once(body, '    if (paginationStrut) {', '    mkp.point("selected-strut", paginationStrut.toDouble());\n    if (paginationStrut) {')
        body = once(body, '            setPaginationStrut(result + paginationStrut);', '            mkp.point("strut-propagate", (result + paginationStrut).toDouble());\n            setPaginationStrut(result + paginationStrut);')
        body = once(body, '        } else\n            result += paginationStrut;', '        } else {\n            mkp.point("strut-consume", paginationStrut.toDouble());\n            result += paginationStrut;\n        }')
        return body
    flow = function(flow, 'LayoutUnit RenderBlockFlow::adjustBlockChildForPagination(', adjustment)
    modified['rendering/RenderBlockFlow.cpp'] = flow

    def setter(body):
        body = once(body, '\n{', '\n{\n    MilkupPaginationResearch::record("strut-write", *this, strut.toDouble(), MilkupPaginationResearch::activeCall);')
        return once(body, '    rareData->m_paginationStrut = strut;', '    rareData->m_paginationStrut = strut;\n    MilkupPaginationResearch::record("strut-written", *this, strut.toDouble(), MilkupPaginationResearch::activeCall);')
    modified['rendering/RenderBlock.cpp'] = function(modified['rendering/RenderBlock.cpp'], 'void RenderBlock::setPaginationStrut(', setter)

    def table(body):
        body = wrap(body, 'table-layout', actor='*this', result=False)
        anchor = '            markForPaginationRelayoutIfNeeded();\n            layoutIfNeeded();'
        return once(body, anchor, '            mkp.point("table-recursive-relayout", m_recursiveSectionMovedWithPaginationLevel);\n' + anchor + '\n            mkp.point("table-recursive-return");')
    modified['rendering/RenderTable.cpp'] = function(modified['rendering/RenderTable.cpp'], 'void RenderTable::layout()', table)

    # Final state is captured only after printing layout and actual page CTM/clip,
    # before paint. No screen DOM/beforeprint or PDF annotation oracle is used.
    modified['page/PrintContext.cpp'] = once(modified['page/PrintContext.cpp'],
        '    ctx.clip(pageRect);\n    frame.view()->paintContents(ctx, pageRect);',
        '    ctx.clip(pageRect);\n    MilkupPaginationResearch::finalPage(*frame.document(), ctx, pageRect, pageNumber, !frame.view()->needsLayout());\n    frame.view()->paintContents(ctx, pageRect);')
    patch = ''
    receipt = {'source': locked, 'scope': 'Observation-only generated patch; no actual TU/native acceptance', 'modified': {}}
    for rel in modified:
        if rel.endswith('.h'):
            continue
        include = '../rendering/MilkupPaginationResearch.h' if rel.startswith('page/') else 'MilkupPaginationResearch.h'
        modified[rel] = once(modified[rel], '#include "config.h"', '#include "config.h"\n#include "' + include + '"')
        path = 'Source/WebCore/' + rel
        patch += ''.join(difflib.unified_diff(originals[rel].splitlines(True), modified[rel].splitlines(True), fromfile='a/' + path, tofile='b/' + path))
        receipt['modified'][rel] = sha(modified[rel].encode())
    header = (HERE / 'probe.h.inc').read_text()
    patch += ''.join(difflib.unified_diff([], header.splitlines(True), fromfile='/dev/null', tofile='b/Source/WebCore/rendering/MilkupPaginationResearch.h'))
    out.write_text(patch)
    receipt['headerSha256'] = sha(header.encode())
    receipt['patchSha256'] = sha(patch.encode())
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('patch', type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.patch), indent=2))

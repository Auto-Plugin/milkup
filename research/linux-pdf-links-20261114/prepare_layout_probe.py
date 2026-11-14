#!/usr/bin/env python3
"""Prepare a separate research-only native layout probe patch; no source mutation."""
import argparse, difflib, hashlib, json, pathlib

def prepare(source, output):
    relative = 'Source/WebCore/page/PrintContext.cpp'
    original = (source / relative).read_text()
    assert hashlib.sha256(original.encode()).hexdigest() == '938541c51de207aa15b45133d341c40cba36f4a912e1be48c38bca9418eb0d3e', 'Exact matched PrintContext source required'
    # Anchor the probe AFTER printing layout and page CTM/clip, BEFORE painting.
    anchor = '    ctx.clip(pageRect);\n    frame.view()->paintContents(ctx, pageRect);'
    assert original.count(anchor) == 1
    body = pathlib.Path(__file__).with_name('print-layout-probe.inc').read_text()
    changed = original.replace('#include "RenderView.h"', '#include "RenderView.h"\n#include "RenderBox.h"\n#include "RenderObjectInlines.h"\n#include "ElementInlines.h"\n#include <wtf/text/CString.h>\n#include "HTMLNames.h"\n#include <cstdio>\n#include <cstdlib>\n#include <string>')
    changed = changed.replace('void PrintContext::spoolPage(', body + '\nvoid PrintContext::spoolPage(')
    changed = changed.replace(anchor, '    ctx.clip(pageRect);\n    milkupPrintLayoutProbe(*frame.document(), ctx, pageRect, pageNumber, !frame.view()->needsLayout());\n    frame.view()->paintContents(ctx, pageRect);')
    patch = ''.join(difflib.unified_diff(original.splitlines(True), changed.splitlines(True), fromfile='a/'+relative, tofile='b/'+relative))
    inline_source = (source/'Source/WebCore/rendering/RenderObjectInlines.h').read_text()
    assert 'inline FloatQuad RenderObject::localToAbsoluteQuad(' in inline_source, 'Inline API definition missing'
    assert '#include "RenderObjectInlines.h"' in changed, 'Probe requires the actual inline definition header'
    output.write_text(patch)
    return {'source': relative, 'sha256': hashlib.sha256(original.encode()).hexdigest(), 'patchSha256': hashlib.sha256(patch.encode()).hexdigest(), 'scope': 'generated patch only; not compiled or runtime accepted'}

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);a=p.parse_args()
    print(json.dumps(prepare(a.source,a.output),indent=2))

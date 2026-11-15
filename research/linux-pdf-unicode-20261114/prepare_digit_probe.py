#!/usr/bin/env python3
"""Generate a research delta after 0002; leave the original nominal-only patch intact."""
import argparse, difflib, hashlib, json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
HEADER = 'Source/WebCore/platform/graphics/ScalarGlyphText.h'
CASCADE = 'Source/WebCore/platform/graphics/FontCascade.cpp'

def prepare(source, output):
    originals = {p: (source / p).read_text() for p in [HEADER, CASCADE]}
    assert originals[HEADER] == (HERE / 'ScalarGlyphText.h').read_text()
    new = {}
    call = 'sourceText = makeScalarGlyphText(source, offsets, glyphs, nominal);'
    cascade = originals[CASCADE]
    assert hashlib.sha256(cascade.encode()).hexdigest() == '02d21a897d20141acea1efe446ba73b766e844131c36445da249daeabc2d6217'
    assert cascade.count(call) == 1
    # These protections are prerequisites, not optional hints from a fixture.
    for guard in ['sourceRun->ltr()', 'sourceTo <= sourceRun->length()',
                  'checkedStringOffsetAt(i, sourceRun->length())',
                  'font.platformData().orientation() != FontOrientation::Horizontal']:
        assert guard in cascade
    marker = '// This function assumes the GlyphBuffer\'s initial advance has already been incorporated into the start point.'
    assert cascade.count(marker) == 1
    helper = (HERE / 'independent-digit-text.inc').read_text()
    trace = (HERE / 'digit-trace.inc').read_text()
    new[CASCADE] = cascade.replace('#include "config.h"', '#include "config.h"\n#include <cstdio>\n#include <cstdlib>')
    new[CASCADE] = new[CASCADE].replace(marker, '#if USE(SKIA)\n' + helper + trace + '#endif\n\n' + marker)
    new[CASCADE] = new[CASCADE].replace('        if (complete)\n            ' + call, '''        if (complete) {
            // Never infer a cluster end from a partial draw/selection span:
            // a clipped digit ligature could masquerade as a single scalar.
            sourceText = std::getenv("MILKUP_DIGIT_NOMINAL_ONLY") || sourceFrom || sourceTo != sourceRun->length()
                ? makeScalarGlyphText(source, offsets, glyphs, nominal)
                : makeIndependentAsciiDigitText(source, offsets, glyphs, nominal);
            milkupDigitTrace(source, offsets, glyphs, nominal, sourceText.has_value());
        }''')
    patch = ''.join(''.join(difflib.unified_diff(originals[p].splitlines(True), new[p].splitlines(True),
                                              fromfile='a/' + p, tofile='b/' + p)) for p in new)
    output.write_text(patch)
    return {'status': 'research-patch-prepared-not-native-validated',
            'inputs': {p: hashlib.sha256(v.encode()).hexdigest() for p, v in originals.items()},
            'patchSha256': hashlib.sha256(patch.encode()).hexdigest(), 'files': list(new)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path); args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.output), indent=2))

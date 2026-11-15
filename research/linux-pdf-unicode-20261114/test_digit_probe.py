#!/usr/bin/env python3
"""Actual HarfBuzz clusters + compiled exact metadata helper; not a WebKit/PDF test."""
import argparse, ctypes as C, ctypes.util, hashlib, json, pathlib, subprocess, tempfile
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString


HERE = pathlib.Path(__file__).resolve().parent
class Info(C.Structure):
    _fields_ = [('codepoint', C.c_uint32), ('mask', C.c_uint32), ('cluster', C.c_uint32), ('var1', C.c_uint32), ('var2', C.c_uint32)]

def shape(path, index, text, language):
    hb = C.CDLL(ctypes.util.find_library('harfbuzz'))
    def api(name, args, ret):
        f = getattr(hb, name); f.argtypes = args; f.restype = ret; return f
    ptr = C.c_void_p; uint = C.c_uint
    version = api('hb_version_string', [], C.c_char_p)().decode()
    blob = api('hb_blob_create_from_file_or_fail', [C.c_char_p], ptr)(str(path).encode()); assert blob
    face = api('hb_face_create', [ptr, uint], ptr)(blob, index)
    font = api('hb_font_create', [ptr], ptr)(face)
    api('hb_ot_font_set_funcs', [ptr], None)(font)
    buf = api('hb_buffer_create', [], ptr)()
    raw = text.encode('utf-16-le'); units = (C.c_uint16 * (len(raw) // 2)).from_buffer_copy(raw)
    api('hb_buffer_add_utf16', [ptr, C.POINTER(C.c_uint16), C.c_int, uint, C.c_int], None)(buf, units, len(units), 0, len(units))
    lang = api('hb_language_from_string', [C.c_char_p, C.c_int], ptr)(language.encode(), -1)
    api('hb_buffer_set_language', [ptr, ptr], None)(buf, lang)
    api('hb_buffer_guess_segment_properties', [ptr], None)(buf)
    api('hb_shape', [ptr, ptr, ptr, uint], None)(font, buf, None, 0)
    count = uint(); infos = api('hb_buffer_get_glyph_infos', [ptr, C.POINTER(uint)], C.POINTER(Info))(buf, C.byref(count))
    direction = api('hb_buffer_get_direction', [ptr], C.c_int)(buf)
    glyphs = [{'glyph': infos[i].codepoint, 'utf16Cluster': infos[i].cluster} for i in range(count.value)]
    for kind, obj in [('buffer', buf), ('font', font), ('face', face), ('blob', blob)]:
        api('hb_' + kind + '_destroy', [ptr], None)(obj)
    return version, direction, glyphs

def collision_font(path):
    names = ['.notdef', 'one', 'two', 'shared', 'f', 'i', 'fi', 'a', 'acute', 'aacute']
    fb = FontBuilder(1000, isTTF=True); fb.setupGlyphOrder(names)
    fb.setupCharacterMap({49: 'one', 50: 'two', 102: 'f', 105: 'i', 97: 'a', 0x301: 'acute'})
    outlines = {}
    for name in names:
        pen = TTGlyphPen(None); pen.moveTo((50, 0)); pen.lineTo((450, 0)); pen.lineTo((450, 700)); pen.lineTo((50, 700)); pen.closePath()
        outlines[name] = pen.glyph()
    fb.setupGlyf(outlines); fb.setupHorizontalMetrics({n: (500, 0) for n in names})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': 'MilkupDigitCollisionResearch', 'styleName': 'Regular', 'uniqueFontIdentifier': 'MilkupDigitCollisionResearch1', 'fullName': 'MilkupDigitCollisionResearch', 'psName': 'MilkupDigitCollisionResearch'})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost(); fb.setupMaxp()
    addOpenTypeFeaturesFromString(fb.font, '''languagesystem DFLT dflt;
languagesystem latn dflt;
feature locl { sub one by shared; sub two by shared; } locl;
feature liga { sub f i by fi; } liga;
feature ccmp { sub a acute by aacute; } ccmp;
''')
    # Stable font fixture identity rather than wall-clock-dependent bytes.
    fb.font['head'].created = fb.font['head'].modified = 2082844800
    fb.font.recalcTimestamp = False; fb.save(path)

def run(output):
    output.mkdir(parents=True, exist_ok=False)
    collision = output / 'collision.ttf'; collision_font(collision)
    noto = pathlib.Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
    dejavu = pathlib.Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    devanagari = pathlib.Path('/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf')
    arabic = pathlib.Path('/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf')
    specs = [
        ('noto-en-digits', noto, 2, 'WRAP0123456789', 'en', False, True),
        ('noto-zh-digits', noto, 2, 'WRAP0123456789', 'zh-cn', True, True),
        ('source-radical-collision', noto, 2, '文⽂风⻛又⼜月⽉', 'zh-cn', True, True),
        ('same-uncoded-glyph-different-digits', collision, 0, '1212', 'en', False, True),
        ('ligature', collision, 0, 'fi', 'en', False, False),
        ('combined-composition', collision, 0, 'a\u0301', 'en', False, False),
        ('combining-mark', dejavu, 0, 'x\u0301', 'en', False, False),
        ('arabic-rtl', arabic, 0, 'سلام', 'ar', False, False),
        ('indic-reordering', devanagari, 0, 'कि', 'hi', False, False),
    ]
    rows = []; code = ['#include "ScalarGlyphText.h"', '#include <cassert>', 'using namespace WebCore;', (HERE / 'independent-digit-text.inc').read_text(), 'int main() {']
    vec = lambda xs: ','.join(str(x) for x in xs)
    for name, path, face, text, lang, old_ok, new_ok in specs:
        version, direction, glyphs = shape(path, face, text, lang)
        font = TTFont(path, fontNumber=face); cmap = font.getBestCmap()
        raw = text.encode('utf-16-le'); units = [int.from_bytes(raw[i:i+2], 'little') for i in range(0, len(raw), 2)]
        nominal = [font.getGlyphID(cmap[units[g['utf16Cluster']]]) if units[g['utf16Cluster']] in cmap else 0 for g in glyphs]
        rows.append({'name': name, 'fontSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'fontPath': str(path), 'face': face, 'text': text, 'language': lang, 'hbVersion': version, 'direction': direction, 'glyphs': glyphs, 'nominal': nominal, 'oldAccept': old_ok, 'candidateAccept': new_ok})
        code += ['{', f'std::u16string text {{{vec(units)}}};', f'std::vector<uint32_t> offsets {{{vec(g["utf16Cluster"] for g in glyphs)}}}, glyphs {{{vec(g["glyph"] for g in glyphs)}}}, nominal {{{vec(nominal)}}};',
                 f'auto old = {str(direction == 4).lower()} ? makeScalarGlyphText(text, offsets, glyphs, nominal) : std::nullopt;',
                 f'auto candidate = {str(direction == 4).lower()} ? makeIndependentAsciiDigitText(text, offsets, glyphs, nominal) : std::nullopt;',
                 f'assert(old.has_value() == {str(old_ok).lower()}); assert(candidate.has_value() == {str(new_ok).lower()});']
        if new_ok:
            data = text.encode(); code += [f'assert(candidate->utf8 == std::string({json.dumps("".join(chr(c) for c in data))}, {len(data)}));'] if data.isascii() else []
            code += ['std::string joined; for (size_t i=0; i<glyphs.size(); ++i) joined += candidate->slice(i,1)->utf8; assert(joined == candidate->utf8);']
        code += ['}']
    # Mutations that superficially look like a digit run must remain fail-closed.
    code += ['''{
      const std::u16string source = u"12";
      const std::vector<uint32_t> nominal {1,2}, good {3,3};
      for (auto offsets : {std::vector<uint32_t>{0}, {0,0}, {1,0}, {0,2}, {1,2}, {0,1,1}})
        assert(!makeIndependentAsciiDigitText(source, offsets, good, nominal));
      for (auto bad : {std::vector<uint32_t>{0,3}, {65535,3}, {65536,3}})
        assert(!makeIndependentAsciiDigitText(source, {std::vector<uint32_t>{0,1}}, bad, nominal));
      assert(!makeIndependentAsciiDigitText(source, {std::vector<uint32_t>{0,1}}, good, {std::vector<uint32_t>{0,2}}));
      assert(!makeIndependentAsciiDigitText(u"ab", {std::vector<uint32_t>{0,1}}, good, nominal));
      assert(!makeIndependentAsciiDigitText(u"١٢", {std::vector<uint32_t>{0,1}}, good, nominal));
    }''', '}']
    header = (HERE / 'ScalarGlyphText.h').read_text()
    (output / 'ScalarGlyphText.h').write_text(header)
    cpp = output / 'actual-metadata.cpp'; cpp.write_text('\n'.join(code))
    subprocess.run(['c++', '-std=c++20', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(output / 'metadata')], check=True, timeout=30)
    subprocess.run([str(output / 'metadata')], check=True, timeout=5)
    # Run the existing full nominal-only contract against the candidate default.
    (output / 'old-contract.cpp').write_text((HERE / 'scalar-glyph-text-test.cpp').read_text())
    subprocess.run(['c++', '-std=c++20', '-Wall', '-Wextra', '-Werror', str(output / 'old-contract.cpp'), '-o', str(output / 'old-contract')], check=True, timeout=30)
    old_result = json.loads(subprocess.check_output([str(output / 'old-contract')], text=True, timeout=5))
    result = {'status': 'passed-local-metadata-only', 'samples': rows, 'oldContract': old_result, 'unchangedHeaderSha256': hashlib.sha256(header.encode()).hexdigest(), 'helperSha256': hashlib.sha256((HERE / 'independent-digit-text.inc').read_bytes()).hexdigest(), 'scope': 'Actual HarfBuzz plus compiled metadata contract. No actual WebKit TU, PDF backend or native engine acceptance.'}
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return result

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('output', type=pathlib.Path); a = p.parse_args()
    print(json.dumps(run(a.output), ensure_ascii=False, indent=2))

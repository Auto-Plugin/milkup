#!/usr/bin/env python3
"""Create a review-only patch against verified upstream snapshots, not system libraries."""
from pathlib import Path
import shutil, subprocess, sys, hashlib, json
base=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();here=Path(__file__).resolve().parent
paths=['Source/WebCore/platform/graphics/'+p for p in ['FontCascade.h','FontCascade.cpp','GraphicsContext.h','GraphicsContext.cpp','Font.h','skia/FontSkia.cpp','skia/GraphicsContextSkia.h','skia/GraphicsContextSkia.cpp','displaylists/DisplayListItems.h','displaylists/DisplayListItems.cpp','displaylists/DisplayListRecorderImpl.h','displaylists/DisplayListRecorderImpl.cpp']]
pinned=json.loads((here/'patch-source-manifest.json').read_text())
assert {p['path'] for p in pinned}==set(paths)
for entry in pinned:
 data=(base/entry['path']).read_bytes()
 assert len(data)==entry['bytes'] and hashlib.sha256(data).hexdigest()==entry['sha256'],entry['path']
assert not out.exists();out.mkdir(parents=True)
for path in paths:
 p=out/path;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(base/path,p)
subprocess.run(['git','init','-q',str(out)],check=True)
subprocess.run(['git','-C',str(out),'add','.'],check=True)
subprocess.run(['git','-C',str(out),'-c','user.name=LarryZhu-dev','-c','user.email=larryzhu@foxmail.com','commit','-qm','Verified upstream snapshot for review'],check=True)
def edit(path,old,new,count=1):
 p=out/'Source/WebCore/platform/graphics'/path;s=p.read_text();assert s.count(old)==count,(path,old[:100],s.count(old));p.write_text(s.replace(old,new))
header='ScalarGlyphText.h';target=out/'Source/WebCore/platform/graphics'/header;shutil.copyfile(here/header,target)
edit('FontCascade.h','CustomFontNotReadyAction) const;\n    void drawEmphasisMarks','CustomFontNotReadyAction, const TextRun* = nullptr, unsigned sourceFrom = 0, unsigned sourceTo = 0) const;\n    void drawEmphasisMarks')
edit('FontCascade.cpp','#include "GraphicsContext.h"','#include "GraphicsContext.h"\n#if USE(SKIA)\n#include "ScalarGlyphText.h"\n#include <skia/core/SkFont.h>\n#endif')
edit('FontCascade.cpp','drawGlyphBuffer(context, glyphBuffer, startPoint, customFontNotReadyAction);','drawGlyphBuffer(context, glyphBuffer, startPoint, customFontNotReadyAction, &run, from, destination);')
edit('FontCascade.cpp','drawGlyphBuffer(recordingContext, glyphBuffer, startPoint, customFontNotReadyAction);','drawGlyphBuffer(recordingContext, glyphBuffer, startPoint, customFontNotReadyAction, &run, from, destination);')
edit('FontCascade.cpp','void FontCascade::drawGlyphBuffer(GraphicsContext& context, const GlyphBuffer& glyphBuffer, FloatPoint& point, CustomFontNotReadyAction customFontNotReadyAction) const','void FontCascade::drawGlyphBuffer(GraphicsContext& context, const GlyphBuffer& glyphBuffer, FloatPoint& point, CustomFontNotReadyAction customFontNotReadyAction, const TextRun* sourceRun, unsigned sourceFrom, unsigned sourceTo) const')
edit('FontCascade.cpp','    ASSERT(glyphBuffer.isFlattened());\n    RefPtr fontData', '''    ASSERT(glyphBuffer.isFlattened());
    std::optional<ScalarGlyphText> sourceText;
#if USE(SKIA)
    // Research subset: prove complete scalar coverage before font splitting.
    // No cmap reversal, text normalization, changed glyphs or changed advances.
    if (sourceRun && sourceRun->ltr() && sourceFrom < sourceTo && sourceTo <= sourceRun->length()
        && sourceTo - sourceFrom <= ScalarGlyphText::maxBytes / 4 && glyphBuffer.size() <= ScalarGlyphText::maxBytes / 4) {
        std::u16string source;
        for (unsigned i = sourceFrom; i < sourceTo; ++i)
            source.push_back((*sourceRun)[i]);
        std::vector<uint32_t> offsets, glyphs, nominal;
        bool complete = true;
        for (size_t i = 0; i < glyphBuffer.size(); ++i) {
            auto offset = glyphBuffer.checkedStringOffsetAt(i, sourceRun->length());
            const auto& font = glyphBuffer.fontAt(i);
            if (!offset || *offset < sourceFrom || *offset >= sourceTo || font.platformData().orientation() != FontOrientation::Horizontal) {
                complete = false;
                break;
            }
            uint32_t scalar = (*sourceRun)[*offset];
            if (scalar >= 0xD800 && scalar <= 0xDBFF) {
                if (*offset + 1 >= sourceTo || (*sourceRun)[*offset + 1] < 0xDC00 || (*sourceRun)[*offset + 1] > 0xDFFF) {
                    complete = false;
                    break;
                }
                scalar = 0x10000 + ((scalar - 0xD800) << 10) + (*sourceRun)[*offset + 1] - 0xDC00;
            }
            offsets.push_back(*offset - sourceFrom);
            glyphs.push_back(glyphBuffer.glyphAt(i));
            nominal.push_back(font.platformData().skFont().unicharToGlyph(scalar));
        }
        if (complete)
            sourceText = makeScalarGlyphText(source, offsets, glyphs, nominal);
    }
#else
    UNUSED_PARAM(sourceRun);
    UNUSED_PARAM(sourceFrom);
    UNUSED_PARAM(sourceTo);
#endif
    const auto drawSpan = [&](const Font& font, size_t first, size_t count, const FloatPoint& origin) {
        auto part = sourceText ? sourceText->slice(first, count) : std::nullopt;
        if (part)
            context.drawGlyphsWithSourceText(font, glyphBuffer.glyphs(first, count), glyphBuffer.advances(first, count), origin, m_fontDescription.usedFontSmoothing(), *part);
        else
            context.drawGlyphs(font, glyphBuffer.glyphs(first, count), glyphBuffer.advances(first, count), origin, m_fontDescription.usedFontSmoothing());
    };
    RefPtr fontData''')
edit('FontCascade.cpp','context.drawGlyphs(*fontData, glyphBuffer.glyphs(lastFrom, glyphCount), glyphBuffer.advances(lastFrom, glyphCount), startPoint, m_fontDescription.usedFontSmoothing());','drawSpan(*fontData, lastFrom, glyphCount, startPoint);',2)
# Shared value type owns original bytes through local display-list recording.
edit('GraphicsContext.h','#pragma once','#pragma once\n#include "ScalarGlyphText.h"')
needle='    WEBCORE_EXPORT virtual void drawGlyphs(const Font&, std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, const FloatPoint&, FontSmoothingMode);'
edit('GraphicsContext.h',needle,needle+'\n    WEBCORE_EXPORT virtual void drawGlyphsWithSourceText(const Font&, std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, const FloatPoint&, FontSmoothingMode, const ScalarGlyphText&);')
needle='void GraphicsContext::drawGlyphsImmediate('
edit('GraphicsContext.cpp',needle,'''void GraphicsContext::drawGlyphsWithSourceText(const Font& font, std::span<const GlyphBufferGlyph> glyphs, std::span<const GlyphBufferAdvance> advances, const FloatPoint& point, FontSmoothingMode mode, const ScalarGlyphText&)
{
    // Unsupported contexts retain old behavior. This is NOT complete IPC coverage.
    drawGlyphs(font, glyphs, advances, point, mode);
}

'''+needle)
edit('Font.h','#pragma once','#pragma once\n#include "ScalarGlyphText.h"')
edit('Font.h','sk_sp<SkTextBlob> buildTextBlob(std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, FontSmoothingMode) const;','sk_sp<SkTextBlob> buildTextBlob(std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, FontSmoothingMode, const ScalarGlyphText* = nullptr) const;')
edit('skia/FontSkia.cpp','#include "Font.h"','#include "Font.h"\n#include <algorithm>')
edit('skia/FontSkia.cpp','FontSmoothingMode smoothingMode) const\n{\n    if (!m_platformData.size() || !glyphs.size())','FontSmoothingMode smoothingMode, const ScalarGlyphText* sourceText) const\n{\n    if (!m_platformData.size() || !glyphs.size())')
edit('skia/FontSkia.cpp','    SkTextBlobBuilder builder;\n    const auto& buffer', '''    if (sourceText && !sourceText->validFor(glyphs.size()))
        sourceText = nullptr;
    SkTextBlobBuilder builder;
    const auto allocate = [&](const SkFont& runFont) -> const SkTextBlobBuilder::RunBuffer& {
        if (sourceText) {
            return isVertical ? builder.allocRunTextPos(runFont, glyphs.size(), sourceText->utf8.size())
                : builder.allocRunTextPosH(runFont, glyphs.size(), 0, sourceText->utf8.size());
        }
        return isVertical ? builder.allocRunPos(runFont, glyphs.size()) : builder.allocRunPosH(runFont, glyphs.size(), 0);
    };
    const auto& buffer''')
edit('skia/FontSkia.cpp','return isVertical ? builder.allocRunPos(font, glyphs.size()) : builder.allocRunPosH(font, glyphs.size(), 0);','return allocate(font);')
edit('skia/FontSkia.cpp','return isVertical ? builder.allocRunPos(copiedFont, glyphs.size()) : builder.allocRunPosH(copiedFont, glyphs.size(), 0);','return allocate(copiedFont);')
edit('skia/FontSkia.cpp','    auto bufferGlyphs = unsafeMakeSpan<SkGlyphID>', '''    if (sourceText) {
        std::copy(sourceText->utf8.begin(), sourceText->utf8.end(), buffer.utf8text);
        std::copy(sourceText->clusters.begin(), sourceText->clusters.end(), buffer.clusters);
    }
    auto bufferGlyphs = unsafeMakeSpan<SkGlyphID>''')
edit('skia/GraphicsContextSkia.h','    void drawSkiaText(', '    void drawGlyphsWithSourceText(const Font&, std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, const FloatPoint&, FontSmoothingMode, const ScalarGlyphText&) final;\n    void drawSkiaText(')
edit('skia/GraphicsContextSkia.cpp','void GraphicsContextSkia::drawSkiaText(','''void GraphicsContextSkia::drawGlyphsWithSourceText(const Font& font, std::span<const GlyphBufferGlyph> glyphs, std::span<const GlyphBufferAdvance> advances, const FloatPoint& point, FontSmoothingMode mode, const ScalarGlyphText& sourceText)
{
    auto blob = font.buildTextBlob(glyphs, advances, mode, &sourceText);
    if (blob)
        drawSkiaText(blob, point.x(), point.y(), font.enableAntialiasing(mode), font.platformData().orientation() == FontOrientation::Vertical);
}

void GraphicsContextSkia::drawSkiaText(''')
# Both local display-list forms preserve ownership; remote IPC remains excluded.
edit('displaylists/DisplayListItems.h','#pragma once','#pragma once\n#include "ScalarGlyphText.h"')
for name in ['DrawGlyphs','DrawTextBlob']:
 old=f'    {name}(Ref<const Font>&& font, Vector<GlyphBufferGlyph>&& glyphs, Vector<GlyphBufferAdvance>&& advances, const FloatPoint& localAnchor, FontSmoothingMode smoothingMode)'
 edit('displaylists/DisplayListItems.h',old,old[:-1]+', const ScalarGlyphText* sourceText = nullptr)')
edit('displaylists/DisplayListItems.h','        : m_textBlob(font->buildTextBlob(glyphs, advances, smoothingMode))','        : m_textBlob(font->buildTextBlob(glyphs, advances, smoothingMode, sourceText))')
# Limit initializer and member edits to DrawGlyphs class.
p=out/'Source/WebCore/platform/graphics/displaylists/DisplayListItems.h';s=p.read_text();a=s.index('class DrawGlyphs {');b=s.index('#if USE(SKIA)',a);part=s[a:b];part=part.replace('        , m_fontSmoothingMode(smoothingMode)','        , m_fontSmoothingMode(smoothingMode)\n        , m_sourceText(sourceText ? std::optional<ScalarGlyphText>(*sourceText) : std::nullopt)');part=part.replace('    FontSmoothingMode m_fontSmoothingMode;','    FontSmoothingMode m_fontSmoothingMode;\n    std::optional<ScalarGlyphText> m_sourceText;');p.write_text(s[:a]+part+s[b:])
edit('displaylists/DisplayListItems.cpp','    context.drawGlyphs(m_font, m_glyphs.span(), m_advances.span(), m_localAnchor, m_fontSmoothingMode);','    if (m_sourceText)\n        context.drawGlyphsWithSourceText(m_font, m_glyphs.span(), m_advances.span(), m_localAnchor, m_fontSmoothingMode, *m_sourceText);\n    else\n        context.drawGlyphs(m_font, m_glyphs.span(), m_advances.span(), m_localAnchor, m_fontSmoothingMode);')
needle='    void drawGlyphs(const Font&, std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, const FloatPoint& localAnchor, FontSmoothingMode) final;'
edit('displaylists/DisplayListRecorderImpl.h',needle,needle+'\n    void drawGlyphsWithSourceText(const Font&, std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, const FloatPoint&, FontSmoothingMode, const ScalarGlyphText&) final;')
edit('displaylists/DisplayListRecorderImpl.cpp','void RecorderImpl::drawGlyphsImmediate(','''void RecorderImpl::drawGlyphsWithSourceText(const Font& font, std::span<const GlyphBufferGlyph> glyphs, std::span<const GlyphBufferAdvance> advances, const FloatPoint& localAnchor, FontSmoothingMode smoothingMode, const ScalarGlyphText& sourceText)
{
    if (!sourceText.validFor(glyphs.size())) {
        drawGlyphs(font, glyphs, advances, localAnchor, smoothingMode);
        return;
    }
    if (decomposeDrawGlyphsIfNeeded(font, glyphs, advances, localAnchor, smoothingMode))
        return; // Decomposed effects are not covered by this research subset.
    appendStateChangeItemIfNecessary();
#if USE(SKIA)
    if (drawGlyphsMode() == Recorder::DrawGlyphsMode::TextBlob) {
        m_items.append(DrawTextBlob(Ref { font }, Vector(glyphs), Vector(advances), localAnchor, smoothingMode, &sourceText));
        return;
    }
#endif
    m_items.append(DrawGlyphs(Ref { font }, Vector(glyphs), Vector(advances), localAnchor, smoothingMode, &sourceText));
}

void RecorderImpl::drawGlyphsImmediate(''')
subprocess.run(['git','-C',str(out),'add','-N','.'],check=True)
subprocess.run(['git','-C',str(out),'diff','--check'],check=True)
patch=subprocess.check_output(['git','-C',str(out),'diff','--binary'])
(here/'0002-research-only-scalar-source-to-skia.patch').write_bytes(patch)
manifest=[{'path':p,'sha256':hashlib.sha256((base/p).read_bytes()).hexdigest(),'bytes':(base/p).stat().st_size,'url':'https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/'+p}for p in paths]
(here/'patch-source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'patchBytes':len(patch),'modifiedUpstreamFiles':len(paths),'newHeader':header,'engineCompiled':False,'engineExecuted':False}))

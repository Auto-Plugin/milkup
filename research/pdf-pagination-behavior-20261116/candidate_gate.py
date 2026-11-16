"""One source selection and strict real-TU receipt contract for both stages."""
import pathlib,re,shlex

def sources(tail=False,combined=False):
    assert not combined or tail, 'Combined candidate requires final-page observers'
    names=['rendering/RenderBlockFlow.cpp','rendering/RenderTable.cpp','rendering/RenderTableSection.cpp']
    if tail:names.append('page/PrintContext.cpp')
    if combined:names.extend(['platform/graphics/FontCascade.cpp','platform/graphics/GraphicsContext.cpp','platform/graphics/skia/FontSkia.cpp','platform/graphics/skia/GraphicsContextSkia.cpp','platform/graphics/displaylists/DisplayListItems.cpp','platform/graphics/displaylists/DisplayListRecorderImpl.cpp','rendering/OutlinePainter.cpp','rendering/RenderBox.cpp','rendering/RenderLayer.cpp'])
    return ['Source/WebCore/'+name for name in names]

def validate(candidate,tail=False,combined=False):
    gate=candidate['gate'];expected=sources(tail,combined)
    assert candidate['status']=='passed' and gate['status']=='passed', 'Actual candidate compilation must pass'
    assert gate['sourceRestored'] is True, 'Source restoration not proven'
    assert set(gate['sourceHashes'])==set(gate['selectedUnits'])==set(expected), 'Exact selected source coverage required'
    assert gate['maxObjectCommands']==(13 if combined else 4), 'Explicit narrow compilation budget required'
    assert gate['compileDatabaseSha256']==candidate['baseCacheIdentity']['compileDatabase'], 'Configured command database differs'
    targets={};representatives={}
    for name in expected:
        h=gate['sourceHashes'][name]
        assert re.fullmatch('[0-9a-f]{64}',h), 'Source hash missing'
        assert candidate['modifiedSourceHashes'][name.removeprefix('Source/WebCore/')]==h, 'Compiled source differs from continuation source'
        entry=gate['selectedUnits'][name];args=entry.get('arguments') or shlex.split(entry['command'])
        assert args.count('-o')==1 and args.count('-c')==1, 'Unique compile output/input required'
        target=args[args.index('-o')+1]
        assert target.endswith('.o') and args[args.index('-c')+1]==entry['file'], 'Actual compile input/output required'
        if target in targets:assert entry==targets[target], 'Shared unified TU must have identical commands'
        else:targets[target]=entry;representatives['fixed-'+pathlib.Path(name).stem]=h
    assert gate['uniqueObjectCommands']==len(targets) and 1<=len(targets)<=gate['maxObjectCommands'], 'Unique TU count differs from actual command graph'
    actual=[row for row in gate['samples'] if row['name'].startswith('fixed-')]
    assert len(actual)==len(targets) and {r['name']for r in actual}==set(representatives), 'Each unique real TU requires exactly one successful compile'
    for row in actual:
        assert row['exitCode']==0 and row['sourceHashAfter']==representatives[row['name']], 'Failed or changed actual TU'
        assert re.fullmatch('[0-9a-f]{64}',row['objectSha256']), 'Compiled object hash required'
    return {'sources':len(expected),'uniqueObjectCommands':len(targets),'maxObjectCommands':gate['maxObjectCommands']}

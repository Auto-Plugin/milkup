#!/usr/bin/env python3
"""Local real HarfBuzz + font cmap/GSUB diagnostic, never a PDF text repair."""
import argparse, ctypes as C, ctypes.util, hashlib, json, pathlib
from fontTools.ttLib import TTFont

class Info(C.Structure):
    _fields_=[('codepoint',C.c_uint32),('mask',C.c_uint32),('cluster',C.c_uint32),('var1',C.c_uint32),('var2',C.c_uint32)]
class Feature(C.Structure):
    _fields_=[('tag',C.c_uint32),('value',C.c_uint),('start',C.c_uint),('end',C.c_uint)]

def shape(path,index,text,language,locl):
    h=C.CDLL(ctypes.util.find_library('harfbuzz'))
    def api(n,args,ret):
        f=getattr(h,n);f.argtypes=args;f.restype=ret;return f
    ptr=C.c_void_p;u=C.c_uint
    blob=api('hb_blob_create_from_file_or_fail',[C.c_char_p],ptr)(str(path).encode());assert blob
    face=api('hb_face_create',[ptr,u],ptr)(blob,index)
    font=api('hb_font_create',[ptr],ptr)(face)
    api('hb_ot_font_set_funcs',[ptr],None)(font)
    buf=api('hb_buffer_create',[],ptr)();encoded=text.encode()
    api('hb_buffer_add_utf8',[ptr,C.c_char_p,C.c_int,u,C.c_int],None)(buf,encoded,len(encoded),0,len(encoded))
    lang=api('hb_language_from_string',[C.c_char_p,C.c_int],ptr)(language.encode(),-1)
    api('hb_buffer_set_language',[ptr,ptr],None)(buf,lang)
    api('hb_buffer_guess_segment_properties',[ptr],None)(buf)
    features=(Feature*1)();assert api('hb_feature_from_string',[C.c_char_p,C.c_int,C.POINTER(Feature)],C.c_int)(f'locl={locl}'.encode(),-1,C.byref(features[0]))
    api('hb_shape',[ptr,ptr,C.POINTER(Feature),u],None)(font,buf,features,1)
    count=u();info=api('hb_buffer_get_glyph_infos',[ptr,C.POINTER(u)],C.POINTER(Info))(buf,C.byref(count))
    glyphs=[{'glyph':info[i].codepoint,'utf8Cluster':info[i].cluster}for i in range(count.value)]
    for kind,obj in [('buffer',buf),('font',font),('face',face),('blob',blob)]:api('hb_'+kind+'_destroy',[ptr],None)(obj)
    return glyphs

def diagnose(path,index):
    font=TTFont(path,fontNumber=index);cmap=font.getBestCmap();table=font['GSUB'].table
    substitutions=[]
    for i,lookup in enumerate(table.LookupList.Lookup):
        for sub in lookup.SubTable:
            for s in '0123456789':
                target=getattr(sub,'mapping',{}).get(cmap[ord(s)])
                if target:
                    substitutions.append({'source':s,'nominal':font.getGlyphID(cmap[ord(s)]),'shaped':font.getGlyphID(target),'lookup':i,'features':sorted({r.FeatureTag for r in table.FeatureList.FeatureRecord if i in r.Feature.LookupListIndex}),'reverseCmap':[c for c,g in cmap.items()if g==target]})
    samples=[]
    for language in ['en','zh-cn','ja']:
        for locl in [0,1]:
            text='WRAP0123456789';gs=shape(path,index,text,language,locl)
            for g in gs:
                g['source']=text[g['utf8Cluster']];g['nominal']=font.getGlyphID(cmap[ord(g['source'])])
                g['unchangedNominal']=g['glyph']==g['nominal']
            samples.append({'language':language,'locl':locl,'text':text,'glyphs':gs,'currentScalarBridgeWouldAccept':all(g['unchangedNominal']for g in gs)})
    return {'status':'diagnostic-not-product-accepted','fontPath':str(path),'fontSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'faceIndex':index,'fontVersion':[str(x.toUnicode())for x in font['name'].names if x.nameID==5][:1],'scope':'Actual local shaping with explicit language; CI font bytes and actual WebKit run language/cluster stream not captured. No source text is inferred from a reverse cmap.','substitutions':substitutions,'samples':samples}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('font',type=pathlib.Path);p.add_argument('--index',type=int,default=2);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    a.output.write_text(json.dumps(diagnose(a.font,a.index),ensure_ascii=False,indent=2)+'\n')

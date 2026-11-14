from pathlib import Path
import ctypes,hashlib,json,lzma,re,struct,sys
assert len(sys.argv)==3, 'usage: extract-embedded.py INSTALLER NEW_TEMP_DIRECTORY'
r=Path(sys.argv[2]);r.mkdir(exist_ok=False)
installer=Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(installer).hexdigest()=='2becc80d9b5ad7e9e2b8a0f76130157d4a8af32102b65b33c221d334ff4838c4'
h=installer.index(b'\xef\xbe\xad\xdeNullsoftInst')-4
payload=installer[h+28:]
dec=lzma.LZMADecompressor(format=lzma.FORMAT_ALONE)
stream=dec.decompress(payload[:5]+b'\xff'*8+payload[5:],max_length=32*1024*1024)
assert dec.eof and len(stream)<32*1024*1024
size=17244160;wanted='dad51ea4fabcbb877facb663738ba8de94f6dac33397ae7eb33759a68f5405f5'
app=None
for m in re.finditer(b'MZ',stream):
 candidate=stream[m.start():m.start()+size]
 if len(candidate)==size and hashlib.sha256(candidate).hexdigest()==wanted:app=candidate;break
assert app is not None
(r/'milkup-desktop.exe').write_bytes(app)
b=app;pe=struct.unpack_from('<I',b,60)[0];assert b[pe:pe+4]==b'PE\0\0'
count=struct.unpack_from('<H',b,pe+6)[0];op=pe+24;optsz=struct.unpack_from('<H',b,pe+20)[0];assert struct.unpack_from('<H',b,op)[0]==0x20b
base=struct.unpack_from('<Q',b,op+24)[0];sections=[]
for i in range(count):
 vs,va,n,o=struct.unpack_from('<4I',b,op+optsz+40*i+8);sections.append((va,o,n))
def off(a):
 for va,o,n in sections:
  if va<=a-base<va+n:return o+a-base-va
 raise ValueError(a)
def addr(o):
 for va,start,n in sections:
  if start<=o<start+n:return base+va+o-start
 raise ValueError(o)
lib=ctypes.CDLL('libbrotlidec.so.1');fn=lib.BrotliDecoderDecompress
fn.argtypes=[ctypes.c_size_t,ctypes.c_void_p,ctypes.POINTER(ctypes.c_size_t),ctypes.c_void_p];fn.restype=ctypes.c_int
outdir=r/'frontend';outdir.mkdir(exist_ok=True);assets=[];seen=set()
for m in re.finditer(rb'/(?:assets/[A-Za-z0-9_.-]+|index.html)',b):
 for hit in re.finditer(re.escape(struct.pack('<Q',addr(m.start()))),b):
  try:
   kp,kn,dp,dn=struct.unpack_from('<4Q',b,hit.start())
   if not 0<kn<=200 or not 0<dn<=8*1024*1024:continue
   key=b[off(kp):off(kp)+kn].decode('ascii')
   if not re.fullmatch(r'/(?:assets/[A-Za-z0-9_.-]+|index.html)',key):continue
   compressed=b[off(dp):off(dp)+dn];n=ctypes.c_size_t(8*1024*1024);output=ctypes.create_string_buffer(n.value)
   if fn(len(compressed),compressed,ctypes.byref(n),output)!=1:continue
   assert key not in seen;seen.add(key);raw=output.raw[:n.value];dest=outdir/key.lstrip('/');dest.parent.mkdir(exist_ok=True);dest.write_bytes(raw)
   assets.append(dict(key=key,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),peTableOffset=hit.start(),compressedOffset=off(dp),compressedBytes=dn))
  except (ValueError,UnicodeError,struct.error):continue
assert '/index.html' in seen and '/assets/index-BJRufgo7.js' in seen
js=(outdir/'assets/index-BJRufgo7.js').read_text()
markers={s:js.count(s) for s in ['2.0.0-beta.4','2.0.0-beta.3','data-application-update-action','enableFromUserIntent','批准','data-plugin-action="toggle"']}
assert markers['2.0.0-beta.4']==1 and markers['2.0.0-beta.3']==0 and markers['enableFromUserIntent']>0
proof=dict(installerSha256=hashlib.sha256(installer).hexdigest(),appSha256=wanted,appBytes=size,assets=assets,markers=markers,method='Read-only NSIS solid LZMA extraction, exact application SHA, PE pointer/length asset table and system Brotli decode. No Windows code or installer executed.')
(r/'embedded-frontend-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(dict(assetCount=len(assets),markers=markers),indent=2))

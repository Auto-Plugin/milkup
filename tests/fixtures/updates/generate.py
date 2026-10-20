# Offline synthetic vectors only. Deterministic public test key, never a release key.
import hashlib,base64,json
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
b64=lambda b:base64.b64encode(b).decode()
key=Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b'milkup-public-synthetic-update-fixture-v1-not-for-release').digest())
pub=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)
kid=hashlib.sha256(pub).digest()[:8]
public=b64(('untrusted comment: PUBLIC SYNTHETIC TEST KEY - NEVER RELEASE\n'+b64(b'Ed'+kid+pub)).encode())
def signature(data):
 sig=key.sign(hashlib.blake2b(data,digest_size=64).digest());comment=b'milkup synthetic non-executable fixture'
 text='untrusted comment: synthetic fixture\n'+b64(b'ED'+kid+sig)+'\ntrusted comment: '+comment.decode()+'\n'+b64(key.sign(sig+comment))
 return b64(text.encode())
artifact=b'milkup synthetic artifact; NOT executable or installable\n'
old=b'milkup older synthetic artifact; NOT executable or installable\n'
artifact_sig=signature(artifact)
def envelope(**changes):
 release={'version':'2.0.0-beta.2','notes':'Signed synthetic local fixture; never installed','platforms':{k:{'url':'http://milkup-fixture.invalid/payload','signature':artifact_sig} for k in ['linux-x86_64','windows-x86_64','darwin-x86_64','darwin-aarch64']}}
 content={'schema':1,'product':'milkup-desktop','channel':'beta','release':release}
 for k,v in changes.items():
  if k=='version':release[k]=v
  else:content[k]=v
 payload=json.dumps(content,ensure_ascii=False,separators=(',',':')).encode()
 return {'payload':b64(payload),'signature':signature(payload)}
obj={'boundary':'Deterministic public TEST key only; no product configuration, private key file, installer or release endpoint. HTTP fixture name is resolved to an ephemeral loopback listener by tests only.','publicKey':public,'artifact':b64(artifact),'artifactSignature':artifact_sig,'oldArtifact':b64(old),'oldArtifactSignature':signature(old),'envelopes':{'valid':envelope(),'wrongProduct':envelope(product='other-product'),'wrongChannel':envelope(channel='stable'),'invalidVersion':envelope(version='v2.0.0-beta.2'),'oldVersion':envelope(version='1.9.9')}}
Path('tests/fixtures/updates/signed-manifest.json').write_text(json.dumps(obj,indent=2)+'\n')


# PE resource parser fixtures, with no code section or entry point. They are not
# installers and must never be executed. Reuse the same PUBLIC test key above.
import struct
pack16=lambda n:struct.pack('<H',n)
pack32=lambda n:struct.pack('<I',n)
def version_block(key, value=b'', children=b'', text=False):
 head=pack16(0)+pack16(len(value)//2 if text else len(value))+pack16(int(text))+(key+'\0').encode('utf-16le')
 head+=b'\0'*(-len(head)%4)
 body=head+value
 if children: body+=b'\0'*(-len(body)%4)+children
 return pack16(len(body))+body[2:]
def pe_resource(version, plus=False):
 product=version_block('ProductVersion',(version+'\0').encode('utf-16le'),text=True)
 table=version_block('040904b0',children=product,text=True)
 info=version_block('StringFileInfo',children=table,text=True)
 fixed=struct.pack('<13I',0xfeef04bd,0x10000,2<<16,0,2<<16,0,0x3f,0,0x40004,1,0,0,0)
 block=version_block('VS_VERSION_INFO',fixed,info)
 resource=bytearray(88)
 for offset,name,target in [(0,16,24),(24,1,48),(48,0x409,72)]:
  struct.pack_into('<H',resource,offset+14,1)
  struct.pack_into('<II',resource,offset+16,name,target | (0x80000000 if offset!=48 else 0))
 struct.pack_into('<IIII',resource,72,0x1000+88,len(block),0,0)
 resource+=block
 image=bytearray(0x200)
 image[:2]=b'MZ';struct.pack_into('<I',image,0x3c,0x80)
 image[0x80:0x84]=b'PE\0\0'
 struct.pack_into('<HHIIIHH',image,0x84,0x8664 if plus else 0x14c,1,0,0,0,240 if plus else 224,0)
 struct.pack_into('<H',image,0x98,0x20b if plus else 0x10b)
 data_dir=112 if plus else 96
 section=0x188 if plus else 0x178
 struct.pack_into('<I',image,0x98+data_dir-4,16)
 struct.pack_into('<II',image,0x98+data_dir+16,0x1000,len(resource))
 image[section:section+8]=b'.rsrc\0\0\0'
 struct.pack_into('<IIII',image,section+8,len(resource),0x1000,len(resource),0x200)
 return bytes(image+resource)
def gated_envelope(version='2.0.0-beta.2', sequence=2, issued=1800000000, expires=1800003600, rollback=None, artifact=None):
 payload=json.loads(base64.b64decode(envelope()['payload']))
 release=payload['release'];release['version']=version
 release['milkup']={'sequence':sequence,'issuedAt':issued,'expiresAt':expires}
 if rollback is not None:release['milkup']['rollbackFrom']=rollback
 if artifact is not None:
  for selection in release['platforms'].values():selection['signature']=signature(artifact)
 data=json.dumps(payload,separators=(',',':')).encode()
 return {'payload':b64(data),'signature':signature(data)}
pe=pe_resource('2.0.0-beta.2');old_pe=pe_resource('2.0.0-beta.1')
gates={'boundary':obj['boundary'],'now':1800000100,'publicKey':public,'pe':b64(pe),'pe64':b64(pe_resource('2.0.0-beta.2',plus=True)),'oldPe':b64(old_pe),'envelopes':{
 'fresh':gated_envelope(),
 'expired':gated_envelope(issued=1799990000,expires=1799993600),
 'rollback':gated_envelope(version='2.0.0-beta.1',sequence=3,rollback='2.0.0-beta.2'),
 'older':gated_envelope(version='2.0.0-beta.1',sequence=1),
 'peValid':gated_envelope(artifact=pe),
 'peMismatch':gated_envelope(artifact=old_pe),
}}
Path('tests/fixtures/updates/version-gates.json').write_text(json.dumps(gates,indent=2)+'\n')

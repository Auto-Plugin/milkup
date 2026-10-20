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

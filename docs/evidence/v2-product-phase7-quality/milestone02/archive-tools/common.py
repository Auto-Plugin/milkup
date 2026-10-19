"""M02 explicit selection, no profile/dependency traversal. Source evidence stays untouched."""
import gzip,hashlib
from pathlib import Path
from inventory import SOURCE,classify,inventory
DEST=Path('/workspace/milkup/docs/evidence/v2-product-phase7-quality/milestone02')
LIMIT=16*1024*1024

def safe_relative(value):
    p=Path(value)
    if p.is_absolute() or not p.parts or any(x in ('..','.') for x in p.parts):raise ValueError('Unsafe relative path')
    return p

def allowed(rel):return classify(str(rel),0)

def candidates():
    result=inventory()
    for row in result['entries']:yield Path(row['source']),None,row['originalBytes']
    for row in result['excluded']:yield Path(row['path']),row['reason'],row.get('bytes')

def digest(path):
    h=hashlib.sha256();n=0
    with path.open('rb') as f:
        while b:=f.read(1024*1024):h.update(b);n+=len(b)
    return n,h.hexdigest()

class CountingSink:
    def __init__(self):self.count=0
    def write(self,b):self.count+=len(b);return len(b)
    def flush(self):pass

def gzip_size(path):
    sink=CountingSink()
    with gzip.GzipFile(filename='',mode='wb',fileobj=sink,mtime=0,compresslevel=6) as z,path.open('rb') as f:
        while b:=f.read(1024*1024):z.write(b)
    return sink.count

def compress_fixture(rel,size):
    return size>=128*1024 and (rel.suffix in {'.json','.log'} or (len(rel.parts)==4 and rel.parts[:2]==('outline','runs') and rel.suffix=='.md'))

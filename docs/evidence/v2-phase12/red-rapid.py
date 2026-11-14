import sys,os,json,time
from pathlib import Path
sys.path.insert(0,'tests/helpers')
from native_x11 import XTest, idle, until, observation
root=Path('/tmp/milkup-v2-phase12/red-direct');file=root/'windowed.md';original=file.read_bytes()
x=XTest('0x20000e');idle(file)
x.shortcut('1');until(lambda s:s['mode']=='source','source')
x.shortcut('a');x.key('Left');x.key('End');until(lambda s:s['selection']['head']==12,'end')
for action,key in [('key','x'),('shortcut','s'),('shortcut','z'),('shortcut','y'),('key','q'),('shortcut','s')]:
 getattr(x,action)(key)
time.sleep(.3)
s=idle(file)
result={'state':s,'expectedPrefix':'- uniqueItemxq','actualPrefix':file.read_bytes()[:50].decode(),'events':observation()['events']}
(root/'rapid-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
x.close()
assert file.read_bytes()==original[:12]+b'xq'+original[12:]
assert not s['dirty'] and s['selection']=={'anchor':14,'head':14}

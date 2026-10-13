import sys,json,time
from pathlib import Path
sys.path.insert(0,'tests/helpers')
from native_x11 import XTest,idle,observation
p=Path('/tmp/milkup-v2-phase12/red-direct');file=p/'windowed.md';x=XTest('0x20000e');before=idle(file)
for i in range(20): x.key('a',delay=0)
x.shortcut('s',delay=0)
for i in range(20):x.key('b',delay=0)
time.sleep(.5);after=idle(file)
result={'before':before,'after':after,'events':observation()['events']}
(p/'burst-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False));x.close()
assert after['selection']['head']==before['selection']['head']+40,'No typed characters may be discarded during save'
assert after['dirty'], 'Input after the save snapshot must remain dirty'

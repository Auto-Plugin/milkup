import sys,json,time
from pathlib import Path
sys.path.insert(0,'tests/helpers')
from native_x11 import XTest,idle,observation
p=Path('/tmp/milkup-v2-phase12/red-direct');file=p/'windowed.md';x=XTest('0x20000e');before=idle(file)
x.key('v',delay=.005);x.shortcut('s',delay=.005);x.shortcut('z',delay=.005)
time.sleep(.3);after=idle(file)
result={'before':before,'after':after,'events':observation()['events'][-6:]}
(p/'undo-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False));x.close()
assert after['selection']['head']==14 and after['dirty'], 'Undo after save must be applied, not silently ignored'

"""Normal CLI + real XTest navigation on a numbered >=100 MiB document.
The opt-in native observer reads state/geometry; it cannot drive the app.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import random
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'helpers'))
from native_x11 import XTest, idle, observation, until

root = Path(os.environ['MILKUP_NATIVE_EVIDENCE_DIR'])
root.mkdir(parents=True, exist_ok=False)
file = root / 'numbered.md'
reference = root / 'original.md'
head = 'BEGIN 中文😀\r\n'
tail = 'tailneedle 中文😀'
count = math.ceil((104857600 - len(head.encode()) - len(tail.encode())) / 64)
def utf16(value): return len(value.encode('utf-16-le')) // 2
end = utf16(head) + count * 64 + utf16(tail)
tail_start = utf16(head) + count * 64
with file.open('wb') as stream:
    stream.write(head.encode())
    for start in range(1, count + 1, 8192):
        stream.write(b''.join(f'row{i:07d} '.encode() + b'x' * 51 + b'\r\n' for i in range(start, min(count+1,start+8192))))
    stream.write(tail.encode())
shutil.copyfile(file, reference)
app = str(Path('apps/desktop/src-tauri/target/debug/milkup-desktop').resolve())
launcher = os.environ.get('MILKUP_NATIVE_LAUNCHER', '/workspace/.cloud/milkup-v2/run-native.sh')
results = []
proc = x = window = sid = app_pid = app_birth = None
pointer_driver = os.environ.get('MILKUP_SCROLL_POINTER_DRIVER', 'xtest')
assert pointer_driver in ['xtest','webdriver']

def driver(method, route, data=None):
    request=urllib.request.Request('http://127.0.0.1:4444'+route, data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)
    with urllib.request.urlopen(request,timeout=20) as response:return json.load(response)['value']

def pointer(actions):
    driver('POST',f'/session/{sid}/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':actions}]})

def move_action(px,py,duration=0):return {'type':'pointerMove','origin':'viewport','duration':duration,'x':round(px),'y':round(py)}

suffix = ''

def disk_hash(path, extra=b''):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    digest.update(extra)
    return digest.hexdigest()

def snapshot(name, status='PASS', **extra):
    state = observation()['state']
    results.append({'name':name,'status':status,'state':state,'memoryBytes':int(Path('/sys/fs/cgroup/memory.current').read_text()),**extra})
    (root/'results.json').write_text(json.dumps({'pointerDriver':pointer_driver,'keyboardDriver':'XTest','fixtureBytes':reference.stat().st_size,'fixtureLines':count+2,'results':results},ensure_ascii=False,indent=2)+'\n')
    print(status, name, flush=True)

def start():
    global proc,x,window,origin,sid,app_pid,app_birth
    launched = int(time.time()*1000)
    if pointer_driver=='webdriver':
        sid=driver('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'wry','tauri:options':{'application':app,'args':[str(file)]}}}})['sessionId']
    else:
        proc = subprocess.Popen([launcher,app,str(file)],stdout=(root/'application.log').open('a'),stderr=subprocess.STDOUT,start_new_session=True)
    until(lambda s:s.get('path')==str(file) and s['wall']>=launched and s['loading']=='ready','normal CLI ready',60)
    tree = subprocess.check_output(['xwininfo','-root','-tree'],text=True,timeout=3)
    ids = re.findall(r'(0x[0-9a-f]+) "milkup": \("milkup-desktop"',tree)
    assert len(ids)==1,tree
    window=ids[0]; x=XTest(window)
    app_pid=int(subprocess.check_output(['xprop','-id',window,'_NET_WM_PID'],text=True).split('=')[-1])
    app_birth=Path(f'/proc/{app_pid}/stat').read_text().rsplit(')',1)[1].split()[19]
    info=subprocess.check_output(['xwininfo','-id',window],text=True,timeout=3)
    origin=[int(re.search(r'Absolute upper-left '+axis+r':\s*(-?\d+)',info)[1]) for axis in ['X','Y']]
    return idle(file)

def stop():
    global proc,x,sid
    if x:x.close();x=None
    if proc:
        os.killpg(proc.pid,signal.SIGTERM)
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
        proc=None
    if sid:
        driver('DELETE',f'/session/{sid}');sid=None
        try:
            birth=Path(f'/proc/{app_pid}/stat').read_text().rsplit(')',1)[1].split()[19]
            argv=Path(f'/proc/{app_pid}/cmdline').read_bytes().split(b'\0')[0].decode()
            if birth==app_birth and argv==app:os.kill(app_pid,signal.SIGTERM)
        except (FileNotFoundError,ProcessLookupError):pass

def settled(): x.barrier(); return idle(file)
def caret(position, anchor=None):
    settled()
    return until(lambda s:s['selection']=={'anchor':position if anchor is None else anchor,'head':position} and not s['pending'] and s['cursor']==str(position),'exact cursor/selection')

def visible(s):
    v=s['viewport']
    lines=[l for l in s['lineRects'] if l['height']>0 and l['y']+l['height']>v['y']+2 and l['y']<v['y']+v['height']-2]
    assert lines, ('blank viewport',s)
    assert lines[0]['y'] <= v['y'] + 26, ('blank top',s)
    assert lines[-1]['y'] + lines[-1]['height'] >= v['y']+v['height']-50, ('blank bottom',s)
    assert s['scrollHeight']<16000000,s
    return lines

def shot(name):subprocess.run(['import','-window',window,str(root/(name+'.png'))],check=True,timeout=10)
def save():
    x.shortcut('s',delay=0);s=settled()
    assert not s['dirty'] and s['version']==s['savedVersion'],s
    assert disk_hash(file)==disk_hash(reference,suffix.encode()),'full saved bytes differ'

def drag_from_top(fraction):
    x.shortcut('Home');caret(0)
    s=observation()['state'];v=s['viewport']
    px=origin[0]+v['x']+v['width']-3
    y0=origin[1]+v['y']+7
    y1=origin[1]+v['y']+10+(v['height']-20)*fraction
    if pointer_driver=='webdriver':
        pointer([move_action(px-origin[0],y0-origin[1]),{'type':'pointerDown','button':0},{'type':'pause','duration':50},move_action(px-origin[0],y1-origin[1],200),{'type':'pointerUp','button':0}])
    else:
        x.move(px,y0);x.button(1,True)
        for part in range(1,7):x.move(px,y0+(y1-y0)*part/6);time.sleep(.02)
        x.button(1,False)
    x.barrier()
    def ready(s):
        if not s['fromLine'] or int(s['fromLine'])<=1000:return False
        try: visible(s);return True
        except AssertionError:return False
    return until(ready,'real scrollbar drag renders a filled distant viewport')

try:
    start()
    for mode in ['source','live']:
        x.shortcut('1' if mode=='source' else '2');settled()
        x.shortcut('End');s=caret(end);visible(s)
        assert int(s['toLine'])==count+2,s
        c=s['cursorRect'];v=s['viewport'];assert c and v['y']<=c['y'] and c['y']+c['height']<=v['y']+v['height']+2,s
        shot(mode+'-keyboard-tail');snapshot(mode+': Ctrl+End reaches visible tail at exact UTF-16 position')
        x.chord('Shift_L','Page_Up');s=settled()
        assert s['selection']['anchor']==end and s['selection']['head']<end,s
        x.key('Page_Down');caret(end);visible(observation()['state'])
        x.shortcut('Home');caret(0)
        snapshot(mode+': PageUp/PageDown and document Home preserve logical navigation')
        fractions=[.03,.999]+[random.Random(13013+i).uniform(.06,.94) for i in range(8)]
        for index,fraction in enumerate(fractions):
            s=drag_from_top(fraction);lines=visible(s)
            middle=lines[len(lines)//2]
            expected=f"row{middle['number']-1:07d}"
            assert middle['text'].startswith(expected),(middle,expected)
            if pointer_driver=='webdriver':pointer([move_action(middle['x']+30,middle['y']+10),{'type':'pointerDown','button':0},{'type':'pause','duration':30},{'type':'pointerUp','button':0}])
            else:x.click(origin[0]+middle['x']+30,origin[1]+middle['y']+10)
            s=settled();position=s['selection']['head']
            snapshot(f'{mode}: pointer target {index+1}',targetLine=middle['number'],fraction=fraction)
            assert middle['from']<=position<=middle['to'],s
            assert s['selection']['anchor']==position,s
            if index in [3,7]:
                x.key('z');caret(position+1)
                x.shortcut('z');caret(position)
                x.shortcut('y');caret(position+1)
                x.shortcut('z');caret(position)
            page_rows=max(1,math.floor(s['viewport']['height']/21)-1)
            column=position-middle['from']
            down_line=min(count+2,middle['number']+page_rows)
            def at_line(number):
                if number==count+2:return tail_start+min(column,utf16(tail+suffix))
                return utf16(head)+(number-2)*64+column
            x.key('Page_Down');s=caret(at_line(down_line));visible(s)
            x.key('Page_Up');s=caret(at_line(max(2,down_line-page_rows)));visible(s)
            snapshot(f'{mode}: physical scrollbar jump {index+1}, pointer and page navigation')
        save();snapshot(mode+': random edits undo/redo and full-file save match reference')
        x.shortcut('Home');caret(0);x.shortcut('f')
        for char in 'tailneedle':x.key(char)
        search_started=time.monotonic()
        try:
            # A bounded functional search check, reported separately from the
            # unchanged 200/500ms viewport performance targets.
            until(lambda s:s.get('search',{}).get('phase')=='done' and s['search'].get('complete') and len(s['search'].get('matches',[]))==1,'100 MiB tail search completion',120)
            x.key('Return');x.key('Escape');s=caret(tail_start+10,tail_start);visible(s)
            snapshot(mode+': search reaches the same tail range',elapsedMs=(time.monotonic()-search_started)*1000)
        except AssertionError as error:
            snapshot(mode+': search completion/position',status='FAIL',error=str(error),elapsedMs=(time.monotonic()-search_started)*1000)
            x.key('Escape')
        x.shortcut('End');caret(end)
        for char in 'xyz':x.key(char,delay=0)
        caret(end+3);x.shortcut('z');caret(end);x.shortcut('y');caret(end+3)
        suffix+='xyz';end+=3;save();visible(observation()['state']);shot(mode+'-tail-saved')
        snapshot(mode+': tail edit, undo/redo and exact persisted bytes')
        stop();s=start();assert not s['dirty'] and s['version']==0,s
        x.shortcut('End');caret(end);visible(observation()['state'])
        assert disk_hash(file)==disk_hash(reference,suffix.encode())
        snapshot(mode+': normal CLI reopen preserves tail bytes and position')
except BaseException as error:
    snapshot('runner failure',status='FAIL',error=str(error))
    if window:shot('failure')
    raise
finally:
    stop()

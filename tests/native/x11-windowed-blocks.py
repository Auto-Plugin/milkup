"""Normal Tauri launch + real X11 keys + disk bytes; no WebDriver or IME claim.
Run with DISPLAY and MILKUP_X11_WINDOW after opening the generated fixture via CLI.
"""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import time
import sys

root = Path(os.environ.get('MILKUP_NATIVE_EVIDENCE_DIR', '/tmp/milkup-v2-phase10/native-direct'))
file = root / 'windowed.md'
if '--prepare' in sys.argv:
    root.mkdir(parents=True, exist_ok=True)
    fixture = ('- uniqueItem\r\n\r\n```md\r\n' + 'literal body\r\n' * 80
               + '- uniqueLiteral\r\n  uniqueCode\r\n```\r\n\r\n'
               + '\r\n'.join(f'- selectedItem{i:02d}' for i in range(40))
               + '\r\n' + ('body ' + 'x' * 508 + '\r\n') * 2048)
    # Use a new evidence directory; never overwrite an existing fixture/run.
    for target in [root / 'original.md', file]:
        with target.open('xb') as output:
            output.write(fixture.encode())
    print(file)
    sys.exit(0)
original = (root / 'original.md').read_bytes().decode()
window = os.environ['MILKUP_X11_WINDOW']
x = ctypes.CDLL('libX11.so.6')
t = ctypes.CDLL('libXtst.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
x.XStringToKeysym.argtypes = [ctypes.c_char_p]
x.XStringToKeysym.restype = ctypes.c_ulong
x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
x.XFlush.argtypes = [ctypes.c_void_p]
x.XCloseDisplay.argtypes = [ctypes.c_void_p]
t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
display = x.XOpenDisplay(None)
assert display
x.XSetInputFocus(display, int(window,16), 2, 0)
x.XFlush(display)
results = []

def event(key, down):
    code = x.XKeysymToKeycode(display, x.XStringToKeysym(key.encode()))
    assert code, key
    t.XTestFakeKeyEvent(display, code, down, 0)
    x.XFlush(display)

def chord(*keys):
    for key in keys: event(key,1)
    for key in reversed(keys): event(key,0)
    time.sleep(.12)

def press(key): chord(key)
def shortcut(key): chord('Control_L',key)

def shot(name):
    subprocess.run(['import','-window',window,str(root/(name+'.png'))],check=True,timeout=15)

def saved(expected, label):
    start=time.monotonic()
    shortcut('s')
    while time.monotonic()-start<60:
        if file.read_bytes().decode()==expected:
            print(json.dumps({'step':label,'disk':'exact','saveAndQueueMs':round((time.monotonic()-start)*1000)}),flush=True)
            return
        time.sleep(.2)
    actual=file.read_bytes().decode()
    (root/'failed-actual.md').write_bytes(actual.encode())
    shot('failure')
    raise AssertionError(f'{label}: disk mismatch; actual={len(actual)} chars, expected={len(expected)}')

def go_line(number):
    shortcut('a');press('Left')
    for _ in range(number-1): press('Down')
    press('Home')

def check(name, action):
    action()
    results.append({'name':name,'result':'PASS'})
    print('PASS '+name,flush=True)
    (root/'results.json').write_text(json.dumps({'driver':'normal Tauri + XTest; no WebDriver','systemIme':'not tested','results':results},indent=2)+'\n')

try:
    for mode in ['source','live']:
        shortcut('1' if mode=='source' else '2')
        time.sleep(1)
        def lists():
            go_line(1);press('End');press('Return')
            end=original.index('\r\n')
            continued=original[:end]+'\r\n- '+original[end:]
            nested=original[:end]+'\r\n  - '+original[end:]
            saved(continued,'list continuation')
            press('Tab');saved(nested,'list indent')
            press('Return');saved(continued,'empty nested exit')
            press('Return');saved(original[:end]+'\r\n'+original[end:],'empty list exit')
            for expected in [continued,nested,continued,original]: shortcut('z');saved(expected,'list undo')
            # Typing after undo proves the restored caret is the original item end.
            press('x');saved(original[:end]+'x'+original[end:],'undo caret next input')
            shortcut('z');saved(original,'restore list fixture')
            shot(mode+'-list')
        check(mode+': list continuation, nested exit and undo caret',lists)
        def code():
            at=original.index('- uniqueLiteral')
            number=original[:at].count('\n')+1
            go_line(number);press('End');press('Return')
            end=at+len('- uniqueLiteral')
            saved(original[:end]+'\r\n'+original[end:],'long-fence literal list Enter')
            shortcut('z');saved(original,'code enter undo')
            press('x');saved(original[:end]+'x'+original[end:],'code undo caret next input')
            shortcut('z');saved(original,'restore code fixture')
            go_line(number+1);press('Right');press('Right');press('BackSpace')
            saved(original.replace('  uniqueCode','uniqueCode'),'code indent backspace')
            shortcut('z');saved(original,'code indent undo')
            press('End');press('Return')
            end=original.index('  uniqueCode')+len('  uniqueCode')
            saved(original[:end]+'\r\n  '+original[end:],'code blank-line indentation')
            shot(mode+'-code')
            shortcut('z');saved(original,'restore code blank line')
        check(mode+': offscreen fence, code indentation, CRLF and undo caret',code)
        def selection():
            first=original.index('- selectedItem00')
            last=original.index('- selectedItem39')
            go_line(original[:last].count('\n')+1);press('End')
            for _ in range(39):chord('Shift_L','Up')
            chord('Shift_L','Home')
            press('Tab')
            body=original[first:last+len('- selectedItem39')]
            indented=original[:first]+'\r\n'.join('  '+line for line in body.split('\r\n'))+original[last+len('- selectedItem39'):]
            saved(indented,'cross-window indent')
            shot(mode+'-selection')
            shortcut('z');saved(original,'cross-window undo')
            shortcut('y');saved(indented,'cross-window redo')
            chord('Shift_L','Tab');saved(original,'cross-window outdent')
            # The selection remains reversed. Extending Home includes the first
            # line's prefix, then a real character must replace exactly this block.
            chord('Shift_L','Home');press('x')
            saved(original[:first]+'x'+original[last+len('- selectedItem39'):],'selection survives outdent')
            shortcut('z');saved(original,'restore selected fixture')
        check(mode+': reverse cross-window selection, atomic history and save',selection)
finally:
    (root/'results.json').write_text(json.dumps({'driver':'normal Tauri + XTest; no WebDriver','systemIme':'not tested','results':results},indent=2)+'\n')
    x.XCloseDisplay(display)

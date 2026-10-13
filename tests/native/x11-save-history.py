"""Normal CLI app + XTest; observe state only through the opt-in Vite observer.
No WebDriver, DOM input injection, mock persistence, or file-picker seam.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'helpers'))
from native_x11 import XTest, idle, observation, until

root = Path(os.environ['MILKUP_NATIVE_EVIDENCE_DIR'])
root.mkdir(parents=True, exist_ok=False)
file = root / 'document.md'
size = int(os.environ.get('MILKUP_FIXTURE_BYTES', 1100000))
original = '中文😀 first\r\n' + ('body ' + 'x' * 508 + '\r\n') * (size // 515 + 1)
file.write_bytes(original.encode())
expected = original
newline_width = 2
app = str(Path('apps/desktop/src-tauri/target/debug/milkup-desktop').resolve())
launcher = os.environ.get('MILKUP_NATIVE_LAUNCHER', '/workspace/.cloud/milkup-v2/run-native.sh')
results = []
proc = None
window = None
x = None

def utf16(value):
    return len(value.encode('utf-16-le')) // 2

def start():
    global proc, window, x
    launched = int(time.time() * 1000)
    proc = subprocess.Popen([launcher, app, str(file)], stdout=(root / 'application.log').open('a'), stderr=subprocess.STDOUT, start_new_session=True)
    until(lambda s: s.get('path') == str(file) and s['wall'] >= launched and s['loading'] == 'ready', 'normal CLI ready', 60)
    import re
    tree = subprocess.check_output(['xwininfo', '-root', '-tree'], text=True, timeout=3)
    windows = re.findall(r'(0x[0-9a-f]+) "milkup": \("milkup-desktop"', tree)
    assert len(windows) == 1, tree
    window = windows[0]
    x = XTest(window)
    return idle(file)

def stop():
    global proc, x
    if x:
        x.close(); x = None
    if proc:
        # Only this runner's new process group; no shared application cleanup.
        os.killpg(proc.pid, signal.SIGTERM)
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=5)
        proc = None

def settled():
    x.barrier()
    return idle(file)

def state_is(head, dirty, anchor=None):
    settled()
    selection = {'anchor': head if anchor is None else anchor, 'head': head}
    s = until(lambda s: s['selection'] == selection and s['dirty'] == dirty and not s['saving'] and not s['pending'], 'committed selection and dirty state')
    assert s['cursor'] == str(head), s
    return s

def save(text):
    x.shortcut('s', delay=0)
    s = settled()
    assert file.read_bytes() == text.encode(), 'full disk bytes differ'
    assert not s['dirty'] and s['version'] == s['savedVersion'], s
    return s

def shot(name):
    subprocess.run(['import', '-window', window, str(root / (name + '.png'))], check=True, timeout=10)

def record(name, state):
    results.append({'name': name, 'result': 'PASS', 'state': state})
    print('PASS ' + name, flush=True)

try:
    initial = start()
    newline_width = 1 if initial["backend"] == "editor" else 2
    for mode in ['source', 'live']:
        x.shortcut('1' if mode == 'source' else '2'); settled()
        x.shortcut('Home'); x.key('End')
        end = expected.index('\r\n'); position = utf16(expected[:end])
        state_is(position, False)
        for _ in range(20): x.key('a', delay=0)
        x.shortcut('s', delay=0)
        for _ in range(20): x.key('b', delay=0)
        s = state_is(position + 40, True)
        saved_snapshot = expected[:end] + 'a' * 20 + expected[end:]
        assert file.read_bytes() == saved_snapshot.encode(), 'save must stop at its event position'
        expected = expected[:end] + 'a' * 20 + 'b' * 20 + expected[end:]
        record(mode + ': rapid input/save/input preserves later dirty content', s)
        save(expected)
        end = expected.index('\r\n'); position = utf16(expected[:end])
        # Enter is an explicit structural history boundary, unlike adjacent
        # typing that may intentionally merge across a save.
        x.key('Return', delay=0); x.shortcut('s', delay=0); x.shortcut('z', delay=0)
        s = state_is(position, True)
        with_q = expected[:end] + '\r\n' + expected[end:]
        assert file.read_bytes() == with_q.encode(), 'undo must occur after the saved snapshot'
        record(mode + ': immediate undo after save is applied', s)
        x.shortcut('y', delay=0)
        for char in 'qrs': x.key(char, delay=0)
        x.shortcut('s', delay=0)
        expected = expected[:end] + '\r\nqrs' + expected[end:]
        s = settled()
        assert file.read_bytes() == expected.encode()
        assert not s['dirty'] and s['selection']['head'] == position + newline_width + 3, s
        record(mode + ': redo, continued input, save are ordered', s)
        end = expected.index('\r\n') + 5; position = utf16(expected[:end]) - (2 - newline_width)
        for _ in range(3): x.chord('Shift_L', 'Left')
        state_is(position - 3, False, position)
        save(expected)
        x.key('x', delay=0); x.shortcut('s', delay=0); x.shortcut('z', delay=0)
        s = state_is(position - 3, True, position)
        replaced = expected[:end-3] + 'x' + expected[end:]
        assert file.read_bytes() == replaced.encode()
        shot(mode + '-reverse-selection')
        x.shortcut('y'); state_is(position - 2, True)
        x.shortcut('z'); state_is(position - 3, True, position)
        x.key('y'); expected = expected[:end-3] + 'y' + expected[end:]
        s = save(expected)
        record(mode + ': directional selection, undo/redo and replacement persist', s)
        shot(mode + '-saved')
        stop(); s = start()
        assert file.read_bytes() == expected.encode()
        assert not s['dirty'] and s['version'] == 0 and s['savedVersion'] == 0, s
        x.shortcut('Home'); x.key('End')
        s = state_is(utf16(expected.split('\r\n')[0]), False)
        record(mode + ': normal CLI reopen matches bytes and UTF-16 end caret', s)
        if s['backend'] == 'native':
            x.shortcut('Home'); state_is(0, False)
            rows = expected.split('\r\n')
            target_line = min(41, len(rows))
            for _ in range(target_line-1): x.key('Down')
            head = utf16('\r\n'.join(rows[:target_line-1]) + '\r\n')
            s = state_is(head, False)
            c, v = s['cursorRect'], s['viewport']
            assert c and v['y'] <= c['y'] and c['y']+c['height'] <= v['y']+v['height']+2, s
            record(mode + ': repeated ArrowDown keeps the logical caret visible across windows', s)
except BaseException as error:
    (root / 'failure.json').write_text(json.dumps({'error': str(error), 'observation': observation()}, ensure_ascii=False, indent=2) + '\n')
    if window: shot('failure')
    raise
finally:
    (root / 'results.json').write_text(json.dumps({'driver': 'normal CLI + XTest; read-only observer', 'fixtureBytes': len(original.encode()), 'results': results}, ensure_ascii=False, indent=2) + '\n')
    stop()

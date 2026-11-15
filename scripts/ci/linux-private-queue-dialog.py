"""Native pointer input, with AT-SPI proof of the exact selected non-file queue."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import pyatspi

pid, queue, action = int(sys.argv[1]), sys.argv[2], sys.argv[3]
assert action in ('cancel', 'print')
assert Path(f'/proc/{pid}/exe').resolve() == Path(os.environ['TAURI_APP_PATH'])
assert b'--milkup-internal-output-helper' in Path(f'/proc/{pid}/cmdline').read_bytes()
desktop = pyatspi.Registry.getDesktop(0)
def walk(node, depth=0):
    assert depth < 30
    yield node
    for child in node:
        if child is not None:
            yield from walk(child, depth+1)
def get_nodes():
    for application in desktop:
        if application.get_process_id() == pid:
            for node in walk(application):
                if node.name == 'Print document' and node.getRoleName() in ('dialog', 'frame'):
                    return list(walk(node))
    return []
start = time.monotonic()
nodes = []
while time.monotonic() - start < 10:
    nodes = get_nodes()
    if any(n.name == queue for n in nodes):
        break
    time.sleep(.1)
assert nodes, 'Owned GTK print dialog must be accessible'
def visible(node):
    return node.getState().contains(pyatspi.STATE_SHOWING)
def click(node):
    assert visible(node) and node.getState().contains(pyatspi.STATE_SENSITIVE)
    rect = node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
    assert rect.width > 0 and rect.height > 0 and rect.x >= 0 and rect.y >= 0
    subprocess.run(['xdotool', 'mousemove', str(rect.x+rect.width//2), str(rect.y+rect.height//2), 'click', '1'], check=True, timeout=3)
    return {'name': node.name, 'role': node.getRoleName(), 'rect': [rect.x,rect.y,rect.width,rect.height]}
record = {'pid': pid, 'action': action, 'queue': queue, 'inputs': []}
targets = [n for n in nodes if n.name == queue and visible(n)]
assert targets, 'Private queue must actually appear in native dialog'
record['inputs'].append(click(targets[0]))
time.sleep(.2)
selected = []
for node in get_nodes():
    if node.getRoleName() in ('table', 'tree table'):
        table = node.queryTable()
        for row in table.getSelectedRows():
            selected.append([table.getAccessibleAt(row,col).name for col in range(table.nColumns)])
assert any(queue in row for row in selected), 'Selected queue identity must be observed before Print'
assert all('Print to File' not in row for row in selected)
record['selectedRows'] = selected
label = 'Cancel' if action == 'cancel' else 'Print'
buttons = [n for n in get_nodes() if n.getRoleName() == 'push button' and n.name.replace('_','') == label and visible(n)]
assert len(buttons) == 1, 'Unique owned native action button'
record['inputs'].append(click(buttons[0]))
print(json.dumps(record))

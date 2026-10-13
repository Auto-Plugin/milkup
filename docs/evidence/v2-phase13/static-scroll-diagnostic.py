import urllib.request,json,subprocess,sys,time,re,os,signal
from pathlib import Path
sys.path.insert(0,'tests/helpers')
from native_x11 import XTest
base='http://127.0.0.1:4444'
def req(method,route,data=None):
 r=urllib.request.Request(base+route,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)
 with urllib.request.urlopen(r,timeout=20) as out:return json.load(out)['value']
s=req('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'wry','tauri:options':{'application':str(Path('apps/desktop/src-tauri/target/debug/milkup-desktop').resolve())}}}})['sessionId']
def js(script):return req('POST',f'/session/{s}/execute/sync',{'script':script,'args':[]})
x=None
try:
 time.sleep(2)
 js("document.body.innerHTML='<div id=probe style=\"position:fixed;top:36px;left:0;width:1100px;height:694px;overflow:auto\"><div style=\"height:8000000px\">static text</div></div>'; window.mouseEvents=[]; for(const type of ['pointerdown','pointerup','mousedown','mouseup']) window.addEventListener(type,e=>mouseEvents.push({type,x:e.clientX,y:e.clientY,buttons:e.buttons,button:e.button}),true)")
 w=re.findall(r'(0x[0-9a-f]+) "milkup": \("milkup-desktop"',subprocess.check_output(['xwininfo','-root','-tree'],text=True))[0]
 x=XTest(w)
 for name,action in [('down',lambda:(x.move(1095,44),x.button(1,True))),('drag',lambda:x.move(1095,120)),('up',lambda:x.button(1,False)),('hover',lambda:x.move(100,400)),('click',lambda:x.click(100,400))]:
  action();time.sleep(.3);print(name,js('return {scroll:document.querySelector("#probe").scrollTop,events:mouseEvents}'),flush=True)
finally:
 if x:x.close()
 req('DELETE',f'/session/{s}')

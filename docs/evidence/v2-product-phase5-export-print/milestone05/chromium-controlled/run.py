import os,sys,json,struct,time,select,tempfile,pathlib,hashlib,shutil,threading,http.server,subprocess
root=pathlib.Path(__file__).parent
binary=pathlib.Path(os.environ['MILKUP_CHROMIUM_TEST_BINARY'])
expected_binary=os.environ['MILKUP_CHROMIUM_TEST_SHA']
assert hashlib.sha256(binary.read_bytes()).hexdigest()==expected_binary
requests=[]
class Sink(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  requests.append(self.path);self.send_response(200);self.end_headers();self.wfile.write(b'NETWORK_CONTENT_SHOULD_NOT_APPEAR')
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Sink)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
url='http://127.0.0.1:'+str(server.server_port)
secret=root/'self-owned-file-sentinel.html';secret.write_text('<p>FILE_CONTENT_SHOULD_NOT_APPEAR_82CF</p>')
svg=root/'self-owned-file-sentinel.svg';svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="60"><text x="0" y="30">FILE_SVG_SHOULD_NOT_APPEAR_6DB9</text></svg>')
png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWWQAAAAASUVORK5CYII='
cases={
 'security-script':f'''<!doctype html><html><head><meta charset="utf-8"></head><body><p id="state">SCRIPT_NOT_EXECUTED_4C71</p><script>document.getElementById('state').textContent='SCRIPT_EXECUTED_BAD_0A42';fetch('{url}/script-fetch')</script><img src="{url}/external-image"><img src="file://{svg}"><iframe src="file://{secret}"></iframe><object data="file://{secret}"></object><img src="data:image/png;base64,{png}"><p>END_SAFE_49D0</p></body></html>''',
 'security-resources':f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{url}/stylesheet"><style>@import url('{url}/css-import');@font-face{{font-family:remote;src:url('{url}/font')}}p{{font-family:remote,sans-serif;background-image:url('{url}/background')}}</style></head><body onload="document.getElementById('state').textContent='ONLOAD_EXECUTED_BAD'"><p id="state">RESOURCE_SAFE_795C</p><svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><script>fetch('{url}/svg-script')</script><text x="0" y="25">中文输入 冻结内容 打印</text><image href="file://{svg}" y="30" width="500" height="50"/><use href="{url}/external-svg#item"/></svg><embed src="file://{secret}"><p>END_SAFE_49D0</p></body></html>''',
 'unicode':pathlib.Path('/workspace/milkup-export-print-evidence/milestone05/native-unicode/baseline-fixture/unicode-baseline.html').read_text(),
 'real':pathlib.Path('/workspace/milkup-export-print-evidence/milestone01/native-ui/runs/p5-html-04/complete.html').read_text(),
 'pagination':pathlib.Path('/workspace/milkup-export-print-evidence/milestone05/content-pagination/baseline.html').read_text(),
 'compatibility':'<!doctype html><html><head><meta charset="utf-8"></head><body><p>STANDARD: 豈塚崎</p><p>COMPATIBILITY: 豈塚﨑</p><p>QUOTES: &quot;double&quot; &#39;single&#39; `backtick`</p><p>COMBINING: é é Å Å</p></body></html>'
}
report={'binary':str(binary),'binarySHA256':expected_binary,'listener':url,'requests':requests,'cases':[]}
try:
 for name,html in cases.items():
  (root/(name+'.html')).write_text(html)
  directory=pathlib.Path(tempfile.mkdtemp(prefix='milkup-output-'))
  value={'html':html,'pageSize':'letter' if name in ['unicode','pagination'] else 'a4','landscape':name in ['unicode','pagination'],'print':False,'choose':None,'directory':str(directory)}
  payload=json.dumps(value).encode();inputfile=directory/'input.frame';inputfile.write_bytes(struct.pack('<I',len(payload))+payload)
  inputfd=os.open(inputfile,os.O_RDONLY);reader,writer=os.pipe();stopreader,stopwriter=os.pipe();pid=os.fork()
  if pid==0:
   os.setsid();stdin=os.dup(inputfd);out=os.dup(writer);stop=os.dup(stopreader)
   os.dup2(stdin,0);os.dup2(out,3);os.dup2(stop,4)
   for fd in [inputfd,reader,writer,stopreader,stopwriter,stdin,out,stop]:
    if fd not in [0,3,4]:
     try:os.close(fd)
     except OSError:pass
   os.set_inheritable(3,True);os.set_inheritable(4,True)
   env=os.environ.copy();env['MILKUP_INTERNAL_OUTPUT_DIRECTORY']=str(directory);env['MILKUP_OUTPUT_TEST_HELPER']='1';env.pop('DISPLAY',None);env.pop('WAYLAND_DISPLAY',None)
   os.execve(binary,[str(binary),'output::linux::tests::native_output_helper','--exact','--ignored','--test-threads=1'],env)
  os.close(inputfd);os.close(writer);os.close(stopreader)
  buffer=b'';events=[];deadline=time.monotonic()+60;pdf=None
  item={'name':name,'inputSHA256':hashlib.sha256(html.encode()).hexdigest(),'events':events};report['cases'].append(item)
  try:
   while time.monotonic()<deadline:
    ready,_,_=select.select([reader],[],[],min(.2,max(0,deadline-time.monotonic())))
    if not ready:continue
    chunk=os.read(reader,65536)
    if not chunk:raise RuntimeError('helper result pipe closed')
    buffer+=chunk
    while len(buffer)>=4 and len(buffer)>=4+struct.unpack('<I',buffer[:4])[0]:
     length=struct.unpack('<I',buffer[:4])[0];assert length<1048576;event=json.loads(buffer[4:4+length]);buffer=buffer[4+length:];events.append(event)
     if event['type']=='failed':raise RuntimeError(event)
     if event['type']=='pdf':
      data=(directory/'document.pdf').read_bytes();assert data.startswith(b'%PDF-') and b'%%EOF' in data[-2048:]
      pdf=root/(name+'.pdf');assert not pdf.exists();pdf.write_bytes(data);break
    if pdf:break
   assert pdf,'render exceeded 60 seconds'
  finally:
   os.close(stopwriter);os.close(reader)
   cleanup=time.monotonic()+5
   while True:
    done,status=os.waitpid(pid,os.WNOHANG)
    if done:break
    if time.monotonic()>=cleanup:raise RuntimeError('guardian cleanup exceeds 5 seconds; stage retained')
    time.sleep(.01)
   item['guardianExit']=os.waitstatus_to_exitcode(status);assert item['guardianExit']==0
   shutil.rmtree(directory)
  subprocess.run(['pdftotext','-raw',str(pdf),str(root/(name+'.raw.txt'))],check=True)
  text=(root/(name+'.raw.txt')).read_text();item.update({'pdf':str(pdf),'pdfBytes':pdf.stat().st_size,'pdfSHA256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'pdfInfo':subprocess.check_output(['pdfinfo',str(pdf)],text=True),'requestsSoFar':list(requests)})
  if name.startswith('security'):
   item['safety']={'noScriptMutation':'SCRIPT_EXECUTED_BAD' not in text and 'ONLOAD_EXECUTED_BAD' not in text,'noFileContent':'FILE_CONTENT_SHOULD_NOT_APPEAR' not in text and 'FILE_SVG_SHOULD_NOT_APPEAR' not in text,'noListenerRequests':not requests,'expectedContent':('SCRIPT_NOT_EXECUTED_4C71' if name=='security-script' else 'RESOURCE_SAFE_795C') in text and 'END_SAFE_49D0' in text};assert all(item['safety'].values()),item
  print(json.dumps(item,ensure_ascii=False),flush=True)
 report['status']='PASS'
except Exception as e:report['status']='FAIL';report['error']=repr(e);raise
finally:
 server.shutdown();server.server_close();thread.join(2);(root/'execution.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')

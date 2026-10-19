import os,sys,json,struct,time,select,tempfile,pathlib,hashlib,shutil
root=pathlib.Path(__file__).parent
binary=pathlib.Path('/workspace/milkup-export-print-evidence/milestone01/production-heading-blocks/milkup-desktop')
assert hashlib.sha256(binary.read_bytes()).hexdigest()=='f29911982fc0d6e26d15ef572156c0c29d2fc2140ace6d2d7914b456e9635d98'
guard=pathlib.Path('/workspace/milkup/apps/desktop/src-tauri/target/release/build/milkup-desktop-2c39bf60742e8c2c/out/libmilkup_output_guard.so')
results=[]
variants=os.environ.get('MILKUP_CSS_VARIANTS','baseline,candidate').split(',')
for name in variants:
 directory=pathlib.Path(tempfile.mkdtemp(prefix='milkup-output-'))
 shutil.copyfile(guard,directory/'libmilkup_output_guard.so')
 value={'html':(root/(name+'.html')).read_text(),'pageSize':'letter','landscape':True,'print':False,'choose':None,'directory':str(directory)}
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
  env=os.environ.copy();env['MILKUP_INTERNAL_OUTPUT_DIRECTORY']=str(directory)
  os.execve(binary,[str(binary),'--milkup-internal-output-helper'],env)
 os.close(inputfd);os.close(writer);os.close(stopreader)
 buffer=b'';events=[];deadline=time.monotonic()+60;pdf=None
 try:
  while time.monotonic()<deadline:
   ready,_,_=select.select([reader],[],[],min(.2,max(0,deadline-time.monotonic())))
   if not ready:continue
   chunk=os.read(reader,65536)
   if not chunk:raise RuntimeError('helper result pipe closed')
   buffer+=chunk
   while len(buffer)>=4 and len(buffer)>=4+struct.unpack('<I',buffer[:4])[0]:
    length=struct.unpack('<I',buffer[:4])[0];event=json.loads(buffer[4:4+length]);buffer=buffer[4+length:];events.append(event)
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
  assert os.waitstatus_to_exitcode(status)==0
  shutil.rmtree(directory)
 result={'variant':name,'events':events,'pdf':str(pdf),'sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'guardSha256':hashlib.sha256(guard.read_bytes()).hexdigest(),'guardianExit':os.waitstatus_to_exitcode(status)};results.append(result);print(json.dumps(result),flush=True)
(root/('execution-'+','.join(variants)+'.json')).write_text(json.dumps(results,indent=2)+'\n')

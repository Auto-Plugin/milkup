import hashlib,json,os,pathlib,select,socket,struct,subprocess,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'support'))
import process_capture as m
import observed_render,calibrate

class Capture(unittest.TestCase):
 def test_full_collector_with_real_synthetic_executable_and_mapped_libraries(self):
  import shutil,time
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);out=root/'out';out.mkdir()
   source=root/'library.c';source.write_text('int synthetic_value(void) { return 1; }\n')
   libraries=[root/'libwebkit2gtk-4.1.so.test',root/'libjavascriptcoregtk-4.1.so.test']
   subprocess.run(['cc','-shared','-fPIC',str(source),'-o',str(libraries[0])],check=True)
   shutil.copyfile(libraries[0],libraries[1])
   source=root/'sender.c';source.write_text('#include <dlfcn.h>\n#include <unistd.h>\n#include <stdio.h>\nint main(int n,char**v){if(!dlopen(v[1],RTLD_NOW)||!dlopen(v[2],RTLD_NOW))return 2; const char line[]="MILKUP_PAGINATION {\\\"seq\\\":1}\\n";write(2,line,sizeof(line)-1);getchar();return 0;}\n')
   binary=root/'WebKitWebProcess';subprocess.run(['cc',str(source),'-ldl','-o',str(binary)],check=True)
   seen={};observer=m.Observer(pathlib.Path(sys.executable).resolve(),out,seen);p=None
   observer.__enter__()
   try:
    p=subprocess.Popen([str(binary),*map(str,libraries)],stderr=observer.sender,stdin=subprocess.PIPE)
    observer.start(calibrate.proc(os.getpid()))
    deadline=time.monotonic()+3
    while not observer.records and time.monotonic()<deadline:observer.changed.wait(.02)
    self.assertEqual(len(observer.records),1)
    p.stdin.close();self.assertEqual(p.wait(timeout=3),0)
    status=pathlib.Path('/proc/self/status').read_text()
    if 'NoNewPrivs:\t1' in status and 'Seccomp:\t2' in status:observer.__exit__(None,None,None)
    else:
     with self.assertRaises(AssertionError):observer.__exit__(None,None,None)
    self.assertEqual(len(seen),1)
    row=next(iter(seen.values()));self.assertEqual(row['pid'],p.pid)
    self.assertEqual(set(row['libraries']),set(map(str,libraries)))
    self.assertEqual(row['pidfdId'],observer.records[0]['pidfdId'])
   finally:
    if p and p.poll()is None:p.kill();p.wait()
    if not observer.stop.is_set():
     try:observer.__exit__(None,None,None)
     except AssertionError:pass
 def test_real_child_sender_and_pidfd_survive_exit(self):
  channel=m.Channel()
  try:
   code='import os,sys; os.write(2,b"first\\n"); sys.stdin.buffer.read(1); os.write(2,b"last\\n")'
   p=subprocess.Popen([sys.executable,'-c',code],stderr=channel.sender,stdin=subprocess.PIPE)
   try:
    self.assertTrue(select.select([channel.receiver],[],[],3)[0]);data,first=channel.receive()
    held=os.pidfd_open(p.pid,0)
    try:self.assertEqual(first['pidfdId'],m.pidfd_identity(held))
    finally:os.close(held)
    self.assertEqual(first['pid'],p.pid);self.assertEqual(data,b'first\n')
    p.stdin.write(b'x');p.stdin.close();self.assertEqual(p.wait(timeout=3),0)
    data,last=channel.receive()
    self.assertEqual(last,first);self.assertEqual(data,b'last\n')
    self.assertNotEqual(first['pid'],os.getpid())
   finally:
    if p.poll()is None:p.kill();p.wait()
  finally:channel.close()
 def test_grandchild_credentials_are_not_parent_credentials(self):
  channel=m.Channel()
  try:
   code='import os; p=os.fork();\nif p==0: os.write(2,b"grandchild\\n"); os._exit(0)\nos.waitpid(p,0)'
   p=subprocess.Popen([sys.executable,'-c',code],stderr=channel.sender)
   self.assertTrue(select.select([channel.receiver],[],[],3)[0]);data,row=channel.receive();p.wait(timeout=3)
   self.assertNotEqual(row['pid'],p.pid);self.assertEqual(data,b'grandchild\n')
  finally:channel.close()
 def test_record_binding_rejects_ui_wrong_generation_missing_and_tampered(self):
  line=b'MILKUP_PAGINATION {"seq":1}\n'
  row={'pid':17,'uid':os.getuid(),'pidfdId':'4:99','sha256':hashlib.sha256(line).hexdigest()}
  process={'pid':17,'uid':os.getuid(),'image':'/private/WebKitWebProcess','noNewPrivs':1,'seccomp':2,'capEff':0}
  self.assertEqual(m.bind_records(line,[row],{'4:99':process}),'4:99')
  for processes in [{},{'4:100':process},{'4:99':{**process,'image':'/usr/bin/milkup-desktop'}},{'4:99':{**process,'seccomp':0}},{'4:99':{**process,'pid':18}}]:
   with self.assertRaises(AssertionError):m.bind_records(line,[row],processes)
  with self.assertRaises(AssertionError):m.bind_records(line+b'MILKUP_PAGINATION {}\n',[row],{'4:99':process})
  with self.assertRaises(AssertionError):m.bind_records(line.replace(b'1',b'2'),[row],{'4:99':process})
 def test_mapped_inode_path_mismatch_rejected(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=pathlib.Path(tmp)/'libwebkit2gtk-4.1.so.0';p.write_bytes(b'x')
   with self.assertRaises(AssertionError):m.mapped_files(f'100-200 r-xp 0 00:00 1 {p}\n')
 def test_original_render_flow_diff_is_only_observer_wiring(self):
  import inspect
  original=inspect.getsource(calibrate.render)
  expected=original.replace("with (out/'native.log').open('wb') as log:","with Observer(binary,out,seen) as observer:").replace('stderr=log,pass_fds=','stderr=observer.sender,pass_fds=').replace("root=proc(p.pid);report['guardianIdentity']","root=proc(p.pid);observer.start(root);report['guardianIdentity']").replace('sample_owned(root,binary,out,seen);next_sample=time.monotonic()+.05','next_sample=time.monotonic()+.05 # fast collector runs independently')
  self.assertEqual(inspect.getsource(observed_render.render),expected)
 def test_slow_window_collection_cannot_block_credential_receiver(self):
  # A real kernel channel remains usable while unrelated window work waits.
  import threading,time
  channel=m.Channel();release=threading.Event();thread=threading.Thread(target=lambda:release.wait(3));thread.start()
  try:
   channel.sender.send(b'not-a-layout-record\n')
   self.assertTrue(select.select([channel.receiver],[],[],.2)[0]);_,row=channel.receive();self.assertEqual(row['pid'],os.getpid());self.assertTrue(thread.is_alive())
  finally:release.set();thread.join();channel.close()

if __name__=='__main__':unittest.main()

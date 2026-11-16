"""Passive, kernel-attributed stderr and independent fast process/window capture.

No engine/guard modification, ptrace, signals, sandbox or policy changes.
Linux >=6.9, 64-bit pidfs identities and SO_PASSPIDFD are mandatory.
"""
import hashlib,json,os,pathlib,re,select,socket,struct,subprocess,threading,time
import calibrate

PREFIX=b'MILKUP_PAGINATION '
SO_PASSPIDFD=76  # Linux uapi asm-generic/socket.h
SCM_PIDFD=4     # Linux uapi SCM_PIDFD, not a sender-supplied numeric PID.

def pidfd_identity(fd):
 st=os.fstat(fd)
 assert struct.calcsize('P')==8 and st.st_ino>0,'64-bit pidfs required'
 return f'{st.st_dev}:{st.st_ino}'

class Channel:
 def __init__(self):
  version=tuple(map(int,re.match(r'(\d+)\.(\d+)',os.uname().release).groups()))
  assert version>=(6,9),'Stable pidfs identities require Linux 6.9+'
  self.receiver,self.sender=socket.socketpair(socket.AF_UNIX,socket.SOCK_DGRAM|socket.SOCK_CLOEXEC)
  self.receiver.setsockopt(socket.SOL_SOCKET,socket.SO_PASSCRED,1)
  self.receiver.setsockopt(socket.SOL_SOCKET,SO_PASSPIDFD,1)
  self.receiver.setblocking(False)
 def receive(self):
  data,anc,flags,_=self.receiver.recvmsg(65536,socket.CMSG_SPACE(12)+socket.CMSG_SPACE(4),socket.MSG_CMSG_CLOEXEC)
  fds=[];credentials=[]
  try:
   for level,kind,value in anc:
    if level==socket.SOL_SOCKET and kind==SCM_PIDFD:
     assert len(value)==4;fds.append(struct.unpack('i',value)[0])
    elif level==socket.SOL_SOCKET and kind==socket.SCM_CREDENTIALS:
     assert len(value)==12;credentials.append(struct.unpack('3i',value))
    else:raise AssertionError('Unexpected ancillary data')
   assert not flags&(socket.MSG_TRUNC|socket.MSG_CTRUNC),'Truncated credentialled stderr'
   assert len(fds)==len(credentials)==1,'Per-message credentials and pidfd required'
   pid,uid,gid=credentials[0];assert pid>0 and uid==os.getuid(),'Owned kernel sender required'
   return data,{'pid':pid,'uid':uid,'gid':gid,'pidfdId':pidfd_identity(fds[0])}
  finally:
   for fd in fds:os.close(fd)
 def close(self):self.receiver.close();self.sender.close()

def mapped_files(maps):
 result={}
 for line in maps.splitlines():
  fields=line.split(None,5)
  if len(fields)!=6:continue
  address,perms,offset,dev,inode,path=fields
  if not any(s in path for s in ['libwebkit2gtk-4.1.so.','libjavascriptcoregtk-4.1.so.']):continue
  assert not path.endswith(' (deleted)'),'Deleted mapped runtime'
  st=pathlib.Path(path).stat();major,minor=(int(v,16)for v in dev.split(':'))
  assert st.st_ino==int(inode) and (os.major(st.st_dev),os.minor(st.st_dev))==(major,minor),'Mapped inode/path mismatch'
  result[path]={'device':st.st_dev,'inode':st.st_ino,'bytes':st.st_size,'mtimeNs':st.st_mtime_ns,'ctimeNs':st.st_ctime_ns}
 assert len(result)==2,'Both private libraries must be mapped'
 return result

def bind_records(log,rows,processes):
 lines=[line for line in log.splitlines(keepends=True)if line.startswith(PREFIX)]
 assert lines and len(lines)==len(rows),'Every native record needs a sender'
 identities=set()
 for line,row in zip(lines,rows):
  assert hashlib.sha256(line).hexdigest()==row['sha256'],'Record bytes/attribution mismatch'
  identity=row['pidfdId'];process=processes.get(identity)
  assert process is not None and process['pid']==row['pid'] and process['uid']==row['uid'],'No live same-generation identity capture'
  assert 'WebKitWebProcess'in process['image'],'UI process cannot substitute for WebProcess'
  assert process['noNewPrivs']==1 and process['seccomp']==2 and process['capEff']==0,'Default WebProcess sandbox required'
  identities.add(identity)
 assert len(identities)==1,'One actual WebProcess per document required'
 return next(iter(identities))

class Observer:
 def __init__(self,binary,out,seen):
  self.binary=binary;self.out=out;self.seen=seen;self.channel=Channel();self.sender=self.channel.sender
  self.stop=threading.Event();self.changed=threading.Event();self.lock=threading.Lock()
  self.processes={};self.held={};self.records=[];self.errors=[];self.buffers={};self.threads=[];self.total=0
 def __enter__(self):
  self.log=(self.out/'native.log').open('wb');return self
 def start(self,root):
  self.root=root;self.sender.close()
  self.threads=[threading.Thread(target=self._collect,daemon=True),threading.Thread(target=self._windows,daemon=True)]
  for t in self.threads:t.start()
 def _error(self,phase,pid,error):
  with self.lock:
   if len(self.errors)<128:self.errors.append({'phase':phase,'pid':pid,'error':repr(error),'tick':time.monotonic_ns()})
 def _capture(self,pid,required_id=None):
  fd=None
  try:
   fd=os.pidfd_open(pid,0);identity=pidfd_identity(fd)
   assert required_id is None or identity==required_id,'PID reused before live capture'
   with self.lock:
    if identity in self.processes:return self.processes[identity]
   lineage=calibrate.prove_chain(pid,self.root,self.binary,reader=calibrate.proc)
   maps=(pathlib.Path('/proc')/str(pid)/'maps').read_text()
   assert len(maps.encode())<4*1024*1024,'Bounded maps capture'
   if 'libwebkit2gtk-4.1.so.'not in maps:return None
   files=mapped_files(maps)
   again=calibrate.proc(pid)
   assert all(again[k]==lineage[0][k]for k in ['pid','parent','birth','image','uid'])
   exe=(pathlib.Path('/proc')/str(pid)/'exe').stat();image=pathlib.Path(again['image']).stat()
   assert (exe.st_dev,exe.st_ino)==(image.st_dev,image.st_ino),'Executable path/instance mismatch'
   status=(pathlib.Path('/proc')/str(pid)/'status').read_text()
   row={**lineage[0],'pidfdId':identity,'lineage':lineage,'libraries':sorted(files),'mappedFiles':files,'capturedTick':time.monotonic_ns(),'windows':[]}
   row['imageFile']={'device':exe.st_dev,'inode':exe.st_ino,'bytes':exe.st_size,'mtimeNs':exe.st_mtime_ns,'ctimeNs':exe.st_ctime_ns}
   for key,field in [('NoNewPrivs','noNewPrivs'),('Seccomp','seccomp')]:row[field]=int(re.search(r'^'+key+r':\s+(\d+)$',status,re.M)[1])
   row['capEff']=int(re.search(r'^CapEff:\s+([0-9a-fA-F]+)$',status,re.M)[1],16)
   row['namespacePids']=list(map(int,re.search(r'^NSpid:\s+(.+)$',status,re.M)[1].split()))
   (self.out/f'process-{pid}-{row["birth"]}.maps').write_text(maps)
   with self.lock:
    assert len(self.processes)<32,'Process budget'
    self.processes[identity]=row;self.held[identity]=fd;fd=None
   self.changed.set();return row
  except (OSError,ValueError,AssertionError)as error:self._error('live-capture',pid,error);return None
  finally:
   if fd is not None:os.close(fd)
 def _scan(self):
  table={}
  for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
   try:
    fields=p.read_text().rsplit(') ',1)[1].split();table[int(p.parent.name)]=int(fields[1])
   except (OSError,ValueError):continue
  owned={self.root['pid']}
  for _ in range(16):
   more={pid for pid,parent in table.items()if parent in owned}
   if more<=owned:break
   owned|=more
  for pid in sorted(owned):self._capture(pid)
 def _packet(self,data,credential):
  self.total+=len(data);assert self.total<=2*1024*1024,'Native log budget'
  self.log.write(data)
  identity=credential['pidfdId']
  self._capture(credential['pid'],identity)
  # Never join partial bytes from different process generations.
  pending=self.buffers.get(identity,b'')+data;pieces=pending.split(b'\n');self.buffers[identity]=pieces.pop()
  assert len(self.buffers[identity])<=65536,'Unbounded partial record'
  for line in pieces:
   if line.startswith(PREFIX):
    assert len(self.records)<4096
    self.records.append({**credential,'sha256':hashlib.sha256(line+b'\n').hexdigest(),'receivedTick':time.monotonic_ns()})
 def _collect(self):
  next_scan=0
  try:
   while True:
    ready,_,_=select.select([self.channel.receiver],[],[],.02)
    if ready:
     while True:
      try:data,credential=self.channel.receive()
      except BlockingIOError:break
      self._packet(data,credential)
    if self.stop.is_set():break # queue drained before closing, after final PDF result
    if time.monotonic()>=next_scan:self._scan();next_scan=time.monotonic()+.02
  except Exception as error:self._error('collector-fatal',0,error)
 def _windows(self):
  while not self.stop.is_set():
   with self.lock:rows=[r.copy()for r in self.processes.values()if r['image']==str(self.binary)and r['pid']!=self.root['pid']and not r['windows']]
   for row in rows:
    pid=row['pid']
    try:
     windows=subprocess.check_output(['xdotool','search','--all','--pid',str(pid),'--name','^Document output$'],text=True,stderr=subprocess.DEVNULL,timeout=.25).split()
     for w in windows:
      before=calibrate.prove_chain(pid,self.root,self.binary,reader=calibrate.proc)
      assert before[0]['birth']==row['birth']
      owner=int(subprocess.check_output(['xdotool','getwindowpid',w],text=True,timeout=.25))
      prop=subprocess.check_output(['xprop','-id',w,'_NET_WM_PID'],text=True,timeout=.25)
      assert owner==pid==int(re.search(r'=\s*(\d+)\s*$',prop)[1])
      geometry=subprocess.check_output(['xwininfo','-id',w],text=True,timeout=.25)
      assert int(subprocess.check_output(['xdotool','getwindowpid',w],text=True,timeout=.25))==pid
      after=calibrate.prove_chain(pid,self.root,self.binary,reader=calibrate.proc);assert before==after
      with self.lock:self.processes[row['pidfdId']]['windows'].append({'id':w,'pid':pid,'birth':row['birth'],'ownerProperty':prop,'geometry':geometry})
    except (OSError,ValueError,AssertionError,subprocess.SubprocessError)as error:self._error('window',pid,error)
   self.changed.wait(.02);self.changed.clear()
 def __exit__(self,kind,value,tb):
  self.stop.set();self.changed.set()
  for thread in self.threads:thread.join(timeout=3)
  alive=any(t.is_alive()for t in self.threads)
  self.log.flush();self.log.close();self.channel.close()
  with self.lock:
   for row in self.processes.values():self.seen[(row['pid'],row['birth'])]=row
  result={'status':'captured-not-yet-bound','records':self.records,'processes':self.processes,'errors':self.errors,'bytes':self.total,'threadsStopped':not alive}
  try:
   assert not alive and not any(e['phase']=='collector-fatal'for e in self.errors),'Collector incomplete'
   assert not any(v.startswith(PREFIX)for v in self.buffers.values()),'Partial native record'
   result['webProcessPidfdId']=bind_records((self.out/'native.log').read_bytes(),self.records,self.processes)
   result['status']='kernel-sender-bound'
  except Exception as error:result.update(status='failed',error=repr(error))
  finally:
   for fd in self.held.values():os.close(fd)
   (self.out/'process-capture.json').write_text(json.dumps(result,indent=2)+'\n')
  assert result['status']=='kernel-sender-bound',result.get('error')

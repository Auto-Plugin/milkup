"""Bounded complete-stream accounting. No full trace file or discarded unknown events.
A successful stream alone is NOT a successful/generated WebKit configuration.
"""
from pathlib import Path
import hashlib,json,os,re,stat,time,signal,subprocess,selectors,math
class Rejected(Exception):pass
def need(v,s):
 if not v:raise Rejected(s)
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def unique_pairs(pairs):
 d={}
 for k,v in pairs:
  need(k not in d,'Duplicate JSON field');d[k]=v
 return d
def bad_constant(value):raise Rejected('Non-finite JSON number')
def encode(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
class Trace:
 MAX_LINE=2*1024**2;MAX_FILES=4096;MAX_GROUPS=16384;MAX_EVIDENCE=8*1024**2;MAX_VARIANTS=128;MAX_METADATA=8*1024**2;MAX_STREAM=1024**3;MAX_EVENTS=2000000
 def __init__(self,obligations,mounts):
  self.mounts=sorted([(str(k).rstrip('/'),Path(v).resolve()) for k,v in mounts.items()],key=lambda x:-len(x[0]));self.items=obligations['items'];self.sites={};self.files={};self.groups={};self.header=False;self.events=0;self.unmatched=0;self.bytes=0;self.sha=hashlib.sha256();self.pending=b'';self.evidence=0;self.finished=False;self.metadata=0;self.path_cache={}
  self.rows=[]
  for item in self.items:
   key=(item['file'],item['line'],item['command']);need(key not in self.sites,'Duplicate obligation');self.sites[key]=len(self.rows)
   logical,p=self.path(item['file']);need(digest(p)==item['sourceSha256'],'Obligation source changed');self.rows.append({'id':item['id'],'file':logical,'line':item['line'],'command':item['command'],'sourceSha256':item['sourceSha256'],'count':0,'variants':{},'hash':hashlib.sha256()})
 def path(self,raw):
  need(len(self.path_cache)<=self.MAX_FILES*2,'Source alias catalog bound')
  if raw in self.path_cache:return self.path_cache[raw]
  need(isinstance(raw,str) and len(raw)<=4096 and raw.startswith('/') and str(Path(raw))==raw and '..' not in Path(raw).parts and '\x00' not in raw,'Invalid source path')
  for logical,root in self.mounts:
   if raw==logical or raw.startswith(logical+'/'):
    p=root/raw[len(logical):].lstrip('/');resolved=p.resolve();need(resolved.is_relative_to(root),'Source escaped bound root');need(resolved.is_file() and stat.S_ISREG(resolved.stat().st_mode),'Missing/nonregular trace source');need(resolved.stat().st_size<=32*1024**2,'Source file evidence bound');self.path_cache[raw]=(raw,resolved);return raw,resolved
   if raw==str(root) or raw.startswith(str(root)+'/'):
    resolved=Path(raw).resolve();need(resolved.is_relative_to(root),'Source escaped bound root');need(resolved.is_file() and stat.S_ISREG(resolved.stat().st_mode),'Missing/nonregular trace source');need(resolved.stat().st_size<=32*1024**2,'Source file evidence bound');value=(logical+'/'+str(Path(raw).relative_to(root)),resolved);self.path_cache[raw]=value;return value
  raise Rejected('Unbound trace source: '+raw)
 def feed(self,data):
  need(not self.finished,'Data after finalization');self.sha.update(data);self.bytes+=len(data);need(self.bytes<=self.MAX_STREAM,'Stream processing budget');self.pending+=data
  while b'\n' in self.pending:
   line,self.pending=self.pending.split(b'\n',1);need(len(line)<=self.MAX_LINE,'Trace record bound');self.record(line)
  need(len(self.pending)<=self.MAX_LINE,'Trace record bound')
 def record(self,line):
  r=json.loads(line,object_pairs_hook=unique_pairs,parse_constant=bad_constant);need(isinstance(r,dict),'Trace object required')
  if not self.header:
   need(set(r)=={'version'} and r['version']=={'major':1,'minor':2} and all(type(v) is int for v in r['version'].values()),'Unsupported trace header');self.header=True;return
  need(set(r)<= {'args','cmd','file','frame','global_frame','line','line_end','time'} and {'args','cmd','file','line'}<=set(r),'Unknown/missing trace event fields')
  need(isinstance(r['args'],list) and all(isinstance(a,str) for a in r['args']),'Invalid arguments')
  need(isinstance(r['cmd'],str) and re.fullmatch('[A-Za-z_][A-Za-z_0-9]*',r['cmd']) and len(r['cmd'])<=256,'Invalid command')
  need(type(r['line']) is int and r['line']>0,'Invalid line')
  for field in ['frame','global_frame','line_end']:
   if field in r:need(type(r[field]) is int and r[field]>0,'Invalid numeric field')
  if 'time' in r:need(type(r['time']) in (int,float) and math.isfinite(r['time']),'Invalid timestamp')
  logical,p=self.path(r['file']);cmd=r['cmd'].lower()
  if logical not in self.files:
   need(len(self.files)<self.MAX_FILES,'Source catalog bound');self.metadata+=len(logical.encode())+128;need(self.metadata<=self.MAX_METADATA,'Metadata evidence bound');self.files[logical]={'path':p,'sha256':digest(p),'events':0}
  self.files[logical]['events']+=1
  group=(logical,r['line'],cmd);argument_bytes=encode(r['args']);argument_hash=hashlib.sha256(argument_bytes).hexdigest()
  dependency=cmd in {'find_package','find_program','find_library','find_path','find_file','include','add_subdirectory','execute_process','try_compile','try_run','pkg_check_modules','pkg_search_module'} or cmd.startswith('find_')
  if group not in self.groups:
   need(len(self.groups)<self.MAX_GROUPS,'Command catalog bound');self.metadata+=len(logical.encode())+len(cmd)+256;need(self.metadata<=self.MAX_METADATA,'Metadata evidence bound')
   self.groups[group]={'count':0,'hash':hashlib.sha256(),'dependency':dependency,'variants':{},'firstArgumentSha256':argument_hash,'firstArgumentBytes':len(argument_bytes)}
  g=self.groups[group];g['count']+=1;g['hash'].update(len(argument_bytes).to_bytes(8,'big')+argument_bytes);g['lastArgumentSha256']=argument_hash;g['lastArgumentBytes']=len(argument_bytes)
  if dependency:
   if argument_hash not in g['variants']:
    need(len(g['variants'])<self.MAX_VARIANTS,'Dependency-site variant bound');self.evidence+=len(argument_bytes);need(self.evidence<=self.MAX_EVIDENCE,'Dependency argument evidence bound');g['variants'][argument_hash]={'args':r['args'],'count':0}
   g['variants'][argument_hash]['count']+=1
  self.events+=1;need(self.events<=self.MAX_EVENTS,'Event processing budget')
  key=(logical,r['line'],cmd)
  if key in self.sites:
   row=self.rows[self.sites[key]];row['count']+=1;b=encode(r['args']);row['hash'].update(len(b).to_bytes(8,'big')+b);h=hashlib.sha256(b).hexdigest()
   if h not in row['variants']:
    need(len(row['variants'])<self.MAX_VARIANTS,'Required-site variant bound');self.evidence+=len(b);need(self.evidence<=self.MAX_EVIDENCE,'Required-site evidence bound');row['variants'][h]={'args':r['args'],'count':0}
   row['variants'][h]['count']+=1
  else:self.unmatched+=1
 def finish(self,*,exit_code,eof,process_exited,stopped=None):
  self.finished=True
  errors=[]
  if not self.header:errors.append('Missing trace header')
  if self.pending:errors.append('Unterminated/truncated final record')
  if not eof:errors.append('Trace writer EOF not proven')
  if not process_exited:errors.append('Process exit not proven')
  if exit_code!=0:errors.append('CMake nonzero/absent exit')
  if stopped:errors.append(stopped)
  for name,f in self.files.items():
   try:need(digest(f['path'])==f['sha256'],'Trace source changed: '+name)
   except Exception as e:errors.append(str(e))
  for item in self.items:
   try:
    _,p=self.path(item['file']);need(digest(p)==item['sourceSha256'],'Obligation source changed')
   except Exception as e:errors.append(str(e))
  if sum(r['count'] for r in self.rows)+self.unmatched!=self.events:errors.append('Event accounting incomplete after rejected record')
  complete=not errors;rows=[]
  for r in self.rows:
   rows.append({**{k:v for k,v in r.items() if k not in ('hash','variants')},'argumentsSha256':r['hash'].hexdigest(),'argumentVariants':list(r['variants'].values()),'status':'observed' if r['count'] else ('not-executed-in-complete-trace' if complete else 'unresolved')})
  return {'schema':1,'complete':complete,'errors':errors,'exitCode':exit_code,'eof':eof,'processExited':process_exited,'rawBytes':self.bytes,'rawSha256':self.sha.hexdigest(),'events':self.events,'unmatchedEvents':self.unmatched,'unknownEventsDiscarded':0,'sourceFiles':{k:{'sha256':v['sha256'],'events':v['events']} for k,v in self.files.items()},'commandGroups':[{'file':k[0],'line':k[1],'command':k[2],**{a:b for a,b in v.items() if a not in ('hash','variants')},'argumentsSha256':v['hash'].hexdigest(),'argumentVariants':list(v['variants'].values()),'semanticStatus':'dependency-arguments-observed' if v['dependency'] else 'unclassified-command-accounted'} for k,v in sorted(self.groups.items())],'items':rows,'retainedArgumentBytes':self.evidence,'pendingBytes':len(self.pending),'metadataBytes':self.metadata,'configurationArtifactsVerified':False,'resourceExecuted':False}

def run_traced(argv,*,fifo,log,obligations,mounts,env,cwd,timeout,room,drain_seconds=3):
 started=time.monotonic();trace=Trace(obligations,mounts)
 fifo=Path(fifo);log=Path(log);need(not fifo.exists(),'FIFO destination occupied');os.mkfifo(fifo,0o600)
 fd=os.open(fifo,os.O_RDONLY|os.O_NONBLOCK);sel=selectors.DefaultSelector();sel.register(fd,selectors.EVENT_READ)
 proc=None;seen=False;eof=False;stopped=None;deadline=time.monotonic()+timeout;exit_time=None
 try:
  with log.open('xb') as out:
   proc=subprocess.Popen(argv,stdout=out,stderr=subprocess.STDOUT,env=env,cwd=cwd,start_new_session=True)
   while True:
    room();now=time.monotonic()
    if now>=deadline:raise Rejected('Trace stage deadline')
    if log.stat().st_size>8*1024**2:raise Rejected('Stage diagnostic log bound')
    for _,_ in sel.select(.05):
     b=os.read(fd,65536)
     if b:
      need(not eof,'Writer reopened after EOF');seen=True;trace.feed(b)
     elif seen:eof=True
     else:time.sleep(.01)
    code=proc.poll()
    if code is not None:
     if exit_time is None:exit_time=now
     if eof:break
     if now-exit_time>=drain_seconds:raise Rejected('Exited process without proven trace EOF')
    # FIFO EOF before process exit is valid only if eventual process/artifact gates pass.
    if eof:time.sleep(.01)
 except Exception as e:stopped=type(e).__name__+': '+str(e)
 finally:
  if proc is not None and (proc.poll() is None or stopped):
   # Includes descendants holding a writer after their parent exits.
   try:os.killpg(proc.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:proc.wait(timeout=2)
   except subprocess.TimeoutExpired:
    try:os.killpg(proc.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    proc.wait(timeout=2)
  sel.close();os.close(fd);fifo.unlink()
 result=trace.finish(exit_code=proc.returncode if proc else None,eof=eof,process_exited=proc is not None and proc.poll() is not None,stopped=stopped)
 result.update(elapsedSeconds=time.monotonic()-started,commandSha256=hashlib.sha256(encode(argv)).hexdigest(),diagnosticLogSha256=digest(log) if log.exists() else None)
 if not result['complete'] and log.exists():
  with log.open('rb') as f:
   f.seek(max(0,log.stat().st_size-4096));result['diagnosticTail']=f.read().decode(errors='replace')
 return result

def require_complete(summary):
 need(summary['complete'] is True and summary['exitCode']==0 and summary['eof'] is True and summary['processExited'] is True and not summary['errors'],'Complete successful CMake stream required')
 need(summary['events']>0 and summary['unknownEventsDiscarded']==0,'Actual fully-accounted events required')

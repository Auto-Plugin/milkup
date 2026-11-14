import pathlib,sys,time,json,hashlib
trace=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);binary=sys.argv[3]
out.mkdir(parents=True,exist_ok=True);deadline=time.monotonic()+180;seen={};errors=[];hashes={}
while time.monotonic()<deadline:
 try:lines=trace.read_text().splitlines()
 except FileNotFoundError:lines=[]
 for pid in {int(line.split()[0].split('=')[1]) for line in lines if line.startswith('pid=')}:
  q=pathlib.Path('/proc')/str(pid)
  try:
   args=[x.decode() for x in (q/'cmdline').read_bytes().split(b'\0') if x]
   if not args or args[0]!=binary:continue
   stat=(q/'stat').read_text();birth=stat[stat.rfind(')')+2:].split()[19];key=(pid,birth)
   count=sum(line.startswith(f'pid={pid} ') for line in lines);prior=seen.get(key,{'count':-1,'snapshots':0})
   if count==prior['count'] or prior['snapshots']>=8:continue
   maps=(q/'maps').read_text();index=prior['snapshots']+1
   (out/f'{pid}-{birth}-{index}.maps').write_text(maps)
   for line in maps.splitlines():
    fields=line.split(None,5)
    if len(fields)<6 or not fields[5].startswith('/'):continue
    path=fields[5]
    if path in hashes or not any(s in path for s in ['libgtk','libglib','libgdk','librsvg','libgio','libc.so','libgtk-thread']):continue
    try:hashes[path]=hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
    except (OSError,ValueError) as e:hashes[path]={'error':str(e)}
   (out/f'{pid}-{birth}-{index}.json').write_text(json.dumps({'wall':time.time(),'mono':time.monotonic(),'pid':pid,'birth':birth,'argv':args,'traceLines':count,'tids':[x.name for x in (q/'task').iterdir()]},indent=2))
   seen[key]={'count':count,'snapshots':index}
  except (OSError,ValueError) as e:
   if len(errors)<32:errors.append({'pid':pid,'error':str(e)})
 (out/'summary.json').write_text(json.dumps({'owned':{str(k):v for k,v in seen.items()},'libraryHashes':hashes,'errors':errors,'limitSeconds':180},indent=2))
 time.sleep(.25)

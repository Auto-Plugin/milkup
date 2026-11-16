"""Stock-only passive capture. No instrumented-record attribution is claimed.
The private probe still requires its unchanged kernel-sender-bound contract.
"""
import json,os,pathlib
from process_capture import Observer,PREFIX,PREFIXES

def bind_stock(log,records,processes):
 assert not records and not any(p in log for p in PREFIXES), 'Unexpected research instrumentation in stock runtime'
 web=[(identity,row) for identity,row in processes.items() if pathlib.Path(row['image']).name=='WebKitWebProcess']
 assert len(web)==1, 'Exactly one live stock WebProcess required'
 identity,row=web[0]
 assert row['pidfdId']==identity and row['uid']==os.getuid()
 assert row['noNewPrivs']==1 and row['seccomp']==2 and row['capEff']==0, 'Default sandbox required'
 assert len(row['lineage'])>=2 and row['lineage'][0]['pid']==row['pid'] and row['lineage'][0]['birth']==row['birth'], 'Owned process generation required'
 assert len(row['mappedFiles'])==2 and row['imageFile'], 'Live mapped runtime and executable identities required'
 return identity

class StockObserver(Observer):
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
   assert not any(v.startswith(PREFIXES)for v in self.buffers.values()),'Partial native record'
   result['webProcessPidfdId']=bind_stock((self.out/'native.log').read_bytes(),self.records,self.processes)
   result['status']='live-stock-webprocess-bound'
  except Exception as error:result.update(status='failed',error=repr(error))
  finally:
   for fd in self.held.values():os.close(fd)
   (self.out/'process-capture.json').write_text(json.dumps(result,indent=2)+'\n')
  assert result['status']=='live-stock-webprocess-bound',result.get('error')

"""Original packaged helper/guard/FD/PDF/cleanup flow, with passive collection split out."""
import json,os,pathlib,select,shutil,struct,subprocess,sys,tempfile,time,re
from pathlib import Path
from calibrate import HERE,proc,sha,decode_frames
from process_capture import Observer

def render(binary,guard,html,out,env):
    out.mkdir(parents=True,exist_ok=False);(out/'input.html').write_text(html)
    private=Path(tempfile.mkdtemp(prefix='milkup-output-calibration-',dir='/tmp'))
    (private/'libmilkup_output_guard.so').write_bytes(guard);os.chmod(private/'libmilkup_output_guard.so',0o600)
    result_r,result_w=os.pipe2(os.O_CLOEXEC)
    stop_r,stop_w=os.pipe2(os.O_CLOEXEC|os.O_NONBLOCK)
    e=env.copy();e['MILKUP_INTERNAL_OUTPUT_DIRECTORY']=str(private)
    events=[];seen={};buffer=b'';p=None;guardian_fd=None
    report={'status':'running','inputSha256':sha(html.encode()),'private':str(private),'events':events}
    started=time.monotonic()
    try:
        with Observer(binary,out,seen) as observer:
            p=subprocess.Popen([sys.executable,str(HERE/'launch_helper.py'),str(binary),str(result_w),str(stop_r),str(os.getpid())],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=observer.sender,pass_fds=(result_w,stop_r),env=e)
            guardian_fd=os.pidfd_open(p.pid,0)
            root=proc(p.pid);observer.start(root);report['guardianIdentity']={'pid':root['pid'],'birth':root['birth'],'uid':root['uid'],'pidfdHeld':True}
            os.close(result_w);result_w=-1;os.close(stop_r);stop_r=-1
            payload=json.dumps({'html':html,'pageSize':'a4','landscape':False,'print':False,'choose':None,'directory':str(private)},ensure_ascii=False).encode()
            pending=struct.pack('<I',len(payload))+payload
            os.set_blocking(p.stdin.fileno(),False)
            while pending:
                assert time.monotonic()-started<60,'snapshot write deadline'
                _,ready,_=select.select([],[p.stdin.fileno()],[],.1)
                if ready:pending=pending[os.write(p.stdin.fileno(),pending):]
            next_sample=0
            while time.monotonic()-started<60:
                if time.monotonic()>=next_sample:
                    next_sample=time.monotonic()+.05 # fast collector runs independently
                ready,_,_=select.select([result_r],[],[],.05)
                if ready:
                    data=os.read(result_r,16384)
                    if not data:break
                    got,buffer=decode_frames(buffer+data)
                    events.extend({**v,'elapsedMs':round((time.monotonic()-started)*1000,2)} for v in got)
                    if any(v['type'] in ['pdf','failed'] for v in got):break
            assert not buffer,'partial native result frame'
            assert [v['type'] for v in events]==['rendering','pdf'],events
            pdf=(private/'document.pdf').read_bytes();assert pdf.startswith(b'%PDF-') and len(pdf)<20_000_000
            (out/'a4-portrait.pdf').write_bytes(pdf);report['pdfSha256']=sha(pdf)
            report['status']='pdf-received'
    except Exception as error:report.update(status='failed',error=repr(error))
    finally:
        for fd in [result_w,stop_r,stop_w,result_r]:
            if fd>=0:os.close(fd)
        if p:
            if p.stdin:p.stdin.close()
            try:report['guardianExit']=p.wait(timeout=5)
            except subprocess.TimeoutExpired:report['guardianExit']=None;report['status']='failed';report['error']='guardian cleanup still pending; private data retained'
        if guardian_fd is not None:os.close(guardian_fd)
        report['processes']=list(seen.values());report['elapsedMs']=round((time.monotonic()-started)*1000,2)
        if report.get('guardianExit')==0:shutil.rmtree(private);report['privateRemoved']=True
        else:report['status']='failed';report['privateRemoved']=False
        (out/'native-result.json').write_text(json.dumps(report,indent=2)+'\n')
    assert report['status']=='pdf-received',report
    assert any('WebKitWebProcess' in r['image'] for r in report['processes']),'actual web process identity required'
    assert any(re.search(r'Width:\s+1024\b',w['geometry']) and re.search(r'Height:\s+768\b',w['geometry']) for r in report['processes'] for w in r.get('windows',[])),'actual product output window allocation required'
    return report

#!/usr/bin/env python3
"""One fail-fast baseline calibration using unchanged packaged native output code."""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
import pagination_audit

HERE = Path(__file__).resolve().parent
PACKAGE_SHA='9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde'
BINARY_SHA='42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6'
GUARD_SHA='296131695cb15814252edd02e76e111fef293b7585c4e7597101d8ec05b852fa'


def sha(b):return hashlib.sha256(b).hexdigest()


def extract_guard(data):
    assert sha(data)==BINARY_SHA,'wrong package binary'
    # Rust include_bytes embeds the original guard ELF verbatim. Read only its
    # bounded ELF section ranges, then require the previously fixed digest.
    found=[];pos=0
    while True:
        pos=data.find(b'\x7fELF\x02\x01\x01',pos+1)
        if pos<0:break
        try:
            h=struct.unpack_from('<16sHHIQQQIHHHHHH',data,pos)
            if h[1]!=3 or h[2]!=62 or h[11]!=64 or not 1<=h[12]<=100:continue
            end=h[6]+h[11]*h[12]
            if end>1_000_000 or pos+end>len(data):continue
            for i in range(h[12]):
                s=struct.unpack_from('<IIQQQQIIQQ',data,pos+h[6]+i*h[11])
                if s[1]!=8:end=max(end,s[4]+s[5])
            if end>1_000_000 or pos+end>len(data):continue
            blob=data[pos:pos+end]
            if b'milkup-output-guard-ready\x00' in blob and sha(blob)==GUARD_SHA:found.append(blob)
        except (ValueError,struct.error):continue
    assert len(found)==1,'exact embedded guard required'
    return found[0]


def unpack(path,digest,length,out):
    data=path.read_bytes();assert len(data)==length and sha(data)==digest
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        assert sum(i.file_size for i in z.infolist())<100_000_000
        assert all(not Path(i.filename).is_absolute() and '..' not in Path(i.filename).parts and (i.external_attr>>16)&0o170000!=0o120000 for i in z.infolist())
        z.extractall(out)


def decode_frames(buffer):
    events=[]
    while len(buffer)>=4:
        size=struct.unpack('<I',buffer[:4])[0]
        assert 0<size<=16384,'bounded result frame'
        if len(buffer)<4+size:break
        event=json.loads(buffer[4:4+size]);buffer=buffer[4+size:]
        assert event.get('type') in ['rendering','pdf','failed'],'unexpected native operation'
        events.append(event)
    return events,buffer


def proc(pid):
    p=Path('/proc')/str(pid);s=(p/'stat').read_text().rsplit(') ',1)[1].split()
    return {'pid':pid,'parent':int(s[1]),'birth':s[19],'image':str((p/'exe').resolve()),'uid':p.stat().st_uid}


def prove_chain(pid,root,binary,reader=proc):
    chain=[];visited=set()
    for _ in range(16):
        assert pid>0 and pid not in visited,'unrelated/cyclic process lineage'
        visited.add(pid);row=reader(pid);chain.append(row)
        assert row['uid']==os.getuid(),'owned account required'
        if pid==root['pid']:break
        pid=row['parent']
    assert chain[-1]['pid']==root['pid'] and chain[-1]['birth']==root['birth'],'exact guardian generation required'
    assert chain[-1]['image']==str(binary),'original packaged guardian image required'
    for row in chain:
        again=reader(row['pid'])
        assert all(again[k]==row[k] for k in ['pid','parent','birth','image','uid']),'process lineage changed during capture'
    return chain


def sample_owned(root,binary,out,seen):
    # Read only descendants of the owned guardian; no signals or shared UI changes.
    table={}
    for p in Path('/proc').glob('[0-9]*/stat'):
        try:table[int(p.parent.name)]=proc(int(p.parent.name))
        except (OSError,ValueError):pass
    owned={root['pid']}
    for _ in range(8):
        more={pid for pid,s in table.items() if s['parent'] in owned}
        if more<=owned:break
        owned|=more
    for pid in owned:
        s=table.get(pid)
        if not s:continue
        previous=seen.get((pid,s['birth']))
        if previous and (previous.get('windows') or 'WebKitWebProcess' in previous['image']):continue
        try:
            maps=(Path('/proc')/str(pid)/'maps').read_text()
            if 'libwebkit2gtk-4.1.so.' not in maps:continue
            assert proc(pid)['birth']==s['birth']
            lineage=prove_chain(pid,root,binary)
            libs=sorted({line.split()[-1] for line in maps.splitlines() if 'libwebkit2gtk-4.1.so.' in line or 'libjavascriptcoregtk-4.1.so.' in line})
            assert all(x.startswith('/usr/lib/') for x in libs)
            (out/f'process-{pid}-{s["birth"]}.maps').write_text(maps)
            row={**lineage[0],'libraries':libs,'lineage':lineage}
            try:
                windows=subprocess.check_output(['xdotool','search','--all','--pid',str(pid),'--name','^Document output$'],text=True,stderr=subprocess.DEVNULL,timeout=1).split()
                row['windows']=[]
                for w in windows:
                    window_pid=int(subprocess.check_output(['xdotool','getwindowpid',w],text=True,timeout=1))
                    property_text=subprocess.check_output(['xprop','-id',w,'_NET_WM_PID'],text=True,timeout=1)
                    match=re.search(r'=\s*(\d+)\s*$',property_text)
                    assert match and int(match[1])==window_pid==pid and proc(pid)['birth']==s['birth'],'independent window owner required'
                    assert lineage[0]['image']==str(binary),'window belongs to packaged renderer'
                    geometry=subprocess.check_output(['xwininfo','-id',w],text=True,timeout=1)
                    assert int(subprocess.check_output(['xdotool','getwindowpid',w],text=True,timeout=1))==pid,'window owner changed during geometry'
                    prove_chain(pid,root,binary)
                    row['windows'].append({'id':w,'pid':window_pid,'birth':s['birth'],'ownerProperty':property_text,'geometry':geometry})
            except (subprocess.CalledProcessError,subprocess.TimeoutExpired):row['windows']=[]
            seen[(pid,s['birth'])]=row
        except (FileNotFoundError,ProcessLookupError):pass


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
        with (out/'native.log').open('wb') as log:
            p=subprocess.Popen([sys.executable,str(HERE/'launch_helper.py'),str(binary),str(result_w),str(stop_r),str(os.getpid())],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log,pass_fds=(result_w,stop_r),env=e)
            guardian_fd=os.pidfd_open(p.pid,0)
            root=proc(p.pid);report['guardianIdentity']={'pid':root['pid'],'birth':root['birth'],'uid':root['uid'],'pidfdHeld':True}
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
                    sample_owned(root,binary,out,seen);next_sample=time.monotonic()+.05
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


def expectations(reference,markdown):
    e=json.loads(json.dumps(reference));e['papers']=e['papers'][:1];e['sourceSha256']=sha(markdown.encode())
    has=lambda s:re.search(r'(?<!\w)'+re.escape(s)+r'(?!\w)',markdown) is not None
    e['singles']=[s for s in e['singles'] if has(s)]
    for group in e['groups'].values():group['rows']=[r for r in group['rows'] if all(has(x) for x in r)]
    assert len(e['groups']['T']['rows']) in (3,72),'frozen short/long controls only'
    e['groups']['T']['requirePageBoundary']=len(e['groups']['T']['rows'])==72
    e['guardCount']=sum(len(e['groups'][k]['rows']) for k in ['T','C'])
    return e


def compare_reference(actual,reference):
    errors=[]
    if len(actual)!=len(reference):return ['reference page count differs']
    for i,(a,b) in enumerate(zip(actual,reference),1):
        if len(a['words'])!=len(b['words']):errors.append(f'page {i}: reference word count');continue
        for x,y in zip(a['words'],b['words']):
            if x['text']!=y['text'] or max(abs(v-w) for v,w in zip(x['box'],y['box']))>.5:
                errors.append(f'page {i}: reference word or coordinate differs: '+y['text']);break
    return errors


def chain(html):
    original='<div class="heading-lead"><h2>TABLESECTION</h2><table>'
    assert html.count(original)==1
    html=html.replace(original,'<div class="heading-lead table-heading-chain"><h2>TABLESECTION</h2><table>')
    css='@media print{.table-heading-chain{display:contents;break-inside:auto;page-break-inside:auto}.table-heading-chain table{break-before:avoid;page-break-before:avoid}.table-heading-chain thead{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}.table-heading-chain tbody>tr:first-child{break-before:avoid;page-break-before:avoid}}'
    return html.replace('</style>',css+'</style>')


def header_contract(paper,pdf=None):
    # Preserve native thead semantics and separately verify actual repeated output.
    glyphs=None
    if pdf:
        import fitz
        with fitz.open(pdf) as doc:glyphs=[p.get_text('words') for p in doc]
    errors=[];evidence=[]
    for boundary in paper['groups']['T']['boundaryRows']:
        n=boundary['page'];page=paper['pages'][n-1];labels=['TABLELEFT','TABLERIGHT',boundary['first']]
        boxes=[]
        for label in labels:
            found=[w for w in page['words'] if w['text']==label]
            if len(found)!=1:errors.append(f'page {n}: header/first-row identity {label} count {len(found)}');break
            box=found[0]['box']
            if glyphs is not None:
                match=[w for w in glyphs[n-1] if w[4]==label and abs(w[0]-box[0])<.1]
                if len(match)!=1:errors.append(f'page {n}: independent glyph identity {label}');break
                box=list(match[0][:4])
            boxes.append(box)
        if len(boxes)!=3:continue
        left,right,first=boxes
        if abs(left[1]-right[1])>1 or left[2]>=right[0] or max(left[3],right[3])>first[1]:errors.append(f'page {n}: header alignment/order')
        evidence.append({'page':n,'left':left,'right':right,'firstRow':first})
    table_pages=paper['groups']['T']['pages']
    for n,page in enumerate(paper['pages'],1):
        if n not in table_pages and any(w['text'] in ['TABLELEFT','TABLERIGHT'] for w in page['words']):errors.append(f'page {n}: header outside table data')
    return {'errors':errors,'pages':evidence,'requiredTablePages':table_pages}


def run(package_zip,reference_zip,out):
    assert os.getuid()!=0 and not any(os.environ.get(k) for k in ['WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS','LD_LIBRARY_PATH','LD_PRELOAD'])
    out.mkdir(parents=True,exist_ok=True)
    report={'status':'running','qaSha':os.environ.get('GITHUB_SHA'),'scope':'unchanged packaged native helper calibration, no app build/UI install matrix','results':[],'comparisonStarted':False}
    def persist():(out/'calibration-result.json').write_text(json.dumps(report,indent=2)+'\n')
    started=time.monotonic()
    try:
        unpack(package_zip,'b22943b501b9bfb0202dfb2507b7e7c5fe5aeda7c8fea8b2f0d0534182d5c89a',9812731,out/'package')
        unpack(reference_zip,'0cde8e2e975995f2fd51480cf93aa8310925dcd3ae0ad2f68409910b5a180e71',2229319,out/'reference')
        deb,=list((out/'package').rglob('*.deb'));assert sha(deb.read_bytes())==PACKAGE_SHA
        subprocess.run(['dpkg-deb','--extract',str(deb),str(out/'extracted')],check=True,timeout=30)
        binary=out/'extracted/usr/bin/milkup-desktop';guard=extract_guard(binary.read_bytes())
        report.update(packageSha256=PACKAGE_SHA,binarySha256=BINARY_SHA,guardSha256=sha(guard));persist()
        reference=json.loads((out/'reference/gui/pagination-audit.json').read_text())['papers'][0]['pages']
        original_expectations=json.loads((out/'reference/gui/expectations.json').read_text())
        provenance=json.loads((HERE/'fixture-provenance.json').read_text())
        for name,digest in provenance['fixtures'].items():assert sha((HERE/'fixtures'/name).read_bytes())==digest
        env=os.environ.copy()
        with tempfile.TemporaryDirectory(prefix='mkcal-',dir='/tmp') as runtime:
            env['XDG_RUNTIME_DIR']=runtime
            for key in ['CONFIG','CACHE','DATA','STATE']:
                d=out/('xdg-'+key.lower());d.mkdir(mode=0o700);env['XDG_'+key+'_HOME']=str(d)
            # Ruler measures actual scale/bounds; never tunes the pagination sample.
            original=(HERE/'fixtures/baseline.html').read_text();head=original.split('<body>')[0]
            ruler=head+'<body><div style="border:1px solid;width:100%;height:20px"></div><div style="line-height:16px"><span style="display:inline-block;width:96px">LEFT</span><span>RIGHT</span></div><div style="height:80px"></div><div style="line-height:16px">LOWER</div></body></html>'
            report['rulerNative']=render(binary,guard,ruler,out/'ruler',env)
            import fitz
            d=fitz.open(out/'ruler/a4-portrait.pdf');assert len(d)==1
            words={w[4]:w for w in d[0].get_text('words')}
            report['measurement']={'page':[d[0].rect.width,d[0].rect.height],'xFor96CssPx':words['RIGHT'][0]-words['LEFT'][0],'yFor96CssPx':words['LOWER'][1]-words['LEFT'][1],'leftTextX':words['LEFT'][0],'paths':[{'rect':list(x['rect'])} for x in d[0].get_drawings()]};persist()
            assert abs(words['LEFT'][0]-reference[0]['words'][0]['box'][0])<.5,'ruler/reference margin mismatch'
            for mode in ['baseline','chain']:
                if mode=='chain':report['comparisonStarted']=True;persist()
                for case in ['baseline','short-edge','long-room','short-room']:
                    assert time.monotonic()-started<540,'batch deadline'
                    name=mode+'-'+case;dest=out/name
                    html=(HERE/'fixtures'/f'{case}.html').read_text();md=(HERE/'fixtures'/f'{case}.md').read_text()
                    if mode=='chain':html=chain(html)
                    native=render(binary,guard,html,dest,env)
                    (dest/'complex-pagination.md').write_text(md)
                    (dest/'expectations.json').write_text(json.dumps(expectations(original_expectations,md)))
                    pagination_audit.audit(dest)
                    result=json.loads((dest/'pagination-audit.json').read_text());paper=result['papers'][0]
                    headers=header_contract(paper,dest/'a4-portrait.pdf')
                    row={'name':name,'errors':result['errors'],'native':native,'pages':len(paper.get('pages',[])),'headers':headers};report['results'].append(row)
                    row['acceptanceErrors']=result['errors']+headers['errors']
                    if mode=='baseline' and case=='baseline':
                        row['referenceErrors']=compare_reference(paper['pages'],reference)
                        persist();assert not row['referenceErrors'] and result['errors']==['a4-portrait: T: orphan heading'],'original baseline not faithfully reproduced'
                    elif mode=='baseline':persist();assert not result['errors'],'baseline control failed'
                    persist()
            report['status']='chain-mechanism-passed' if all(not r['acceptanceErrors'] for r in report['results'] if r['name'].startswith('chain-')) else 'chain-mechanism-failed'
    except Exception as e:report.update(status='calibration-stopped',error=repr(e))
    finally:persist()
    print(json.dumps({k:v for k,v in report.items() if k not in ['results','rulerNative']},indent=2))
    return report['status']!='chain-mechanism-passed'


if __name__=='__main__':sys.exit(run(*(Path(x).resolve() for x in sys.argv[1:4])))

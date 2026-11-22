"""Real, bounded CMake stress fixture. Does not configure WebKit or certify Ubuntu.
Usage: python stress_configure.py NEW_OWNED_DIRECTORY EXACT_LOCAL_TEST_SDK
The pinned Debian test SDK is a known local fixture, never a runner substitute.
"""
from pathlib import Path
import sys,json,time,resource,shutil,os
from stream_trace import run_traced,require_complete,digest
p=Path(sys.argv[1]);sdk=Path(sys.argv[2]).resolve();assert not p.exists();assert shutil.disk_usage(p.parent).free>1024**3;assert digest(sdk/'usr/bin/cmake')=='9a2692f4d712265eb29c90c3366bfc40df400ea586b0477edabbcf3bae745dc1'
p.mkdir();source=p/'source';source.mkdir();work=p/'work';work.mkdir();build=work/'build'
text='''cmake_minimum_required(VERSION 3.25)
project(StreamConfiguration LANGUAGES NONE)
string(REPEAT "x" 1100 payload)
function(custom_probe)
 string(LENGTH "${ARGV0}" tail_length)
endfunction()
foreach(i RANGE 1 70000)
 string(LENGTH "${payload}" n)
endforeach()
custom_probe("tail-required-unique-marker")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/tail-output.txt" "tail-required-unique-marker")
'''
f=source/'CMakeLists.txt';f.write_text(text);line=next(i for i,l in enumerate(text.splitlines(),1) if l.startswith('custom_probe('));ob={'items':[{'id':0,'file':'/source/CMakeLists.txt','line':line,'command':'custom_probe','sourceSha256':digest(f)},{'id':1,'file':'/source/CMakeLists.txt','line':9999,'command':'find_package','sourceSha256':digest(f)}]}
env={'PATH':str(sdk/'usr/bin')+':/usr/bin:/bin','LD_LIBRARY_PATH':str(sdk/'usr/lib/x86_64-linux-gnu')+':'+str(sdk/'usr/lib'),'LANG':'C'}
def room():
 assert shutil.disk_usage(p).free>1024**3,'Local fixture reserve'
start=time.monotonic();r=run_traced([str(sdk/'usr/bin/cmake'),'-S',str(source),'-B',str(build),'-G','Ninja','--trace-expand','--trace-format=json-v1','--trace-redirect='+str(work/'trace.fifo')],fifo=work/'trace.fifo',log=work/'cmake.log',obligations=ob,mounts={'/source':source,'/work':work,'/usr':sdk/'usr'},env=env,cwd=work,timeout=180,room=room)
(p/'result.json').write_text(json.dumps(r,indent=2));require_complete(r);assert r['rawBytes']>64*1024**2 and r['items'][0]['count']==1 and r['items'][1]['status']=='not-executed-in-complete-trace';assert (build/'build.ninja').is_file() and (build/'CMakeCache.txt').is_file() and (build/'tail-output.txt').read_text()=='tail-required-unique-marker'
m={'status':'passed-real-CMake-configure-not-WebKit','elapsedSeconds':time.monotonic()-start,'rawBytes':r['rawBytes'],'events':r['events'],'unmatchedEvents':r['unmatchedEvents'],'peakRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'summaryBytes':(p/'result.json').stat().st_size,'cacheSha256':digest(build/'CMakeCache.txt'),'graphSha256':digest(build/'build.ninja'),'tailSha256':digest(build/'tail-output.txt'),'fullRawTraceStored':False,'UbuntuConfigure':False};(p/'measurement.json').write_text(json.dumps(m,indent=2));print(json.dumps(m))

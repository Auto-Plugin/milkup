"""Owns an unprivileged, loopback-only CUPS/IPP session and its cleanup."""
import getpass
import grp
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import cups

assert os.getuid() != 0
assert not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
base = Path(os.environ['RUNNER_TEMP']).resolve()
root = base / ('milkup-private-cups-' + os.environ['GITHUB_RUN_ID'])
assert not root.exists()
root.mkdir(mode=0o700)
tools = Path(os.environ['MILKUP_CUPS_TOOLS']).resolve()
receiver = Path(os.environ['MILKUP_IPP_RECEIVER']).resolve()
out = base / 'linux-native-evidence' / 'queue'
out.mkdir(parents=True)
queue = 'MilkupPrivate' + os.environ['GITHUB_RUN_ID']
env = {**os.environ, 'CUPS_SERVER': '127.0.0.1:18632',
       'MILKUP_PRIVATE_CUPS_ROOT': str(root), 'MILKUP_QUEUE_NAME': queue,
       'GTK_MODULES': 'gail:atk-bridge'}
report = {'uid': os.getuid(), 'queue': queue, 'tools': str(tools), 'receiverSha256': hashlib.sha256(receiver.read_bytes()).hexdigest(),
          'steps': [], 'cleanup': [], 'physicalPrintTested': False, 'systemServiceModified': False}
processes = []
logs = []
def persist():
    (out / 'session.json').write_text(json.dumps(report, indent=2))
def run(args, timeout=15):
    toolenv = {**env, 'LD_LIBRARY_PATH': str(tools/'usr/lib/x86_64-linux-gnu')} if args[0].startswith(str(tools)+'/') else env
    p = subprocess.run(args, capture_output=True, text=True, env=toolenv, timeout=timeout)
    report['steps'].append({'args': args, 'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr})
    persist()
    assert p.returncode == 0, (args, p.stderr[-1000:])
    return p.stdout
def start(args, name):
    f = open(out / name, 'w'); logs.append(f)
    toolenv = {**env, 'LD_LIBRARY_PATH': str(tools/'usr/lib/x86_64-linux-gnu')} if args[0].startswith(str(tools)+'/') else env
    p = subprocess.Popen(args, stdout=f, stderr=f, env=toolenv)
    processes.append(p)
    time.sleep(.5)
    assert p.poll() is None, (name, p.poll())
    return p
def listeners():
    rows = []
    for protocol in ['tcp', 'tcp6']:
        for line in Path('/proc/net/' + protocol).read_text().splitlines()[1:]:
            fields = line.split()
            if int(fields[1].split(':')[1],16) in (18631,18632) and fields[3] == '0A':
                rows.append({'protocol': protocol, 'local': fields[1]})
    return rows
connection = None
try:
    assert not listeners(), 'Refuse ports already owned by another process'
    for directory in ['cache','spool','state','tmp','config','log','ssl','receiver']:
        (root / directory).mkdir(mode=0o700)
    user = getpass.getuser(); group = grp.getgrgid(os.getgid()).gr_name
    files = {'AccessLog': root/'log/access', 'ErrorLog': root/'log/error', 'PageLog': root/'log/page',
             'CacheDir': root/'cache', 'RequestRoot': root/'spool', 'ServerRoot': root/'config',
             'StateDir': root/'state', 'TempDir': root/'tmp', 'ServerKeychain': root/'ssl',
             'Printcap': root/'state/printcap', 'DataDir': tools/'usr/share/cups',
             'DocumentRoot': tools/'usr/share/cups/doc-root', 'ServerBin': tools/'usr/lib/cups'}
    (root/'files.conf').write_text(f'User {user}\nGroup {group}\nSystemGroup root\n'+''.join(f'{key} {value}\n' for key,value in files.items()))
    # This policy belongs solely to this ephemeral, loopback-only test scheduler.
    # No system CUPS configuration/default printer is read or modified.
    (root/'cupsd.conf').write_text(f'''Listen 127.0.0.1:18632
ServerName localhost
Browsing Off
WebInterface No
LogLevel debug
PreserveJobFiles Yes
PreserveJobHistory Yes
MaxJobs 8
SetEnv LD_LIBRARY_PATH {tools}/usr/lib/x86_64-linux-gnu
<Location />
 Order deny,allow
 Deny from all
 Allow from 127.0.0.1
</Location>
<Policy default>
 JobPrivateAccess all
 JobPrivateValues none
 <Limit All>
  Order deny,allow
  Deny from all
  Allow from 127.0.0.1
 </Limit>
</Policy>
''')
    command = [str(tools/'usr/sbin/cupsd'), '-c', str(root/'cupsd.conf'), '-s', str(root/'files.conf')]
    run(command+['-t'])
    start([str(receiver), '-n','localhost','-p','18631','-r','off','-d',str(root/'receiver'),'-k','-f','application/pdf','-c','/usr/bin/true','Milkup private IPP receiver'], 'receiver.log')
    start(command+['-f'], 'scheduler-stdout.log')
    report['listeners'] = listeners()
    assert len(report['listeners']) == 3
    assert all(row['local'].split(':')[0] in ('0100007F','00000000000000000000000001000000') for row in report['listeners'])
    run([str(tools/'usr/sbin/lpadmin'), '-p', queue, '-E', '-v', 'ipp://localhost:18631/ipp/print', '-m','everywhere','-o','printer-is-shared=false'])
    connection = cups.Connection(host='127.0.0.1', port=18632)
    report['printers'] = connection.getPrinters()
    assert set(report['printers']) == {queue}
    assert report['printers'][queue]['device-uri'] == 'ipp://localhost:18631/ipp/print'
    assert not report['printers'][queue]['printer-is-shared']
    assert connection.getDefault() is None, 'Do not set even a private default printer'
    persist()
    lines = run([str(base/'milkup-gtk-printers')]).splitlines()
    printers = [json.loads(line) for line in lines if line.startswith('{')]
    import base64
    owned = [p for p in printers if p.get('nameBase64') and base64.b64decode(p['nameBase64']).decode() == queue]
    assert len(owned) == 1 and not owned[0]['virtual'] and owned[0]['active'] and owned[0]['acceptsPdf']
    report['gtkPrinter'] = owned[0]; persist()
    subprocess.run(['bash','scripts/ci/run-linux-private-queue.sh'], env=env, check=True, timeout=240)
    report['status'] = 'passed'
except Exception as e:
    report['status'] = 'failed'; report['error'] = str(e)
finally:
    if connection:
        try:
            for identifier in connection.getJobs(which_jobs='not-completed', my_jobs=False):
                attrs = connection.getJobAttributes(identifier)
                assert attrs['job-printer-uri'].endswith('/printers/'+queue)
                connection.cancelJob(identifier, purge_job=False)
                report['cleanup'].append({'cancelledOwnedJob':identifier})
        except Exception as e:
            report['cleanup'].append({'error':str(e)}); report['status']='failed'
    for process in reversed(processes):
        try:
            if process.poll() is None: process.terminate()
            code=process.wait(timeout=10)
            report['cleanup'].append({'pid':process.pid,'exit':code,'forced':False})
            assert code==0
        except Exception as e:
            report['cleanup'].append({'pid':process.pid,'error':str(e),'forced':True})
            process.kill(); process.wait(timeout=5); report['status']='failed'
    for f in logs: f.close()
    report['remainingListeners']=listeners()
    if report['remainingListeners']: report['status']='failed'
    # Preserve only owned synthetic evidence, then remove every private service object.
    for directory in ['log','receiver','spool','config']:
        if (root/directory).exists(): shutil.copytree(root/directory,out/directory)
    for file in root.glob('receipt-*.txt'): shutil.copyfile(file,out/file.name)
    shutil.rmtree(root)
    report['privateRootRemoved']=not root.exists()
    persist()
print(json.dumps(report,indent=2))
sys.exit(0 if report.get('status')=='passed' else 1)

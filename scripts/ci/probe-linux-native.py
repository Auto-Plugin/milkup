"""Read-only runner capabilities; no packages, queues or defaults changed."""
import json, os, pathlib, shutil, subprocess, sys
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
def run(args):
    try:
        p = subprocess.run(args, text=True, capture_output=True, timeout=15)
        return {'args': args, 'exit': p.returncode, 'stdout': p.stdout[:24000], 'stderr': p.stderr[:4000]}
    except Exception as e:
        return {'args': args, 'error': str(e)}
tools = ['Xvfb','xvfb-run','dbus-run-session','xdotool','xwininfo','WebKitWebDriver','tauri-driver','cupsd','lpstat','lpadmin','ippeveprinter','ipptool','pdfinfo','pdftotext','python3','pkg-config']
report = {'sourceSha': os.environ.get('GITHUB_SHA'), 'uid': os.getuid(), 'gid': os.getgid(), 'tools': {x: shutil.which(x) for x in tools}, 'os': pathlib.Path('/etc/os-release').read_text(), 'display': os.environ.get('DISPLAY'), 'wayland': os.environ.get('WAYLAND_DISPLAY'), 'runnerImage': os.environ.get('ImageVersion'), 'queries': []}
for args in [['id'],['pkg-config','--modversion','webkit2gtk-4.1','gtk+-3.0'],['dpkg-query','-W','libwebkit2gtk-4.1-0','libgtk-3-0t64','cups','cups-ipp-utils','xvfb','webkit2gtk-driver','webkitgtk-webdriver'],['lpstat','-t'],['sysctl','kernel.unprivileged_userns_clone','kernel.apparmor_restrict_unprivileged_userns'],['unshare','-Ur','true']]:
    report['queries'].append(run(args))
(out/'capabilities.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))

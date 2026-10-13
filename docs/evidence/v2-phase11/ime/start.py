import os, pathlib, subprocess
root=pathlib.Path('/workspace/.cache/milkup-ime-phase11')
evidence=pathlib.Path('/tmp/milkup-v2-phase11/ime')
schemas=evidence/'schemas';schemas.mkdir(exist_ok=True)
for folder in [pathlib.Path('/workspace/.cloud/milkup-v2/sysroot/usr/share/glib-2.0/schemas'),root/'usr/share/glib-2.0/schemas']:
 for f in folder.glob('*.xml'):
  dest=schemas/f.name
  if not dest.exists():dest.symlink_to(f)
subprocess.run(['glib-compile-schemas',str(schemas)],check=True)
query='/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/libgtk-3-0/gtk-query-immodules-3.0'
env={**os.environ,'DISPLAY':':99','GTK_IM_MODULE':'ibus','XMODIFIERS':'@im=ibus','GSETTINGS_SCHEMA_DIR':str(schemas),'LD_LIBRARY_PATH':str(root/'usr/lib/x86_64-linux-gnu')+':'+os.environ['LD_LIBRARY_PATH'],'PATH':str(root/'usr/bin')+':'+os.environ['PATH'],'XDG_DATA_DIRS':str(root/'usr/share')+':/workspace/.cloud/milkup-v2/sysroot/usr/share:/usr/share','XDG_CONFIG_HOME':str(evidence/'config'),'XDG_CACHE_HOME':str(evidence/'cache'),'XDG_DATA_HOME':str(evidence/'data')}
with (evidence/'immodules.cache').open('w') as f:
 subprocess.run([query,str(root/'usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules/im-ibus.so')],env=env,stdout=f,check=True)
env['GTK_IM_MODULE_FILE']=str(evidence/'immodules.cache')
args=['proot','-b','/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1:/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1']
for f in (root/'usr/libexec').iterdir():args+=['-b',str(f)+':/usr/libexec/'+f.name]
for name in ['ibus','ibus-libpinyin','libpinyin','opencc']:
 f=root/'usr/share'/name
 if f.exists():args+=['-b',str(f)+':/usr/share/'+name]
args+=['-b',str(root/'usr/lib/x86_64-linux-gnu/libpinyin')+':/usr/lib/x86_64-linux-gnu/libpinyin']
args+=['dbus-run-session','--','bash',str(evidence/'session.sh')]
os.execvpe(args[0],args,env)

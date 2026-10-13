from pathlib import Path
import shutil,json,hashlib
root=Path('/tmp/milkup-v2-phase16');dst=Path('docs/evidence/v2-phase16');dst.mkdir(parents=True,exist_ok=True)
def copy(p,target):
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
for p in root.iterdir():
 if p.is_file() and p.suffix in ['.json','.log']:copy(p,dst/p.name)
 if p.is_file() and p.suffix in ['.py','.mjs']:copy(p,dst/'diagnostic-commands'/p.name)
full=['before','visual-final-build','states-final-build','states-loading-capture','native-gtk-scale2','quality','windowed-unicode','block-keyboard','table-editing','navigation','windowed-blocks','production-tables','zoom-before']
for name in full:
 for p in (root/name).rglob('*'):
  if p.is_file() and p.suffix in ['.png','.json','.log','.txt']:copy(p,dst/name/p.relative_to(root/name))
for name in ['production-visual','production-visual-complete']:
 for p in (root/name).rglob('*'):
  if p.is_file() and (p.suffix=='.json' or p.name=='failure.png'):copy(p,dst/name/p.relative_to(root/name))
for p in (root/'loading-video').iterdir():
 if p.suffix in ['.json','.log','.mp4'] or p.name in ['frame-09.png','frame-11.png','frame-21.png']:copy(p,dst/'loading-video'/p.name)
files=[Path('apps/desktop/src-tauri/target/release/milkup-desktop'),*Path('apps/desktop/dist').rglob('*.js'),*Path('apps/desktop/dist').rglob('*.css'),Path('apps/desktop/src/main.ts'),Path('apps/desktop/src/style.css'),Path('packages/view-dom/src/editor-view.ts')]
data={'baseline':'dffdcbeb848f43629e42863d95213a47199c51dd','branch':'dot/milkup-v2-quality','command':'pnpm --filter @milkup/desktop tauri build --no-bundle','exitCode':0,'files':[{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
(dst/'production-build-manifest.json').write_text(json.dumps(data,indent=2)+'\n')
print('archived',sum(1 for p in dst.rglob('*') if p.is_file()),'files')

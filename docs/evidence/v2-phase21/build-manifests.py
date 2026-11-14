import pathlib,json,hashlib,subprocess,difflib
r=pathlib.Path('/workspace/.milkup-v2-phase21')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sources={str(p):sha(p) for p in pathlib.Path('apps/desktop/src-tauri/src').glob('*.rs')}
value={'baselineHead':'bba85ef6dd78a4a826e2300c1f56968371807f6f','buildCommand':'pnpm --filter @milkup/desktop tauri build --no-bundle --config /workspace/.cloud/milkup-v2/tauri.linux.json','builds':{},'candidateSources':sources,'diagnosticExposureShipped':False,'frontendSourceChanged':False}
for name in ['baseline','trace','candidate']:
 p=r/name/'milkup-desktop';value['builds'][name]={'sha256':sha(p),'bytes':p.stat().st_size,'diagnostic':name=='trace'}
value['frontendAssets']={str(p):sha(p) for p in pathlib.Path('apps/desktop/dist').rglob('*') if p.is_file()}
(r/'production-build-manifest.json').write_text(json.dumps(value,indent=2))
a=(r/'recovery.rs.baseline').read_text().splitlines(True);b=(r/'recovery-red.rs').read_text().splitlines(True)
(r/'lock-red.patch').write_text(''.join(difflib.unified_diff(a,b,fromfile='a/apps/desktop/src-tauri/src/recovery.rs',tofile='b/apps/desktop/src-tauri/src/recovery.rs')))

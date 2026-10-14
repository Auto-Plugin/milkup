from pathlib import Path
root=Path('/workspace/.milkup-v2-phase21')
src=Path('apps/desktop/src-tauri/src')
for name in ['lib.rs','piece_tree.rs','recovery.rs']:
 p=src/name;s=p.read_text();(root/(name+'.baseline')).write_text(s)
 if name=='lib.rs':
  for fn,marker in [('read_bounded_large_line_window','read-window'),('apply_large_text_file_changes_in_registry','apply')]:
   start=s.index('fn '+fn+'(');pos=s.index('    let mut stores = registry.lock()',start)
   s=s[:pos]+f'    let span = Phase21Span::new("{marker}");\n'+s[pos:]
   pos=s.index('\n',s.index('    let mut stores = registry.lock()',pos))+1;s=s[:pos]+'    span.mark("locked");\n'+s[pos:]
  s+='''\npub(crate) struct Phase21Span { start: std::time::Instant, name: &'static str }
impl Phase21Span {
 pub(crate) fn new(name: &'static str)->Self { let s=Self{start:std::time::Instant::now(),name};s.mark("begin");s }
 pub(crate) fn mark(&self,stage:&str) { eprintln!("PHASE21 {} {:?} {} {} {:.3}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_micros(),std::thread::current().id(),self.name,stage,self.start.elapsed().as_secs_f64()*1000.0); }
}
impl Drop for Phase21Span { fn drop(&mut self) { self.mark("end"); } }
'''
 if name=='piece_tree.rs':
  s=s.replace('pub(crate) fn write_to(&self, path: &Path) -> Result<(), String> {','pub(crate) fn write_to(&self, path: &Path) -> Result<(), String> {\n        let span = crate::Phase21Span::new("write");')
  s=s.replace('output.flush().map_err(|error| error.to_string())?;','output.flush().map_err(|error| error.to_string())?;\n        span.mark("flushed");',1)
 if name=='recovery.rs':
  start=s.index('fn checkpoint_native_with_after_write(');pos=s.index('    let stores = files.0.lock()',start)
  s=s[:pos]+'    let span = crate::Phase21Span::new("checkpoint-registry");\n'+s[pos:]
  pos=s.index('\n',s.index('    let stores = files.0.lock()',pos))+1;s=s[:pos]+'    span.mark("locked");\n'+s[pos:]
  s=s.replace('            drop(stores);','            drop(stores);\n            span.mark("unlocked");')
 p.write_text(s)

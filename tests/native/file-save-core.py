#!/usr/bin/env python3
"""Cheap Unix disk-guard tests using exact product function bodies, without GTK.

Tauri dispatch/serde and post-write resource notifications are not exercised;
the installed GUI test is the integration gate. No implementation is copied or
rewritten here: extraction failure stops before compiling. All files are owned
fixtures beneath a newly created output directory.
"""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys

assert os.name == 'posix' and os.getuid() != 0
out = pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=False)
source = pathlib.Path('apps/desktop/src-tauri/src/lib.rs').read_text()
names = ['save_markdown_file', 'same_file_path', 'write_markdown_atomically',
         'save_error_with_cleanup', 'snapshot_hash', 'replace_file_atomically']
functions = []
hashes = {}
for name in names:
    matches = re.findall(r'^fn ' + name + r'\b.*?^}', source, re.M | re.S)
    assert len(matches) == (2 if name == 'replace_file_atomically' else 1), name
    body = matches[-1]
    if name == 'replace_file_atomically':
        assert 'fs::rename' in body and 'MoveFileExW' not in body
    functions.append(body)
    hashes[name] = hashlib.sha256(body.encode()).hexdigest()

prefix = r'''
#![allow(dead_code)]
use std::{collections::hash_map::DefaultHasher, fs, hash::{Hash,Hasher}, io::Write,
          path::{Path,PathBuf}, sync::atomic::Ordering};
use std::os::unix::fs::PermissionsExt;
struct DocumentFileIdentity { path:String }
struct SaveFileResult { document_id:String, file:DocumentFileIdentity, disk_snapshot_hash:String }
// Only the post-write resource notification boundary is stubbed.
mod resources {
    pub fn document_write_committed(_: &str, _: &std::path::Path) {}
    pub fn register_document(_: &str, _: &std::path::Path) {}
}
fn root(name:&str)->PathBuf {
    let p=PathBuf::from(std::env::var("MILKUP_GUARD_FIXTURES").unwrap()).join(name);
    fs::create_dir(&p).unwrap(); p
}
fn save(source:&Path, target:&Path)->Result<SaveFileResult,String> {
    save_markdown_file("owned".into(),target.to_str().unwrap().into(),"local".into(),
        Some(snapshot_hash("opened")),Some(source.to_str().unwrap().into()))
}
#[test] fn stale_original_and_canonical_and_symlink_aliases_remain_protected() {
    let dir=root("aliases"); let source=dir.join("original.md");
    fs::write(&source,"outside").unwrap();
    let alias=dir.join("alias.md"); std::os::unix::fs::symlink(&source,&alias).unwrap();
    for target in [&source, &dir.join("./original.md"), &alias] {
        assert!(save(&source,target).err().unwrap().contains("changed outside"));
        assert_eq!(fs::read_to_string(&source).unwrap(),"outside");
        assert_eq!(fs::read_dir(&dir).unwrap().count(),2);
    }
    let rescue=dir.join("rescue.md"); save(&source,&rescue).unwrap();
    assert_eq!(fs::read_to_string(rescue).unwrap(),"local");
    assert_eq!(fs::read_to_string(source).unwrap(),"outside");
}
#[test] fn deleted_original_is_not_recreated_but_new_copy_is_allowed() {
    let dir=root("deleted"); let source=dir.join("gone.md");
    assert!(save(&source,&source).is_err()); assert!(!source.exists());
    let rescue=dir.join("rescue.md"); save(&source,&rescue).unwrap();
    assert_eq!(fs::read_to_string(rescue).unwrap(),"local"); assert!(!source.exists());
}
#[test] fn readonly_target_is_not_bypassed_by_choosing_another_path() {
    let dir=root("readonly"); let source=dir.join("original.md"); let target=dir.join("target.md");
    fs::write(&source,"outside").unwrap(); fs::write(&target,"protected").unwrap();
    fs::set_permissions(&target,fs::Permissions::from_mode(0o444)).unwrap();
    let result=save(&source,&target);
    fs::set_permissions(&target,fs::Permissions::from_mode(0o600)).unwrap();
    assert!(result.err().unwrap().contains("read-only"));
    assert_eq!(fs::read_to_string(&target).unwrap(),"protected");
    assert_eq!(fs::read_to_string(&source).unwrap(),"outside");
}
#[test] fn concurrent_external_write_during_staging_is_not_lost() {
    let dir=root("during-write"); let target=dir.join("original.md"); fs::write(&target,"opened").unwrap();
    let result=write_markdown_atomically(&target,Some(&snapshot_hash("opened")),|file| {
        file.write_all(b"local").unwrap(); fs::write(&target,"outside-during-write").unwrap(); Ok(())
    });
    assert!(result.unwrap_err().contains("during save"));
    assert_eq!(fs::read_to_string(&target).unwrap(),"outside-during-write");
    assert_eq!(fs::read_dir(&dir).unwrap().count(),1);
}
'''
unit = out / 'exact-file-save.rs'
unit.write_text(prefix + '\n\n'.join(functions))
subprocess.run(['rustc', '--edition=2021', '--test', str(unit), '-o', str(out/'guard-tests')],
               check=True, timeout=60)
fixtures=out/'fixtures'; fixtures.mkdir()
run=subprocess.run([str(out/'guard-tests'),'--test-threads=1'], env={**os.environ,'MILKUP_GUARD_FIXTURES':str(fixtures)},
                   text=True,capture_output=True,timeout=30)
(out/'result.txt').write_text(run.stdout+run.stderr)
print(run.stdout+run.stderr,end='')
(out/'source-contract.json').write_text(json.dumps({'productFileSha256':hashlib.sha256(source.encode()).hexdigest(),
    'functionSha256':hashes,'exitCode':run.returncode,'scope':'Unix exact file guard functions; no GTK/IPC/resource integration'},indent=2)+'\n')
assert run.returncode == 0

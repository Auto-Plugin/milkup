//! Review-only support for a supervisor-verified, newly extracted fixed Runtime.
//! No download, installation, signature bypass, or installed-Runtime ACL change.
//! The trusted host coordinates this test; arbitrary same-user host code is not
//! in the AppContainer threat model. The manifest is immutable to that host.
use super::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MARKER: &str = "155.0.4283.62-x64";
const VERSION: &str = "155.0.4283.62";
const CAB_SHA: &str = "cf54aa717a0ebd05b40e87620724583cb6eb0a5b8b64764cc11e42822f68bf6c";
const MAX_FILES: usize = 10_000;
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 4 * 1024 * 1024;

struct Entry { bytes: u64, sha256: String }
struct Manifest { files: BTreeMap<String, Entry>, total_bytes: u64 }

fn valid_path(path: &str) -> bool {
    !path.is_empty() && path.len() <= 1024 && path.split('/').all(|part| {
        if part.is_empty() || part == "." || part == ".." || part.ends_with('.') || part.ends_with(' ') || part.starts_with(' ') { return false; }
        if !part.bytes().all(|c| c.is_ascii_alphanumeric() || b"._- ".contains(&c)) { return false; }
        let stem=part.split('.').next().unwrap_or("").to_ascii_uppercase();
        !matches!(stem.as_str(),"CON"|"PRN"|"AUX"|"NUL") &&
            !(stem.len()==4 && (stem.starts_with("COM") || stem.starts_with("LPT")) &&
                matches!(stem.as_bytes()[3],b'1'..=b'9'))
    })
}
fn exact_keys(value:&Value, keys:&[&str])->bool {
    value.as_object().is_some_and(|object| object.len()==keys.len() && keys.iter().all(|key|object.contains_key(*key)))
}
fn parse_manifest(value:&Value)->Result<Manifest> {
    if !exact_keys(value,&["schema","version","architecture","cabSha256","files","totalBytes"])
        || value["schema"]!=1 || value["version"]!=VERSION || value["architecture"]!="x64"
        || value["cabSha256"]!=CAB_SHA { return Err("Fixed Runtime manifest identity/schema rejected".into()); }
    let records=value["files"].as_array().filter(|files| !files.is_empty() && files.len()<=MAX_FILES)
        .ok_or("Fixed Runtime file budget rejected")?;
    let mut files=BTreeMap::new(); let mut aliases=BTreeSet::new(); let mut total=0u64;
    for record in records {
        if !exact_keys(record,&["path","bytes","sha256"]) { return Err("Fixed Runtime file schema rejected".into()); }
        let path=record["path"].as_str().filter(|path|valid_path(path)).ok_or("Fixed Runtime relative path rejected")?;
        if !aliases.insert(path.to_ascii_lowercase()) { return Err("Fixed Runtime path alias rejected".into()); }
        let bytes=record["bytes"].as_u64().ok_or("Fixed Runtime byte length rejected")?;
        total=total.checked_add(bytes).filter(|sum|*sum<=MAX_BYTES).ok_or("Fixed Runtime total byte budget rejected")?;
        let sha=record["sha256"].as_str().filter(|sha|sha.len()==64 && sha.bytes().all(|c|c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
            .ok_or("Fixed Runtime file digest rejected")?;
        files.insert(path.to_string(),Entry {bytes,sha256:sha.to_string()});
    }
    if value["totalBytes"].as_u64()!=Some(total) || !files.contains_key("msedgewebview2.exe") {
        return Err("Fixed Runtime total/executable binding rejected".into());
    }
    // A file cannot simultaneously be a directory prefix.
    for path in files.keys() {
        for (offset,_) in path.match_indices('/') {
            if aliases.contains(&path[..offset].to_ascii_lowercase()) { return Err("Fixed Runtime file/directory alias rejected".into()); }
        }
    }
    Ok(Manifest {files,total_bytes:total})
}

fn open_access(path:&Path, rights:u32, directory:bool)->std::io::Result<OwnedHandle> {
    let path=wide(path.as_os_str());
    let handle=unsafe { CreateFileW(path.as_ptr(),rights,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
        null(),OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT|if directory {FILE_FLAG_BACKUP_SEMANTICS} else {0},null_mut()) };
    if handle==INVALID_HANDLE_VALUE { Err(std::io::Error::last_os_error()) }
    else { Ok(unsafe { OwnedHandle::from_raw_handle(handle) }) }
}
fn deny(path:&Path, rights:u32, directory:bool)->Result<()> {
    match open_access(path,rights,directory) {
        Ok(handle)=> {drop(handle);Err("Fixed Runtime protection failed: forbidden access succeeded".into())},
        Err(error) if error.raw_os_error()==Some(ERROR_ACCESS_DENIED as i32)=>Ok(()),
        Err(_)=>Err("Fixed Runtime protection denial is unproven".into()),
    }
}
fn host_manifest_immutable(path:&Path)->Result<()> {
    for rights in [FILE_WRITE_DATA,FILE_APPEND_DATA,FILE_WRITE_ATTRIBUTES,FILE_WRITE_EA,DELETE,WRITE_DAC,WRITE_OWNER] {
        deny(path,rights,false)?;
    }
    // This also prevents replacement through a writable parent, not only direct
    // writes to the manifest. Creating unrelated siblings is not requested.
    for ancestor in path.parent().ok_or("Missing manifest parent")?.ancestors().filter(|p|!p.as_os_str().is_empty()) {
        for rights in [FILE_DELETE_CHILD,DELETE,WRITE_DAC,WRITE_OWNER] { deny(ancestor,rights,true)?; }
    }
    Ok(())
}
fn pin_directory(path:&Path)->Result<OwnedHandle> {
    let name=wide(path.as_os_str());
    let raw=unsafe { CreateFileW(name.as_ptr(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ,null(),OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,null_mut()) };
    let handle=unsafe { owned(raw)? };
    let mut info=BY_HANDLE_FILE_INFORMATION::default();
    check(unsafe { GetFileInformationByHandle(handle.as_raw_handle(),&mut info) })?;
    if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY==0 || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT!=0 {
        return Err("Fixed Runtime pinned directory type/reparse rejected".into());
    }
    Ok(handle)
}
fn pin_file(path:&Path)->Result<File> {
    let file=OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(path)?;
    let metadata=file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("Fixed Runtime nonregular/reparse file rejected".into());
    }
    let mut info=BY_HANDLE_FILE_INFORMATION::default();
    check(unsafe { GetFileInformationByHandle(file.as_raw_handle(),&mut info) })?;
    if info.nNumberOfLinks!=1 { return Err("Fixed Runtime hard-link alias rejected".into()); }
    Ok(file)
}
fn hash_file(file:&mut File,expected:&Entry)->Result<()> {
    if file.metadata()?.len()!=expected.bytes { return Err("Fixed Runtime file length mismatch".into()); }
    let mut hash=Sha256::new(); let mut bytes=0u64; let mut buffer=[0u8;65536];
    loop {
        let count=file.read(&mut buffer)?; if count==0 { break; }
        bytes=bytes.checked_add(count as u64).filter(|bytes|*bytes<=expected.bytes).ok_or("Fixed Runtime file grew")?;
        hash.update(&buffer[..count]);
    }
    if bytes!=expected.bytes || format!("{:x}",hash.finalize())!=expected.sha256 {
        return Err("Fixed Runtime file digest mismatch".into());
    }
    Ok(())
}

struct TreePins { directories: Vec<PathBuf>, files: Vec<PathBuf>, file_pins: Vec<File>, directory_pins: Vec<OwnedHandle> }
fn verify_and_pin_tree(runtime: &Path, manifest: &Manifest) -> Result<TreePins> {
let mut expected_directories=BTreeSet::new();
for path in manifest.files.keys() {
    for (offset,_) in path.match_indices('/') { expected_directories.insert(path[..offset].to_string()); }
}
let mut directories=Vec::new(); let mut files=Vec::new(); let mut file_pins=Vec::new();
let mut directory_pins=Vec::new(); let mut seen=BTreeSet::new(); let mut pending=vec![runtime.to_path_buf()];
while let Some(directory)=pending.pop() {
    if directories.len()>=MAX_FILES { return Err("Fixed Runtime directory budget exceeded".into()); }
    let meta=fs::symlink_metadata(&directory)?;
    if !meta.is_dir() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT!=0 {
        return Err("Fixed Runtime reparse/non-directory rejected".into());
    }
    directory_pins.push(pin_directory(&directory)?); directories.push(directory.clone());
    for entry in fs::read_dir(&directory)? {
        let entry=entry?; let path=entry.path(); let meta=fs::symlink_metadata(&path)?;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT!=0 { return Err("Fixed Runtime reparse entry rejected".into()); }
        let relative=path.strip_prefix(runtime)?.to_str().ok_or("Non-UTF8 Runtime path")?.replace('\\',"/");
        if !valid_path(&relative) { return Err("Fixed Runtime unsafe extracted path rejected".into()); }
        if meta.is_dir() {
            if !expected_directories.contains(&relative) {return Err("Fixed Runtime unlisted directory rejected".into());}
            pending.push(path); if pending.len()+directories.len()>MAX_FILES {return Err("Fixed Runtime directory budget exceeded".into());}
        }
        else {
            let expected=manifest.files.get(&relative).ok_or("Fixed Runtime unlisted file rejected")?;
            if !seen.insert(relative) || files.len()>=MAX_FILES { return Err("Fixed Runtime duplicate/file budget rejected".into()); }
            let mut pin=pin_file(&path)?; hash_file(&mut pin,expected)?;
            file_pins.push(pin); files.push(path);
        }
    }
}
if seen.len()!=manifest.files.len() { return Err("Fixed Runtime missing manifest file rejected".into()); }
    Ok(TreePins {directories,files,file_pins,directory_pins})
}

pub(super) struct Guard {
    runtime:PathBuf,
    directories:Vec<PathBuf>,
    files:Vec<PathBuf>,
    _file_pins:Vec<File>,
    _directory_pins:Vec<OwnedHandle>,
    _manifest_pin:File,
    _proof_directory_pins:Vec<OwnedHandle>,
}
impl Guard {
    pub(super) fn prepare(runtime:&Path,temp:&Path,system:&Path,sid:&str,report:&mut Value)->Result<Option<Self>> {
        match std::env::var("MILKUP_MERMAID_FIXED_RUNTIME") {
            Err(std::env::VarError::NotPresent)=>return Ok(None),
            Ok(value) if value==MARKER=>(),
            _=>return Err("Fixed Runtime marker rejected".into()),
        }
        if temp.file_name()!=Some(OsStr::new("temp")) || temp.parent().and_then(Path::file_name)!=Some(OsStr::new("state")) {
            return Err("Fixed Runtime requires the exact supervised stage TEMP".into());
        }
        let stage=temp.parent().and_then(Path::parent).ok_or("Fixed Runtime stage missing")?;
        let leaf=stage.file_name().and_then(OsStr::to_str).ok_or("Fixed Runtime stage name invalid")?;
        let identity=leaf.strip_prefix("milkup-standard-").ok_or("Fixed Runtime stage identity rejected")?;
        if identity.len()!=32 || !identity.bytes().all(|c|c.is_ascii_hexdigit()) ||
            runtime!=stage.join("runtime") { return Err("Fixed Runtime must be the exact fresh stage/runtime".into()); }
        reject_reparse_ancestors(runtime)?;
        let proof=stage.join("code/runtime-manifest.json"); reject_reparse_ancestors(&proof)?;
        host_manifest_immutable(&proof)?;
        let proof_directory_pins=vec![pin_directory(stage)?,pin_directory(&stage.join("code"))?];
        let mut proof_pin=pin_file(&proof)?;
        if proof_pin.metadata()?.len()>MAX_MANIFEST { return Err("Fixed Runtime manifest exceeds budget".into()); }
        let mut bytes=Vec::new(); (&mut proof_pin).take(MAX_MANIFEST+1).read_to_end(&mut bytes)?;
        if bytes.len() as u64>MAX_MANIFEST { return Err("Fixed Runtime manifest grew beyond budget".into()); }
        let manifest_sha256=format!("{:x}",Sha256::digest(&bytes));
        let manifest=parse_manifest(&serde_json::from_slice(&bytes)?)?;
        if manifest.files.len()!=256 || manifest.total_bytes!=705_180_320 {
            return Err("Fixed Runtime manifest differs from the pinned CAB file table".into());
        }
        let TreePins {directories,files,file_pins,directory_pins}=verify_and_pin_tree(runtime,&manifest)?;
        // Only after immutable proof and the complete pinned tree have matched.
        // This target is the newly created runtime, never Program Files.
        acl(system,runtime,&["/grant:r".into(),format!("*{sid}:(OI)(CI)RX")],&mut report["aclOperations"])?;
        report["fixedRuntime"]=json!({"version":VERSION,"architecture":"x64","cabSha256":CAB_SHA,
            "supervisorDeclaredDownloadAndExtraction":true,"installed":false,
            "manifestSha256":manifest_sha256,
            "supervisorSignatureVerificationRequired":true,"nativeSignatureVerification":false,
            "manifestImmutableToHost":true,"filesPinnedAndHashed":files.len(),"directoriesPinned":directories.len(),
            "totalBytes":manifest.total_bytes,"exactProfileSidReadExecuteGrant":true,
            "priorProfileReadExecuteGrantsRetainedUntilStageCleanup":true,"appContainerAccessVerified":false,
            "browserImagePathVerified":false,"pinsReleasedAfterJobEmpty":false});
        Ok(Some(Self {runtime:runtime.to_path_buf(),directories,files,_file_pins:file_pins,
            _directory_pins:directory_pins,_manifest_pin:proof_pin,_proof_directory_pins:proof_directory_pins}))
    }
    pub(super) fn verify_child(&self,process:HANDLE,report:&mut Value)->Result<()> {
        let source=open_token(process,TOKEN_QUERY|TOKEN_DUPLICATE)?; let mut duplicate=null_mut();
        check(unsafe { DuplicateToken(source.as_raw_handle(),SecurityImpersonation,&mut duplicate) })?;
        let duplicate=unsafe { owned(duplicate)? };
        check(unsafe { ImpersonateLoggedOnUser(duplicate.as_raw_handle()) })?;
        let _revert=RevertGuard;
        let mut directory_checks=BTreeSet::new();
        for path in &self.directories { directory_checks.insert(path.clone()); }
        for path in self.runtime.ancestors().filter(|p|!p.as_os_str().is_empty()) {directory_checks.insert(path.to_path_buf());}
        let mut denied=0usize; let mut readable=0usize;
        for path in directory_checks {
            for rights in [FILE_ADD_FILE,FILE_ADD_SUBDIRECTORY,FILE_DELETE_CHILD,DELETE,WRITE_DAC,WRITE_OWNER,FILE_WRITE_ATTRIBUTES,FILE_WRITE_EA] {
                deny(&path,rights,true)?; denied+=1;
            }
        }
        // Full-path opens establish effective traversal, without insisting that
        // ancestors also grant directory listing to the AppContainer.
        for path in &self.directories { drop(open_access(path,FILE_LIST_DIRECTORY|FILE_TRAVERSE,true)?);readable+=1; }
        for path in &self.files {
            for rights in [FILE_WRITE_DATA,FILE_APPEND_DATA,FILE_WRITE_ATTRIBUTES,FILE_WRITE_EA,DELETE,WRITE_DAC,WRITE_OWNER] {
                deny(path,rights,false)?; denied+=1;
            }
            drop(open_access(path,FILE_READ_DATA|FILE_EXECUTE,false)?);readable+=1;
        }
        report["fixedRuntime"]["appContainerAccessVerified"]=json!(true);
        report["fixedRuntime"]["forbiddenAccessDenials"]=json!(denied);
        report["fixedRuntime"]["readExecuteOpens"]=json!(readable);
        Ok(())
    }
    pub(super) fn verify_browser(&self,process:HANDLE,report:&mut Value)->Result<()> {
        let mut buffer=vec![0u16;32768]; let mut length=buffer.len() as u32;
        check(unsafe { QueryFullProcessImageNameW(process,0,buffer.as_mut_ptr(),&mut length) })?;
        if length==0 || length as usize>=buffer.len() { return Err("Fixed Runtime browser image query length rejected".into()); }
        use std::os::windows::ffi::OsStringExt;
        let actual=PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize]));
        reject_reparse_ancestors(&actual)?;
        if fs::canonicalize(actual)?!=self.runtime.join("msedgewebview2.exe") {
            return Err("Browser process image is outside the pinned Fixed Runtime".into());
        }
        report["fixedRuntime"]["browserImagePathVerified"]=json!(true);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestTree(PathBuf);
    impl TestTree {
        fn new()->Self {
            let root=fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("milkup-fixed-runtime-guard-{}-{}",
                std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
            fs::create_dir(&root).unwrap(); Self(root)
        }
    }
    impl Drop for TestTree { fn drop(&mut self) { let _=fs::remove_dir_all(&self.0); } }
    fn manifest()->Value { json!({"schema":1,"version":VERSION,"architecture":"x64","cabSha256":CAB_SHA,
        "totalBytes":1,"files":[{"path":"msedgewebview2.exe","bytes":1,"sha256":"0".repeat(64)}]}) }
    #[test]
    fn manifest_rejects_aliases_traversal_and_wrong_identity() {
        assert!(parse_manifest(&manifest()).is_ok());
        for path in ["../x","a//b","a/./b","a\\b","/x","c:x","a:stream","NUL","com1.dll","a.","a ","a/*"] {
            assert!(!valid_path(path),"{path}");
        }
        for (key,value) in [("version",json!("156.0.0.0")),("architecture",json!("arm64")),("cabSha256",json!("f".repeat(64))),("totalBytes",json!(2))] {
            let mut fixture=manifest();fixture[key]=value;assert!(parse_manifest(&fixture).is_err());
        }
        let mut duplicate=manifest(); let mut alias=duplicate["files"][0].clone();alias["path"]=json!("MSEDGEWEBVIEW2.EXE");
        duplicate["files"].as_array_mut().unwrap().push(alias);duplicate["totalBytes"]=json!(2);
        assert!(parse_manifest(&duplicate).is_err());
    }
    #[test]
    fn manifest_rejects_excessive_sizes_extra_fields_and_directory_collision() {
        let mut fixture=manifest();fixture["files"][0]["bytes"]=json!(MAX_BYTES+1);fixture["totalBytes"]=json!(MAX_BYTES+1);
        assert!(parse_manifest(&fixture).is_err());
        let mut fixture=manifest();fixture["extra"]=json!(true);assert!(parse_manifest(&fixture).is_err());
        let mut fixture=manifest();let mut child=fixture["files"][0].clone();child["path"]=json!("msedgewebview2.exe/child");
        fixture["files"].as_array_mut().unwrap().push(child);fixture["totalBytes"]=json!(2);
        assert!(parse_manifest(&fixture).is_err());
        let mut fixture=manifest();fixture["files"]=json!(vec![fixture["files"][0].clone();MAX_FILES+1]);
        assert!(parse_manifest(&fixture).is_err());
    }
    #[test]
    fn synthetic_tree_rejects_extra_missing_hardlinks_and_changed_bytes() {
        let tree=TestTree::new();let runtime=tree.0.join("runtime");fs::create_dir(&runtime).unwrap();
        let file=runtime.join("msedgewebview2.exe");
        // Inert test bytes; this helper test never passes the version-specific
        // admission gate, sets ACLs, starts a process, or loads an image.
        let bytes=b"synthetic only";fs::write(&file,bytes).unwrap();
        let manifest=Manifest {total_bytes:bytes.len() as u64,files:BTreeMap::from([
            ("msedgewebview2.exe".into(),Entry {bytes:bytes.len() as u64,sha256:format!("{:x}",Sha256::digest(bytes))})])};
        drop(verify_and_pin_tree(&runtime,&manifest).unwrap());
        fs::write(runtime.join("extra"),b"extra").unwrap();
        assert!(verify_and_pin_tree(&runtime,&manifest).is_err());fs::remove_file(runtime.join("extra")).unwrap();
        fs::create_dir(runtime.join("extra-empty-directory")).unwrap();
        assert!(verify_and_pin_tree(&runtime,&manifest).is_err());fs::remove_dir(runtime.join("extra-empty-directory")).unwrap();
        fs::remove_file(&file).unwrap();assert!(verify_and_pin_tree(&runtime,&manifest).is_err());
        fs::write(&file,b"changed bytes!").unwrap();assert!(verify_and_pin_tree(&runtime,&manifest).is_err());
        fs::write(&file,bytes).unwrap();let alias=tree.0.join("outside-runtime-alias");
        fs::hard_link(&file,&alias).unwrap();assert!(verify_and_pin_tree(&runtime,&manifest).is_err());
        fs::remove_file(alias).unwrap();drop(verify_and_pin_tree(&runtime,&manifest).unwrap());
        fs::remove_dir_all(&tree.0).unwrap();assert!(!tree.0.exists());
    }
    #[test]
    fn synthetic_file_pin_checks_bytes_and_blocks_replacement() {
        let root=TestTree::new();let path=root.0.join("synthetic.bin");fs::write(&path,b"synthetic only").unwrap();
        let mut pin=pin_file(&path).unwrap();
        let expected=Entry {bytes:b"synthetic only".len() as u64+1,sha256:format!("{:x}",Sha256::digest(b"synthetic only"))};
        // Deliberately wrong length must fail without relying on real Runtime data.
        assert!(hash_file(&mut pin,&expected).is_err());
        assert_eq!(fs::remove_file(&path).unwrap_err().raw_os_error(),Some(ERROR_SHARING_VIOLATION as i32));
        drop(pin);
        let mut pin=pin_file(&path).unwrap();let expected=Entry {bytes:b"synthetic only".len() as u64,sha256:format!("{:x}",Sha256::digest(b"synthetic only"))};
        hash_file(&mut pin,&expected).unwrap();drop(pin);fs::remove_dir_all(&root.0).unwrap();assert!(!root.0.exists());
    }
}

//! ISOLATED DIAGNOSTIC, not a product deletion implementation.
//!
//! Adapted from Rust std (MIT OR Apache-2.0), commit
//! 58cf8f9c35b355199727627d07ae34a4e2846d67:
//! library/std/src/sys/fs/windows/remove_dir_all.rs and windows.rs
//! (remove_dir_all, File::{basic_info,delete,fill_dir_buff}, DirBuff).
//! Copyright (c) The Rust Project Contributors.
//! Distributed under MIT; see ../../RUST-DELETE-LICENSE-MIT.
//! Original algorithm/flags/retry branches are retained; this is a source-level
//! adapter with observations, NOT instrumentation of the linked std function.
//! Only call for the launcher's newly owned, canonical private tree after Job
//! emptiness and pin release. No ACL, token, privilege or attribute adjustment.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    ffi::c_void,
    io,
    mem::{size_of, MaybeUninit},
    os::windows::{ffi::OsStrExt, io::{AsRawHandle, FromRawHandle, OwnedHandle}},
    path::Path,
    ptr::{null, null_mut},
    sync::atomic::{AtomicU32, Ordering},
    thread,
};
use windows_sys::Win32::{Foundation::*, Storage::FileSystem::*};

const OBJ_DONT_REPARSE: u32 = 0x1000;
const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x20;
const MAX_RETRIES: usize = 50;
const PATH_UNITS: usize = 256;
const JSON_BUDGET: usize = 8192;
const BUFFER_SIZE: usize = 1024;
static ATTRIBUTES: AtomicU32 = AtomicU32::new(OBJ_DONT_REPARSE);

#[repr(C)]
struct UnicodeString { length: u16, maximum_length: u16, buffer: *const u16 }
static EMPTY_NAME: [u16;1]=[0];
fn unicode_name(name:&[u16])->UnicodeString {
    // Matches locked Rust UnicodeStrRef and its #143078 empty-string mitigation.
    if name.is_empty() { UnicodeString { length:0,maximum_length:2,buffer:EMPTY_NAME.as_ptr() } }
    else { UnicodeString { length:(name.len()*2).try_into().expect("OS component length"),
        maximum_length:(name.len()*2).try_into().expect("OS component length"),buffer:name.as_ptr() } }
}
#[repr(C)]
struct ObjectAttributes {
    length: u32, root: HANDLE, name: *const UnicodeString, attributes: u32,
    security_descriptor: *mut c_void, security_qos: *mut c_void,
}
#[repr(C)]
union IoStatusValue { status: i32, pointer: *mut c_void }
#[repr(C)]
struct IoStatusBlock { value: IoStatusValue, information: usize }
#[link(name = "ntdll")]
extern "system" {
    fn NtOpenFile(handle: *mut HANDLE, access: u32, attrs: *const ObjectAttributes,
        status: *mut IoStatusBlock, share: u32, options: u32) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}

#[derive(Clone)]
struct Failure { path: Vec<u16>, stage: &'static str, error: u32, status: Option<i32> }
impl Failure {
    fn value(&self) -> Value {
        let mut digest = Sha256::new();
        for unit in &self.path { digest.update(unit.to_le_bytes()); }
        let units = self.path.len();
        json!({"relativePath":String::from_utf16_lossy(&self.path[..units.min(PATH_UNITS)]),
            "relativePathUtf16Units":units,"relativePathTruncated":units > PATH_UNITS,
            "relativePathUtf16LeSha256":format!("{:x}",digest.finalize()),
            "stage":self.stage,"win32Error":self.error,
            "ntstatus":self.status.map(|status|format!("0x{:08X}",status as u32))})
    }
}
#[derive(Default)]
struct Trace { first: Option<Failure>, failures: usize }
impl Trace {
    fn failure(&mut self, path: &[u16], stage: &'static str, error: u32, status: Option<i32>) -> Failure {
        let result = Failure { path: path.to_vec(), stage, error, status };
        self.failures += 1;
        if self.first.is_none() { self.first = Some(result.clone()); }
        result
    }
    fn finish(self, terminal: Option<&Failure>) -> Value {
        let value = json!({"schema":1,"implementation":"isolated-adapter-of-rust-58cf8f9c",
            "linkedStdInstrumented":false,"apiFailureCount":self.failures,
            "firstApiFailure":self.first.as_ref().map(Failure::value),
            "terminalFailure":terminal.map(Failure::value),
            "pathEncoding":"lossy-display-plus-exact-UTF16LE-hash",
            "jsonByteLimit":JSON_BUDGET,"truncated":false});
        if serde_json::to_vec(&value).map_or(true, |bytes|bytes.len()>JSON_BUDGET) {
            json!({"schema":1,"truncated":true,"apiFailureCount":self.failures,
                "terminalStage":terminal.map(|f|f.stage),"terminalWin32Error":terminal.map(|f|f.error)})
        } else { value }
    }
}

fn relative(parent: &[u16], name: &[u16]) -> Vec<u16> {
    if name.is_empty() { return parent.to_vec(); }
    if parent == [b'.' as u16] { return name.to_vec(); }
    let mut path = parent.to_vec(); path.push(b'/' as u16); path.extend_from_slice(name); path
}

fn open_relative(parent: &OwnedHandle, name: &[u16], access: u32, options: u32,
    path: &[u16], stage: &'static str, trace: &mut Trace) -> Result<Option<OwnedHandle>, Failure> {
    // Directory-entry names are single components, supplied by the same OS
    // handle enumeration as upstream. The empty name means that handle itself.
    let name = unicode_name(name);
    let mut attrs = ObjectAttributes { length:size_of::<ObjectAttributes>() as u32,
        root:parent.as_raw_handle(), name:&name, attributes:ATTRIBUTES.load(Ordering::Relaxed),
        security_descriptor:null_mut(), security_qos:null_mut() };
    let mut call = |attrs: &ObjectAttributes| -> Result<OwnedHandle, Failure> {
        let mut handle = null_mut();
        let mut io_status = IoStatusBlock { value:IoStatusValue { status:0x103 }, information:0 };
        let status = unsafe { NtOpenFile(&mut handle, access, attrs, &mut io_status,
            FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE, FILE_OPEN_REPARSE_POINT|options) };
        if status >= 0 { Ok(unsafe { OwnedHandle::from_raw_handle(handle) }) }
        else {
            let error = if status == STATUS_DELETE_PENDING { ERROR_DELETE_PENDING }
                else { unsafe { RtlNtStatusToDosError(status) } };
            Err(trace.failure(path,stage,error,Some(status)))
        }
    };
    let mut result = call(&attrs);
    if matches!(&result,Err(error) if error.error == ERROR_INVALID_PARAMETER)
        && ATTRIBUTES.load(Ordering::Relaxed) == OBJ_DONT_REPARSE {
        ATTRIBUTES.store(0,Ordering::Relaxed); attrs.attributes=0; result=call(&attrs);
    }
    match result {
        Ok(handle)=>Ok(Some(handle)),
        Err(error) if matches!(error.error,ERROR_FILE_NOT_FOUND|ERROR_PATH_NOT_FOUND|
            ERROR_BAD_NETPATH|ERROR_BAD_NET_NAME|ERROR_DELETE_PENDING)=>Ok(None),
        Err(error)=>Err(error),
    }
}

fn delete(parent: &OwnedHandle, name: &[u16], path: &[u16], trace: &mut Trace) -> Result<(),Failure> {
    let Some(handle)=open_relative(parent,name,DELETE,0,path,"NtOpenFile/delete",trace)? else { return Ok(()); };
    let info=FILE_DISPOSITION_INFO_EX { Flags:FILE_DISPOSITION_FLAG_DELETE|
        FILE_DISPOSITION_FLAG_POSIX_SEMANTICS|FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE };
    let ok=unsafe { SetFileInformationByHandle(handle.as_raw_handle(),FileDispositionInfoEx,
        (&info as *const FILE_DISPOSITION_INFO_EX).cast(),size_of::<FILE_DISPOSITION_INFO_EX>() as u32) };
    let result=if ok != 0 { Ok(()) } else {
        let error=unsafe { GetLastError() };
        let failure=trace.failure(path,"SetFileInformationByHandle/FileDispositionInfoEx",error,None);
        if matches!(error,ERROR_INVALID_PARAMETER|ERROR_NOT_SUPPORTED|ERROR_INVALID_FUNCTION) {
            let info=FILE_DISPOSITION_INFO { DeleteFile:true };
            let ok=unsafe { SetFileInformationByHandle(handle.as_raw_handle(),FileDispositionInfo,
                (&info as *const FILE_DISPOSITION_INFO).cast(),size_of::<FILE_DISPOSITION_INFO>() as u32) };
            if ok != 0 { Ok(()) } else {
                let error=unsafe { GetLastError() };
                Err(trace.failure(path,"SetFileInformationByHandle/FileDispositionInfo",error,None))
            }
        } else { Err(failure) }
    };
    // Like File::delete(self), consume and close before returning, including errors.
    drop(handle); result
}

fn retry(mut f: impl FnMut()->Result<(),Failure>, ignore:u32)->Result<(),Failure> {
    let mut remaining=MAX_RETRIES;
    loop {
        remaining-=1;
        if remaining==0 { return f(); }
        let result=f();
        if !matches!(&result,Err(error) if error.error==ignore) { return result; }
        thread::yield_now();
    }
}

#[repr(align(8))]
struct DirectoryBuffer([MaybeUninit<u8>;BUFFER_SIZE]);
impl DirectoryBuffer {
    fn new()->Self { Self([MaybeUninit::uninit();BUFFER_SIZE]) }
    fn fill(&mut self, handle:&OwnedHandle,restart:bool,path:&[u16],trace:&mut Trace)->Result<bool,Failure> {
        let class=if restart { FileIdBothDirectoryRestartInfo } else { FileIdBothDirectoryInfo };
        let ok=unsafe { GetFileInformationByHandleEx(handle.as_raw_handle(),class,
            self.0.as_mut_ptr().cast(),BUFFER_SIZE as u32) };
        if ok != 0 { Ok(true) } else {
            let error=unsafe { GetLastError() };
            if error==ERROR_NO_MORE_FILES { Ok(false) } else {
                Err(trace.failure(path,if restart { "GetFileInformationByHandleEx/FileIdBothDirectoryRestartInfo" }
                    else { "GetFileInformationByHandleEx/FileIdBothDirectoryInfo" },error,None))
            }
        }
    }
    fn entries(&self)->Entries<'_> { Entries { buffer:self,cursor:Some(0) } }
}
struct Entries<'a> { buffer:&'a DirectoryBuffer,cursor:Option<usize> }
impl Iterator for Entries<'_> {
    type Item=(Vec<u16>,bool);
    fn next(&mut self)->Option<Self::Item> {
        loop {
            let cursor=self.cursor?;
            // Same OS-owned initialized fields and unaligned reads as upstream.
            // Do not reinterpret the filename as a Rust string or normalize it.
            let ptr=unsafe { self.buffer.0.as_ptr().add(cursor).cast::<FILE_ID_BOTH_DIR_INFO>() };
            let next=unsafe { (&raw const (*ptr).NextEntryOffset).read_unaligned() } as usize;
            let length=unsafe { (&raw const (*ptr).FileNameLength).read_unaligned() } as usize;
            let attributes=unsafe { (&raw const (*ptr).FileAttributes).read_unaligned() };
            let name_ptr=unsafe { (&raw const (*ptr).FileName).cast::<u16>() };
            let name:Vec<_>=(0..length/2).map(|i|unsafe { name_ptr.add(i).read_unaligned() }).collect();
            self.cursor=if next==0 { None } else { Some(cursor+next) };
            if name==[b'.' as u16] || name==[b'.' as u16,b'.' as u16] { continue; }
            return Some((name,attributes & FILE_ATTRIBUTE_DIRECTORY != 0));
        }
    }
}

fn run(path:&Path,trace:&mut Trace)->Result<(),Failure> {
    let relative_root=[b'.' as u16];
    // Admission only: callers already supply a canonical absolute owned path.
    // Refuse a noncanonical contract instead of introducing path conversion.
    let name:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
    if !path.is_absolute() || name[..name.len()-1].contains(&0) {
        return Err(trace.failure(&relative_root,"owned-root-contract",ERROR_INVALID_PARAMETER,None));
    }
    let raw=unsafe { CreateFileW(name.as_ptr(),FILE_LIST_DIRECTORY,
        FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,null(),OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,null_mut()) };
    if raw==INVALID_HANDLE_VALUE {
        let error=unsafe { GetLastError() };
        return Err(trace.failure(&relative_root,"CreateFileW/root",error,None));
    }
    let root=unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut info:FILE_BASIC_INFO=unsafe { std::mem::zeroed() };
    let ok=unsafe { GetFileInformationByHandleEx(root.as_raw_handle(),FileBasicInfo,
        (&mut info as *mut FILE_BASIC_INFO).cast(),size_of::<FILE_BASIC_INFO>() as u32) };
    if ok==0 {
        let error=unsafe { GetLastError() };
        return Err(trace.failure(&relative_root,"GetFileInformationByHandleEx/FileBasicInfo",error,None));
    }
    if info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY==0 {
        return Err(trace.failure(&relative_root,"root-directory-type",ERROR_DIRECTORY,None));
    }
    let mut buffer=Box::new(DirectoryBuffer::new());
    let mut dirs=vec![(root,relative_root.to_vec())];
    let mut restart=true;
    'outer: while let Some((dir,path))=dirs.pop() {
        let more=buffer.fill(&dir,restart,&path,trace)?;
        for (name,is_directory) in buffer.entries() {
            let child=relative(&path,&name);
            if is_directory {
                let Some(subdir)=open_relative(&dir,&name,SYNCHRONIZE|FILE_LIST_DIRECTORY,
                    FILE_SYNCHRONOUS_IO_NONALERT,&child,"NtOpenFile/directory",trace)? else { continue; };
                dirs.push((dir,path)); dirs.push((subdir,child)); continue 'outer;
            } else {
                retry(||delete(&dir,&name,&child,trace),ERROR_SHARING_VIOLATION)?;
            }
        }
        if more { dirs.push((dir,path)); restart=false; }
        else { retry(||delete(&dir,&[],&path,trace),ERROR_DIR_NOT_EMPTY)?; restart=true; }
    }
    Ok(())
}

pub(super) fn remove_dir_all(path:&Path,observation:&mut Value)->io::Result<()> {
    let mut trace=Trace::default();
    let result=run(path,&mut trace);
    *observation=trace.finish(result.as_ref().err());
    result.map_err(|failure|io::Error::from_raw_os_error(failure.error as i32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs,os::windows::fs::OpenOptionsExt,path::PathBuf,time::{SystemTime,UNIX_EPOCH}};
    struct Tree(PathBuf);
    impl Tree {
        fn new()->Self {
            let root=fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("milkup-delete-diag-{}-{}",
                std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
            fs::create_dir(&root).unwrap(); Self(root)
        }
    }
    impl Drop for Tree { fn drop(&mut self) { let _=fs::remove_dir_all(&self.0); } }
    #[test]
    fn empty_relative_name_preserves_locked_rust_nul_mitigation() {
        let empty=unicode_name(&[]);
        assert_eq!((empty.length,empty.maximum_length),(0,2));
        assert_eq!(unsafe { *empty.buffer },0);
        let named=[b'x' as u16]; let name=unicode_name(&named);
        assert_eq!((name.length,name.maximum_length),(2,2));
        assert_eq!(name.buffer,named.as_ptr());
        let tree=Tree::new(); let mut report=Value::Null;
        remove_dir_all(&tree.0,&mut report).unwrap(); assert!(!tree.0.exists());
    }
    #[test]
    fn owned_nested_unicode_and_multiple_directory_buffers_match_std() {
        for diagnostic in [false,true] {
            let tree=Tree::new();
            fs::create_dir_all(tree.0.join("state/中文😀/nested")).unwrap();
            for n in 0..70 { fs::write(tree.0.join(format!("state/中文😀/nested/file{n:03}")),b"owned").unwrap(); }
            fs::write(tree.0.join("state/other"),b"owned").unwrap();
            if diagnostic {
                let mut report=Value::Null; remove_dir_all(&tree.0,&mut report).unwrap();
                assert!(report["terminalFailure"].is_null()); assert_eq!(report["truncated"],false);
            } else { fs::remove_dir_all(&tree.0).unwrap(); }
            assert!(!tree.0.exists());
        }
    }
    #[test]
    fn real_share_denial_reports_relative_ntopen_and_original_code() {
        let tree=Tree::new(); fs::create_dir(tree.0.join("state")).unwrap();
        let pin=fs::OpenOptions::new().write(true).create_new(true).share_mode(0)
            .open(tree.0.join("state/held-中文")).unwrap();
        let expected=fs::remove_dir_all(&tree.0).unwrap_err().raw_os_error();
        let mut report=Value::Null;
        assert_eq!(remove_dir_all(&tree.0,&mut report).unwrap_err().raw_os_error(),expected);
        assert_eq!(report["terminalFailure"]["stage"],"NtOpenFile/delete");
        assert_eq!(report["terminalFailure"]["relativePath"],"state/held-中文");
        assert_eq!(report["terminalFailure"]["win32Error"],ERROR_SHARING_VIOLATION);
        assert!(report["terminalFailure"]["ntstatus"].is_string());
        assert_eq!(report["apiFailureCount"],MAX_RETRIES);
        drop(pin); remove_dir_all(&tree.0,&mut report).unwrap(); assert!(!tree.0.exists());
    }
    #[test]
    fn missing_and_wrong_type_keep_std_error_and_do_not_delete_file() {
        let tree=Tree::new(); let file=tree.0.join("plain"); fs::write(&file,b"preserve").unwrap();
        for path in [file.clone(),tree.0.join("missing")] {
            let expected=fs::remove_dir_all(&path).unwrap_err().raw_os_error();
            let mut report=Value::Null;
            assert_eq!(remove_dir_all(&path,&mut report).unwrap_err().raw_os_error(),expected);
            assert!(!report["terminalFailure"].is_null());
        }
        assert_eq!(fs::read(file).unwrap(),b"preserve");
    }
    #[test]
    fn owned_mapped_image_reports_disposition_denial_without_retry_or_fallback() {
        use windows_sys::Win32::System::Memory::*;
        let tree=Tree::new(); fs::create_dir(tree.0.join("code")).unwrap();
        let image=tree.0.join("code/owned-test-image.exe");
        // This test's own binary only. Create a read-only image view and never
        // call an entry point, load a DLL or execute the copied candidate.
        fs::copy(std::env::current_exe().unwrap(),&image).unwrap();
        let file=fs::OpenOptions::new().read(true)
            .share_mode(FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE).open(&image).unwrap();
        let mapping=unsafe { CreateFileMappingW(file.as_raw_handle(),null(),PAGE_READONLY|SEC_IMAGE,0,0,null()) };
        assert!(!mapping.is_null(),"{}",io::Error::last_os_error());
        let mapping=unsafe { OwnedHandle::from_raw_handle(mapping) };
        struct View(MEMORY_MAPPED_VIEW_ADDRESS);
        impl Drop for View { fn drop(&mut self) { unsafe { UnmapViewOfFile(self.0); } } }
        let view=unsafe { MapViewOfFile(mapping.as_raw_handle(),FILE_MAP_READ,0,0,0) };
        assert!(!view.Value.is_null(),"{}",io::Error::last_os_error());
        let view=View(view);
        let expected=fs::remove_dir_all(&tree.0).unwrap_err().raw_os_error();
        let mut report=Value::Null;
        assert_eq!(remove_dir_all(&tree.0,&mut report).unwrap_err().raw_os_error(),expected);
        assert_eq!(expected,Some(ERROR_ACCESS_DENIED as i32));
        assert_eq!(report["apiFailureCount"],1);
        assert_eq!(report["terminalFailure"]["stage"],"SetFileInformationByHandle/FileDispositionInfoEx");
        assert_eq!(report["terminalFailure"]["relativePath"],"code/owned-test-image.exe");
        assert!(report["terminalFailure"]["ntstatus"].is_null());
        drop(view); drop(mapping); drop(file);
        remove_dir_all(&tree.0,&mut report).unwrap(); assert!(!tree.0.exists());
    }
    #[test]
    fn diagnostics_distinguish_recovered_and_terminal_failure_and_bound_unicode() {
        let mut trace=Trace::default();
        trace.failure(&[b'a' as u16],"SetFileInformationByHandle/FileDispositionInfoEx",87,None);
        let terminal=trace.failure(&vec![0xD800;10000],"NtOpenFile/delete",5,Some(0xC0000022u32 as i32));
        let report=trace.finish(Some(&terminal));
        assert_eq!(report["firstApiFailure"]["win32Error"],87);
        assert_eq!(report["terminalFailure"]["win32Error"],5);
        assert_eq!(report["terminalFailure"]["relativePathTruncated"],true);
        assert!(serde_json::to_vec(&report).unwrap().len()<=JSON_BUDGET);
        assert_eq!(size_of::<DirectoryBuffer>(),BUFFER_SIZE);
        assert_eq!(std::mem::align_of::<DirectoryBuffer>(),8);
        assert_eq!(std::mem::offset_of!(FILE_ID_BOTH_DIR_INFO,FileName),104);
    }
}

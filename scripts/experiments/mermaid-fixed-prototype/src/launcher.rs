//! Native ownership and bounded IPC for the separately authorized fixed-code prototype.
//! This is not an OS-wide no-network guarantee. No product entry point uses this module.
use crate::Result;
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    mem::size_of,
    os::windows::{
        ffi::OsStrExt,
        fs::{MetadataExt, OpenOptionsExt},
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Path, PathBuf},
    process::Command,
    ptr::{null, null_mut},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::ConvertSidToStringSidW, Isolation::*, *},
    Storage::FileSystem::*,
    System::{
        Com::CoTaskMemFree, JobObjects::*, Pipes::CreatePipe,
        SystemInformation::GetSystemDirectoryW, Threading::*, IO::CancelSynchronousIo,
    },
};

const MAX_INPUT: usize = 65_536;
const MAX_OUTPUT: usize = 262_144;
const MAX_READY: usize = 4_096;
const MAX_METADATA: usize = 32_768;
const MAX_STDERR: usize = 16_384;
const PREPARE_LIMIT: Duration = Duration::from_secs(10);
const RENDER_LIMIT: Duration = Duration::from_secs(2);
const JOB_MEMORY: usize = 512 * 1024 * 1024;
const JOB_PROCESSES: u32 = 16;

pub struct RunOutput {
    pub report: Value,
    pub metadata: Value,
    pub png: Vec<u8>,
}

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(Some(0)).collect()
}
fn check(ok: i32) -> Result<()> {
    if ok == 0 {
        Err(std::io::Error::last_os_error().into())
    } else {
        Ok(())
    }
}
fn hr(code: i32) -> Result<()> {
    if code < 0 {
        Err(format!("HRESULT {:#010x}", code as u32).into())
    } else {
        Ok(())
    }
}
unsafe fn owned(handle: HANDLE) -> Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        Err(std::io::Error::last_os_error().into())
    } else {
        Ok(OwnedHandle::from_raw_handle(handle))
    }
}
unsafe fn from_wide(ptr: *const u16) -> String {
    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}
fn sid_text(sid: PSID) -> Result<String> {
    let mut ptr = null_mut();
    check(unsafe { ConvertSidToStringSidW(sid, &mut ptr) })?;
    let result = unsafe { from_wide(ptr) };
    unsafe { LocalFree(ptr.cast()) };
    Ok(result)
}
fn token_buffer(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> Result<Vec<usize>> {
    let mut size = 0;
    unsafe { GetTokenInformation(token, class, null_mut(), 0, &mut size) };
    if size == 0 || size > 1024 * 1024 {
        return Err("Cannot size bounded token information".into());
    }
    let mut data = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
    check(unsafe { GetTokenInformation(token, class, data.as_mut_ptr().cast(), size, &mut size) })?;
    Ok(data)
}
fn token_u32(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> Result<u32> {
    let mut value = 0u32;
    let mut size = 0;
    check(unsafe {
        GetTokenInformation(token, class, (&mut value as *mut u32).cast(), 4, &mut size)
    })?;
    if size != 4 {
        return Err("Unexpected token scalar size".into());
    }
    Ok(value)
}
fn open_token(process: HANDLE, access: TOKEN_ACCESS_MASK) -> Result<OwnedHandle> {
    let mut raw = null_mut();
    check(unsafe { OpenProcessToken(process, access, &mut raw) })?;
    unsafe { owned(raw) }
}
fn token_groups(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> Result<Vec<(String, u32)>> {
    let storage = token_buffer(token, class)?;
    let bytes = storage.len() * size_of::<usize>();
    let offset = std::mem::offset_of!(TOKEN_GROUPS, Groups);
    // A zero-count variable-length structure need not include its declared [1]
    // element. Read the header without constructing an oversized Rust reference.
    let count = unsafe { storage.as_ptr().cast::<u32>().read() } as usize;
    count
        .checked_mul(size_of::<SID_AND_ATTRIBUTES>())
        .and_then(|length| offset.checked_add(length))
        .filter(|length| *length <= bytes)
        .ok_or("Token groups exceed the returned buffer")?;
    let groups = unsafe {
        std::slice::from_raw_parts(
            storage
                .as_ptr()
                .cast::<u8>()
                .add(offset)
                .cast::<SID_AND_ATTRIBUTES>(),
            count,
        )
    };
    groups
        .iter()
        .map(|group| Ok((sid_text(group.Sid)?, group.Attributes)))
        .collect()
}
fn debug_privilege_info(token: HANDLE) -> Result<Value> {
    // Name resolution and TOKEN_QUERY only: no AdjustTokenPrivileges, token
    // replacement, account changes, enablement or disablement is performed.
    let name = wide(OsStr::new("SeDebugPrivilege"));
    let mut luid = LUID::default();
    check(unsafe { LookupPrivilegeValueW(null(), name.as_ptr(), &mut luid) })?;
    let storage = token_buffer(token, TokenPrivileges)?;
    let bytes = storage.len() * size_of::<usize>();
    let offset = std::mem::offset_of!(TOKEN_PRIVILEGES, Privileges);
    let count = unsafe { storage.as_ptr().cast::<u32>().read() } as usize;
    count
        .checked_mul(size_of::<LUID_AND_ATTRIBUTES>())
        .and_then(|length| offset.checked_add(length))
        .filter(|length| *length <= bytes)
        .ok_or("Token privileges exceed the returned buffer")?;
    let privileges = unsafe {
        std::slice::from_raw_parts(
            storage
                .as_ptr()
                .cast::<u8>()
                .add(offset)
                .cast::<LUID_AND_ATTRIBUTES>(),
            count,
        )
    };
    let attributes = privileges
        .iter()
        .find(|privilege| {
            privilege.Luid.LowPart == luid.LowPart && privilege.Luid.HighPart == luid.HighPart
        })
        .map(|privilege| privilege.Attributes);
    Ok(json!({
        "present":attributes.is_some(),
        "enabled":attributes.is_some_and(|flags| flags & SE_PRIVILEGE_ENABLED != 0),
        "enabledByDefault":attributes.is_some_and(|flags| flags & SE_PRIVILEGE_ENABLED_BY_DEFAULT != 0),
        "attributes":attributes,
        "readOnlyObservation":true
    }))
}
fn token_info(process: HANDLE) -> Result<Value> {
    let token = open_token(process, TOKEN_QUERY)?;
    let token = token.as_raw_handle();
    let is_container = token_u32(token, TokenIsAppContainer)? != 0;
    let capabilities: Vec<_> = token_groups(token, TokenCapabilities)?
        .into_iter()
        .map(|(sid, attributes)| json!({"sid":sid,"attributes":attributes}))
        .collect();
    let groups = token_groups(token, TokenGroups)?;
    let mut admin_group_present = false;
    let mut admin_group_attributes = None;
    for (sid, attributes) in groups {
        if sid == "S-1-5-32-544" {
            admin_group_present = true;
            admin_group_attributes = Some(attributes);
        }
    }
    let user = token_buffer(token, TokenUser)?;
    let user_sid = sid_text(unsafe { (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid })?;
    let integrity = token_buffer(token, TokenIntegrityLevel)?;
    let label = unsafe { &*integrity.as_ptr().cast::<TOKEN_MANDATORY_LABEL>() };
    let count = unsafe { *GetSidSubAuthorityCount(label.Label.Sid) };
    if count == 0 {
        return Err("Missing token integrity RID".into());
    }
    let integrity_rid = unsafe { *GetSidSubAuthority(label.Label.Sid, u32::from(count) - 1) };
    let app_sid = if is_container {
        let data = token_buffer(token, TokenAppContainerSid)?;
        let sid = unsafe {
            (*(data.as_ptr().cast::<TOKEN_APPCONTAINER_INFORMATION>())).TokenAppContainer
        };
        Some(sid_text(sid)?)
    } else {
        None
    };
    let elevated = token_u32(token, TokenElevation)? != 0;
    let elevation_type = token_u32(token, TokenElevationType)?;
    let debug_privilege = debug_privilege_info(token)?;
    Ok(json!({
        "isAppContainer":is_container,"capabilityCount":capabilities.len(),
        "capabilities":capabilities,"appContainerSid":app_sid,"integrityRid":integrity_rid,
        "userSid":user_sid,"elevated":elevated,"elevationType":elevation_type,
        "administratorsGroupPresentIncludingDenyOnly":admin_group_present,
        "administratorsGroupAttributes":admin_group_attributes,
        "seDebugPrivilege":debug_privilege,
        "standardUserTokenEvidence":!elevated && !admin_group_present && elevation_type == TokenElevationTypeDefault as u32 && debug_privilege["present"] == false
    }))
}

/// Called by our fixed helper before creating WebView2; not a plugin-callable API.
pub fn child_token_report() -> Result<Value> {
    let token = token_info(unsafe { GetCurrentProcess() })?;
    if token["isAppContainer"] != true || token["capabilityCount"] != 0 {
        return Err("Fixed helper requires its zero-capability AppContainer token".into());
    }
    Ok(token)
}

struct Profile {
    name: Vec<u16>,
    sid: PSID,
    folder: Option<PathBuf>,
    deleted: bool,
    retain: bool,
}
impl Profile {
    fn create(name: &str) -> Result<Self> {
        let name = wide(OsStr::new(name));
        let mut sid = null_mut();
        hr(unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                name.as_ptr(),
                name.as_ptr(),
                null(),
                0,
                &mut sid,
            )
        })?;
        // Return ownership immediately after creation. All fallible follow-up
        // inspection runs only after the supervisor has stored this profile.
        Ok(Self {
            name,
            sid,
            folder: None,
            deleted: false,
            retain: false,
        })
    }
    fn initialize_folder(&mut self) -> Result<()> {
        let sid_text = wide(OsStr::new(&sid_text(self.sid)?));
        let mut folder = null_mut();
        let result = unsafe { GetAppContainerFolderPath(sid_text.as_ptr(), &mut folder) };
        hr(result)?;
        if folder.is_null() {
            return Err("AppContainer folder lookup returned no path".into());
        }
        self.folder = Some(PathBuf::from(unsafe { from_wide(folder) }));
        unsafe { CoTaskMemFree(folder.cast()) };
        Ok(())
    }
    fn delete(&mut self) -> Result<()> {
        hr(unsafe { DeleteAppContainerProfile(self.name.as_ptr()) })?;
        self.deleted = true;
        let folder = self.folder.as_ref().ok_or(
            "AppContainer delete API succeeded, but folder absence is unverified after initialization failure",
        )?;
        if folder.exists() {
            return Err("AppContainer profile folder remains after deletion".into());
        }
        Ok(())
    }
}
impl Drop for Profile {
    fn drop(&mut self) {
        if !self.deleted && !self.retain {
            let result = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
            if result < 0 {
                eprintln!("Fixed prototype emergency profile cleanup failed: {result:#x}");
            }
        }
        unsafe { FreeSid(self.sid) };
    }
}

struct Job(OwnedHandle);
impl Job {
    fn new() -> Result<Self> {
        let job = Self(unsafe { owned(CreateJobObjectW(null(), null()))? });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_JOB_MEMORY;
        limits.BasicLimitInformation.ActiveProcessLimit = JOB_PROCESSES;
        limits.JobMemoryLimit = JOB_MEMORY;
        check(unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        })?;
        Ok(job)
    }
    fn active(&self) -> Result<u32> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        check(unsafe {
            QueryInformationJobObject(
                self.0.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        })?;
        Ok(info.ActiveProcesses)
    }
    fn sample(&self) -> Result<Value> {
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        check(unsafe {
            QueryInformationJobObject(
                self.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                null_mut(),
            )
        })?;
        let mut storage = vec![0usize; JOB_PROCESSES as usize + 4];
        check(unsafe {
            QueryInformationJobObject(
                self.0.as_raw_handle(),
                JobObjectBasicProcessIdList,
                storage.as_mut_ptr().cast(),
                (storage.len() * size_of::<usize>()) as u32,
                null_mut(),
            )
        })?;
        let ids = unsafe { &*storage.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
        if ids.NumberOfProcessIdsInList != ids.NumberOfAssignedProcesses
            || ids.NumberOfProcessIdsInList > JOB_PROCESSES
        {
            return Err("Incomplete bounded Job process enumeration".into());
        }
        let pids = unsafe {
            std::slice::from_raw_parts(
                std::ptr::addr_of!(ids.ProcessIdList).cast::<usize>(),
                ids.NumberOfProcessIdsInList as usize,
            )
        };
        let members: Vec<_> = pids.iter().map(|&pid| {
            let inspect = (|| -> Result<Value> {
                let process = unsafe { owned(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32))? };
                let token = token_info(process.as_raw_handle())?;
                let mut path = vec![0u16; 32768];
                let mut len = path.len() as u32;
                check(unsafe { QueryFullProcessImageNameW(process.as_raw_handle(), 0, path.as_mut_ptr(), &mut len) })?;
                Ok(json!({"pid":pid,"image":String::from_utf16_lossy(&path[..len as usize]),"token":token}))
            })();
            inspect.unwrap_or_else(|error| json!({"pid":pid,"inspectionError":error.to_string()}))
        }).collect();
        Ok(
            json!({"active":ids.NumberOfAssignedProcesses,"members":members,
            "peakJobMemoryBytes":limits.PeakJobMemoryUsed,"peakProcessMemoryBytes":limits.PeakProcessMemoryUsed,
            "jobMemoryLimitBytes":limits.JobMemoryLimit,"activeProcessLimit":limits.BasicLimitInformation.ActiveProcessLimit,
            "limitFlags":limits.BasicLimitInformation.LimitFlags}),
        )
    }
    fn stop(&self) -> Result<()> {
        check(unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) })?;
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.active()? != 0 {
            if Instant::now() >= deadline {
                return Err("Job did not confirm zero descendants after termination".into());
            }
            thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    }
}

struct Attributes {
    storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}
impl Attributes {
    fn new(caps: &SECURITY_CAPABILITIES, job: &HANDLE, handles: &[HANDLE; 3]) -> Result<Self> {
        let mut bytes = 0;
        unsafe { InitializeProcThreadAttributeList(null_mut(), 3, 0, &mut bytes) };
        if bytes == 0 {
            return Err("Cannot size restricted process attributes".into());
        }
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let pointer = storage.as_mut_ptr().cast();
        check(unsafe { InitializeProcThreadAttributeList(pointer, 3, 0, &mut bytes) })?;
        let attrs = Self { storage, pointer };
        for (kind, value, length) in [
            (
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                (caps as *const SECURITY_CAPABILITIES).cast(),
                size_of::<SECURITY_CAPABILITIES>(),
            ),
            (
                PROC_THREAD_ATTRIBUTE_JOB_LIST,
                (job as *const HANDLE).cast(),
                size_of::<HANDLE>(),
            ),
            (
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                handles.as_ptr().cast(),
                size_of::<[HANDLE; 3]>(),
            ),
        ] {
            check(unsafe {
                UpdateProcThreadAttribute(
                    pointer,
                    0,
                    kind as usize,
                    value,
                    length,
                    null_mut(),
                    null(),
                )
            })?;
        }
        Ok(attrs)
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.pointer) };
        std::hint::black_box(&self.storage);
    }
}
fn pipe(parent_reads: bool) -> Result<(File, OwnedHandle)> {
    let mut read = null_mut();
    let mut write = null_mut();
    let attrs = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    check(unsafe { CreatePipe(&mut read, &mut write, &attrs, 4096) })?;
    let (read, write) = unsafe { (owned(read)?, owned(write)?) };
    let (parent, child) = if parent_reads {
        (read, write)
    } else {
        (write, read)
    };
    check(unsafe { SetHandleInformation(parent.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) })?;
    Ok((File::from(parent), child))
}

fn system_directory() -> Result<PathBuf> {
    let mut path = vec![0u16; 32768];
    let len = unsafe { GetSystemDirectoryW(path.as_mut_ptr(), path.len() as u32) } as usize;
    if len == 0 || len >= path.len() {
        return Err("Cannot identify the native system directory".into());
    }
    Ok(PathBuf::from(String::from_utf16_lossy(&path[..len])))
}
fn acl(system: &Path, path: &Path, args: &[String], report: &mut Value) -> Result<()> {
    let output = Command::new(system.join("icacls.exe"))
        .arg(path)
        .args(args)
        .output()?;
    report.as_array_mut().ok_or("ACL audit must be an array")?.push(json!({
        "path":path,"arguments":args,"exitCode":output.status.code(),
        "stdout":String::from_utf8_lossy(&output.stdout),"stderr":String::from_utf8_lossy(&output.stderr)
    }));
    if !output.status.success() {
        return Err("Exact private-directory ACL operation failed; no broader fallback".into());
    }
    Ok(())
}
fn reject_reparse_ancestors(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        let metadata = fs::symlink_metadata(ancestor)?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(format!(
                "Reparse point rejected in private execution ancestry: {}",
                ancestor.display()
            )
            .into());
        }
    }
    Ok(())
}
fn pinned_copy(source: &Path, destination: &Path) -> Result<(File, File)> {
    reject_reparse_ancestors(source)?;
    let mut original = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(source)?;
    let mut copy = OpenOptions::new()
        .write(true)
        .create_new(true)
        .share_mode(0)
        .open(destination)?;
    std::io::copy(&mut original, &mut copy)?;
    copy.sync_all()?;
    drop(copy);
    let copy = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(destination)?;
    // Compare against the still write/delete-pinned build artifact; neither side
    // may be changed while its executable image is selected and bound at launch.
    let mut a = original.try_clone()?;
    let mut b = copy.try_clone()?;
    use std::io::{Seek, SeekFrom};
    a.seek(SeekFrom::Start(0))?;
    b.seek(SeekFrom::Start(0))?;
    let mut left = [0u8; 65536];
    let mut right = [0u8; 65536];
    loop {
        let n = a.read(&mut left)?;
        let m = b.read(&mut right)?;
        if n != m || left[..n] != right[..m] {
            return Err("Private executable copy differs from the pinned source".into());
        }
        if n == 0 {
            break;
        }
    }
    Ok((original, copy))
}

struct RevertGuard;
impl Drop for RevertGuard {
    fn drop(&mut self) {
        if unsafe { RevertToSelf() } == 0 {
            // Never continue privileged parent work with uncertain thread identity.
            std::process::abort();
        }
    }
}
fn check_code_parent_access(process: HANDLE, code: &Path) -> Result<Value> {
    let source = open_token(process, TOKEN_QUERY | TOKEN_DUPLICATE)?;
    let mut duplicate = null_mut();
    check(unsafe {
        DuplicateToken(
            source.as_raw_handle(),
            SecurityImpersonation,
            &mut duplicate,
        )
    })?;
    let duplicate = unsafe { owned(duplicate)? };
    check(unsafe { ImpersonateLoggedOnUser(duplicate.as_raw_handle()) })?;
    let _revert = RevertGuard;
    let mut checks = Vec::new();
    for path in code.ancestors().filter(|p| !p.as_os_str().is_empty()) {
        let wide_path = wide(path.as_os_str());
        for (name, rights) in [
            ("add-file", FILE_ADD_FILE),
            ("add-directory", FILE_ADD_SUBDIRECTORY),
            ("delete-child", FILE_DELETE_CHILD),
            ("delete", DELETE),
            ("write-dacl", WRITE_DAC),
            ("write-owner", WRITE_OWNER),
        ] {
            let handle = unsafe {
                CreateFileW(
                    wide_path.as_ptr(),
                    rights,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    null(),
                    OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                    null_mut(),
                )
            };
            if handle != INVALID_HANDLE_VALUE {
                drop(unsafe { owned(handle)? });
                return Err(format!(
                    "AppContainer can {name} at execution ancestor {}",
                    path.display()
                )
                .into());
            }
            let error = std::io::Error::last_os_error();
            checks.push(json!({"path":path,"right":name,"rawOsError":error.raw_os_error()}));
            if error.raw_os_error() != Some(ERROR_ACCESS_DENIED as i32) {
                return Err(format!(
                    "Execution ancestry access denial uncertain for {name}: {error}"
                )
                .into());
            }
        }
    }
    Ok(json!(checks))
}

struct Spawned {
    process: OwnedHandle,
    thread: OwnedHandle,
    input: File,
    output: File,
    error: File,
}
fn launch(
    exe: &Path,
    runtime: &Path,
    state: &Path,
    system: &Path,
    profile: &Profile,
    job: &Job,
) -> Result<Spawned> {
    for path in [exe, runtime, state, system] {
        if !path.is_absolute()
            || path
                .as_os_str()
                .encode_wide()
                .any(|c| c == 0 || c == b'"' as u16)
        {
            return Err("Invalid fixed-helper native path".into());
        }
    }
    let (input, child_input) = pipe(false)?;
    let (output, child_output) = pipe(true)?;
    let (error, child_error) = pipe(true)?;
    let handles = [
        child_input.as_raw_handle(),
        child_output.as_raw_handle(),
        child_error.as_raw_handle(),
    ];
    let caps = SECURITY_CAPABILITIES {
        AppContainerSid: profile.sid,
        Capabilities: null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };
    let raw_job = job.0.as_raw_handle();
    let attrs = Attributes::new(&caps, &raw_job, &handles)?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = attrs.pointer;
    let mut command = wide(OsStr::new(&format!(
        "\"{}\" --render-child \"{}\" \"{}\"",
        exe.display(),
        runtime.display(),
        state.display()
    )));
    let application = wide(exe.as_os_str());
    let cwd = wide(state.as_os_str());
    let system_root = system.parent().ok_or("Invalid system directory")?;
    let drive = system_root
        .to_string_lossy()
        .chars()
        .take(2)
        .collect::<String>();
    if !drive.ends_with(':') {
        return Err("Unsupported system drive".into());
    }
    // Deliberately omit WEBVIEW2_*, user credentials/profile, plugin configuration,
    // debugger options and every inherited handle except the three protocol pipes.
    let environment = format!("APPDATA={}\0LOCALAPPDATA={}\0PATH={}\0SystemDrive={}\0SystemRoot={}\0TEMP={}\0TMP={}\0USERPROFILE={}\0WINDIR={}\0\0",
        state.display(), state.display(), system.display(), drive, system_root.display(), state.display(), state.display(), state.display(), system_root.display());
    let environment: Vec<u16> = environment.encode_utf16().collect();
    let mut info = PROCESS_INFORMATION::default();
    check(unsafe {
        CreateProcessW(
            application.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            1,
            CREATE_SUSPENDED
                | EXTENDED_STARTUPINFO_PRESENT
                | CREATE_UNICODE_ENVIRONMENT
                | CREATE_NO_WINDOW,
            environment.as_ptr().cast(),
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut info,
        )
    })?;
    Ok(Spawned {
        process: unsafe { owned(info.hProcess)? },
        thread: unsafe { owned(info.hThread)? },
        input,
        output,
        error,
    })
}

enum Event {
    Ready(Value),
    Result(Value, Vec<u8>, usize),
    Written,
    Error(String),
}
fn read_exact_bounded(
    reader: &mut File,
    count: usize,
    total: &mut usize,
) -> std::result::Result<Vec<u8>, String> {
    *total = total
        .checked_add(count)
        .filter(|n| *n <= MAX_OUTPUT)
        .ok_or("Output aggregate budget exceeded")?;
    let mut data = vec![0; count];
    reader.read_exact(&mut data).map_err(|e| e.to_string())?;
    Ok(data)
}
fn read_frame(
    reader: &mut File,
    cap: usize,
    total: &mut usize,
) -> std::result::Result<Value, String> {
    let prefix = read_exact_bounded(reader, 4, total)?;
    let bytes = u32::from_le_bytes(prefix.try_into().unwrap()) as usize;
    if bytes == 0 || bytes > cap {
        return Err("JSON frame exceeds its bounded schema envelope".into());
    }
    let data = read_exact_bounded(reader, bytes, total)?;
    serde_json::from_slice(&data).map_err(|e| e.to_string())
}
fn output_reader(mut output: File, tx: mpsc::Sender<Event>) -> std::result::Result<(), String> {
    let result = (|| -> std::result::Result<(), String> {
        let mut total = 0;
        let ready = read_frame(&mut output, MAX_READY, &mut total)?;
        if ready["phase"] != "ready" {
            return Err("Helper did not send the expected ready frame".into());
        }
        tx.send(Event::Ready(ready)).map_err(|e| e.to_string())?;
        let metadata = read_frame(&mut output, MAX_METADATA, &mut total)?;
        let bytes = metadata["pngBytes"]
            .as_u64()
            .ok_or("Missing PNG byte length")?;
        if bytes > MAX_OUTPUT as u64 {
            return Err("PNG byte length exceeds budget".into());
        }
        let png = read_exact_bounded(&mut output, bytes as usize, &mut total)?;
        // Let the native owner stop the Job immediately after the complete frame.
        // Browser descendants may still own a duplicate of stdout; EOF is not
        // part of successful rendering and cannot be awaited before that stop.
        tx.send(Event::Result(metadata, png, total))
            .map_err(|e| e.to_string())?;
        let mut tail = [0u8; 1];
        match output.read(&mut tail) {
            Ok(0) => (),
            Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => (),
            Ok(_) => return Err("Unexpected trailing helper output".into()),
            Err(error) => return Err(error.to_string()),
        }
        Ok(())
    })();
    if let Err(error) = &result {
        let _ = tx.send(Event::Error(error.clone()));
    }
    result
}

fn join_bounded<T>(
    thread: thread::JoinHandle<T>,
    name: &str,
    errors: &mut Vec<String>,
) -> Option<T> {
    let started = Instant::now();
    let mut cancelled = false;
    while !thread.is_finished() && started.elapsed() < Duration::from_millis(250) {
        if !cancelled && started.elapsed() >= Duration::from_millis(50) {
            // A failed ownership proof must not hang the supervisor just because
            // an unexpected process retained a pipe. Cancel only our own thread's
            // synchronous pipe I/O, never an unowned process or another job.
            let result = unsafe { CancelSynchronousIo(thread.as_raw_handle()) };
            let error = std::io::Error::last_os_error();
            if result == 0 && error.raw_os_error() != Some(ERROR_NOT_FOUND as i32) {
                errors.push(format!("Cannot cancel {name} pipe I/O: {error}"));
            }
            errors.push(format!(
                "{name} did not resolve after owned-process termination; I/O cancellation required"
            ));
            cancelled = true;
        }
        thread::sleep(Duration::from_millis(5));
    }
    if !thread.is_finished() {
        errors.push(format!("{name} thread failed to terminate within bounded cleanup; supervisor must stop after preserving this report"));
        return None;
    }
    match thread.join() {
        Ok(value) => Some(value),
        Err(_) => {
            errors.push(format!("{name} thread panicked"));
            None
        }
    }
}

/// Each call creates a new profile/process tree; failures stay failures and never
/// retry with an ordinary token, weaker Job, alternative Runtime or broader ACL.
pub fn run(runtime: &Path, input: &Value) -> Result<RunOutput> {
    let input_bytes = serde_json::to_vec(input)?;
    if input_bytes.len() > MAX_INPUT || input_bytes.is_empty() {
        return Err("Input JSON exceeds the fixed prototype budget".into());
    }
    let runtime = fs::canonicalize(runtime)?;
    if !runtime.join("msedgewebview2.exe").is_file() {
        return Err("Installed Runtime absent; no installation or download fallback".into());
    }
    let host_token = token_info(unsafe { GetCurrentProcess() })?;
    let expected_user = std::env::var("MILKUP_MERMAID_PROTOTYPE_EXPECTED_USER_SID")
        .map_err(|_| "Missing expected temporary standard-user SID")?;
    if host_token["standardUserTokenEvidence"] != true
        || host_token["userSid"].as_str() != Some(expected_user.as_str())
    {
        return Err("Launcher is not the authorized temporary standard-user token".into());
    }
    let cleanup_owner = std::env::var("MILKUP_MERMAID_PROTOTYPE_CLEANUP_OWNER_SID")
        .map_err(|_| "Missing supervising runner cleanup SID")?;
    if !crate::cleanup::concrete_user_sid(&cleanup_owner) || cleanup_owner == expected_user {
        return Err("Cleanup owner must be the distinct concrete supervising user SID".into());
    }
    let unique = format!(
        "milkup-fixed-mermaid-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    );
    let temp = fs::canonicalize(std::env::temp_dir())?;
    reject_reparse_ancestors(&temp)?;
    let root = temp.join(&unique);
    fs::create_dir(&root)?; // CREATE_NEW semantics: a preexisting path is a hard failure.
    let mut report = json!({"name":unique,"runtime":runtime,"privateRoot":root,
        "hostToken":host_token,"standardUserEvidence":host_token["standardUserTokenEvidence"],
        "cleanupSupervisorSid":cleanup_owner,
        "standardUserMeaning":"Host token has neither elevated status nor an Administrators SID, including deny-only membership, and SeDebugPrivilege is absent; CI location alone is not standard-user evidence. Privileges are observed without adjustment.",
        "jobMemoryLimitBytes":JOB_MEMORY,"jobProcessLimit":JOB_PROCESSES,
        "prepareDeadlineMs":PREPARE_LIMIT.as_millis(),"renderDeadlineMs":RENDER_LIMIT.as_millis(),
        "aclOperations":[],"productIntegrated":false,"networkGuarantee":false,
        "runtimeInstalled":false,"firewallChanged":false,"systemAclChanged":false,"elevationRequested":false});
    let mut profile = None;
    let mut job = None;
    let mut pins = None;
    let mut readers = Vec::new();
    let mut writer = None;
    let mut stderr_reader = None;
    let mut metadata = json!({"status":"error","pngBytes":0});
    let mut png = Vec::new();
    let outcome = (|| -> Result<()> {
        let system = system_directory()?;
        profile = Some(Profile::create(&unique)?);
        report["profileCreated"] = json!(true);
        // Ownership is already visible to the checked cleanup path if either
        // SID conversion or folder lookup fails; Drop-only cleanup cannot hide it.
        profile.as_mut().unwrap().initialize_folder()?;
        let profile = profile.as_ref().unwrap();
        let sid = sid_text(profile.sid)?;
        report["appContainerSid"] = json!(sid);
        report["profileFolder"] = json!(profile.folder);
        let owner_sid = host_token["userSid"]
            .as_str()
            .ok_or("Missing host owner SID")?;
        // Reset only this freshly created root: owner/SYSTEM and the exact
        // supervising runner retain cleanup access. No existing object ACL changes.
        // this AppContainer can traverse/read/execute but cannot replace code.
        acl(
            &system,
            &root,
            &[
                "/inheritance:r".into(),
                "/grant:r".into(),
                format!("*{owner_sid}:(OI)(CI)F"),
                "*S-1-5-18:(OI)(CI)F".into(),
                format!("*{cleanup_owner}:(OI)(CI)F"),
                format!("*{sid}:(OI)(CI)RX"),
            ],
            &mut report["aclOperations"],
        )?;
        let code = root.join("code");
        let state = root.join("state");
        fs::create_dir(&code)?;
        fs::create_dir(&state)?;
        // Only this sibling contains UDF/temp. Never recurse an F grant over root/code.
        acl(
            &system,
            &state,
            &["/grant:r".into(), format!("*{sid}:(OI)(CI)F")],
            &mut report["aclOperations"],
        )?;
        acl(
            &system,
            &state,
            &["/setintegritylevel".into(), "(OI)(CI)L".into()],
            &mut report["aclOperations"],
        )?;
        fs::create_dir(state.join("udf"))?;
        let exe = code.join("mermaid-fixed-prototype.exe");
        pins = Some(pinned_copy(&std::env::current_exe()?, &exe)?);
        reject_reparse_ancestors(&exe)?;
        report["privateExecutableBytes"] = json!(fs::metadata(&exe)?.len());
        job = Some(Job::new()?);
        let job = job.as_ref().unwrap();
        let Spawned {
            process,
            thread: primary_thread,
            input: mut child_input,
            output: child_output,
            error: child_error,
        } = launch(&exe, &runtime, &state, &system, profile, job)?;
        let child_token = token_info(process.as_raw_handle())?;
        report["suspendedToken"] = child_token.clone();
        if child_token["isAppContainer"] != true
            || child_token["elevated"] != false
            || child_token["seDebugPrivilege"]["present"] != false
            || child_token["capabilityCount"] != 0
            || child_token["appContainerSid"] != sid
            || job.active()? != 1
        {
            return Err("Suspended child identity or creation-time Job binding mismatch".into());
        }
        report["executionAncestryAccessDenials"] =
            check_code_parent_access(process.as_raw_handle(), &code)?;
        report["suspendedJob"] = job.sample()?;
        let (tx, rx) = mpsc::channel();
        let output_tx = tx.clone();
        readers.push(thread::spawn(move || {
            output_reader(child_output, output_tx)
        }));
        let error_tx = tx.clone();
        stderr_reader = Some(thread::spawn(move || {
            let mut bytes = Vec::new();
            match child_error
                .take((MAX_STDERR + 1) as u64)
                .read_to_end(&mut bytes)
            {
                Ok(_) if bytes.len() <= MAX_STDERR => (bytes, false),
                result => {
                    let _ = error_tx.send(Event::Error(format!(
                        "Helper stderr budget/read failure: {result:?}"
                    )));
                    bytes.truncate(MAX_STDERR);
                    (bytes, true)
                }
            }
        }));
        let prepare_started = Instant::now();
        if unsafe { ResumeThread(primary_thread.as_raw_handle()) } == u32::MAX {
            return Err(std::io::Error::last_os_error().into());
        }
        match rx.recv_timeout(PREPARE_LIMIT)? {
            Event::Ready(ready) => report["ready"] = ready,
            Event::Error(error) => return Err(error.into()),
            _ => return Err("Invalid helper preparation event".into()),
        }
        let browser_pid = report["ready"]["browserProcessId"]
            .as_u64()
            .filter(|pid| *pid > 0 && *pid <= u32::MAX as u64)
            .ok_or("Missing native WebView2 browser process ID")? as u32;
        let browser = unsafe {
            owned(OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                browser_pid,
            ))?
        };
        let mut in_job = 0;
        check(unsafe {
            IsProcessInJob(browser.as_raw_handle(), job.0.as_raw_handle(), &mut in_job)
        })?;
        report["browserProcessInOwnedJob"] = json!(in_job != 0);
        report["browserToken"] = token_info(browser.as_raw_handle())?;
        if in_job == 0
            || report["browserToken"]["isAppContainer"] != true
            || report["browserToken"]["capabilityCount"] != 0
            || report["browserToken"]["elevated"] != false
            || report["browserToken"]["seDebugPrivilege"]["present"] != false
        {
            return Err("WebView2 browser lacks the required Job/zero-capability AppContainer boundary; refusing render".into());
        }
        report["prepareElapsedMs"] = json!(prepare_started.elapsed().as_millis());
        report["readyJob"] = job.sample()?;
        let render_started = Instant::now();
        let render_deadline = render_started + RENDER_LIMIT;
        let input_len = input_bytes.len() as u32;
        writer = Some(thread::spawn(move || {
            let result = child_input
                .write_all(&input_len.to_le_bytes())
                .and_then(|_| child_input.write_all(&input_bytes))
                .and_then(|_| child_input.flush());
            let event = match result {
                Ok(()) => Event::Written,
                Err(error) => Event::Error(error.to_string()),
            };
            let _ = tx.send(event);
        }));
        let mut written = false;
        let mut result = None;
        loop {
            if Instant::now() >= render_deadline {
                return Err("Native render deadline expired".into());
            }
            match rx.recv_timeout(render_deadline.saturating_duration_since(Instant::now()))? {
                Event::Written => written = true,
                Event::Result(meta, bytes, total) => {
                    report["outputProtocolBytes"] = json!(total);
                    result = Some((meta, bytes));
                }
                Event::Error(error) => return Err(error.into()),
                Event::Ready(_) => return Err("Duplicate ready frame".into()),
            }
            if written && result.is_some() {
                break;
            }
        }
        report["renderElapsedMs"] = json!(render_started.elapsed().as_millis());
        report["completedJob"] = job.sample()?;
        let (meta, bytes) = result.unwrap();
        metadata = meta;
        png = bytes;
        report["rendererMetadata"] = metadata.clone();
        if metadata["status"] != "ok" {
            return Err("Fixed renderer returned a bounded failure".into());
        }
        Ok(())
    })();
    let mut cleanup_errors = Vec::new();
    let mut empty = true;
    if let Some(job) = &job {
        report["preStopJob"] = job
            .sample()
            .unwrap_or_else(|e| json!({"inspectionError":e.to_string()}));
        if let Err(error) = job.stop() {
            empty = false;
            cleanup_errors.push(error.to_string());
        } else {
            report["jobActiveAfterStop"] = json!(0);
        }
    }
    // Even an unexpected leaked handle cannot make these joins unbounded. Any
    // cancellation/pending thread is a failed run; the caller must end the
    // matrix after saving this report, rather than starting another helper.
    let mut ipc_threads_completed = true;
    for reader in readers {
        match join_bounded(reader, "stdout", &mut cleanup_errors) {
            Some(Ok(())) => (),
            Some(Err(error)) => cleanup_errors.push(format!("stdout protocol: {error}")),
            None => ipc_threads_completed = false,
        }
    }
    if let Some(writer) = writer {
        if join_bounded(writer, "stdin", &mut cleanup_errors).is_none() {
            ipc_threads_completed = false;
        }
    }
    if let Some(reader) = stderr_reader {
        match join_bounded(reader, "stderr", &mut cleanup_errors) {
            Some((bytes, exceeded)) => {
                report["stderr"] = json!(String::from_utf8_lossy(&bytes));
                report["stderrExceededBudget"] = json!(exceeded);
                if exceeded {
                    cleanup_errors.push("stderr protocol budget failed".into());
                }
            }
            None => ipc_threads_completed = false,
        }
    }
    report["ipcThreadsCompleted"] = json!(ipc_threads_completed);
    report["stopMatrixAfterThisCase"] = json!(!ipc_threads_completed || !empty);
    drop(job); // KILL_ON_JOB_CLOSE remains the last-resort ownership boundary.
    drop(pins);
    if empty {
        if let Some(profile) = &mut profile {
            match profile.delete() {
                Ok(()) => report["profileDeletedAndFolderAbsent"] = json!(true),
                Err(e) => cleanup_errors.push(format!("AppContainer profile deletion: {e}")),
            }
            report["profileDeleteApiSucceeded"] = json!(profile.deleted);
        }
        let mut delete_attempts = Vec::new();
        report["privateTreeRemoved"] = json!(false);
        match crate::cleanup::remove_owned_tree(&root, &mut delete_attempts) {
            Ok(()) => report["privateTreeRemoved"] = json!(true),
            Err(error) => cleanup_errors.push(format!("Private tree deletion: {error}")),
        }
        report["privateTreeDeleteAttempts"] = json!(delete_attempts);
    } else {
        if let Some(profile) = &mut profile {
            profile.retain = true;
        }
        cleanup_errors.push(
            "Private files/profile retained because process emptiness was not established".into(),
        );
    }
    report["cleanupErrors"] = json!(cleanup_errors);
    report["stopMatrixAfterThisCase"] =
        json!(!ipc_threads_completed || !empty || !cleanup_errors.is_empty());
    report["success"] = json!(outcome.is_ok() && cleanup_errors.is_empty());
    if let Err(error) = outcome {
        report["error"] = json!(error.to_string());
        metadata = json!({"status":"error","pngBytes":0,"message":error.to_string()});
        png.clear();
    }
    if !cleanup_errors.is_empty() {
        metadata =
            json!({"status":"error","pngBytes":0,"message":"Native ownership cleanup incomplete"});
        png.clear();
    }
    Ok(RunOutput {
        report,
        metadata,
        png,
    })
}

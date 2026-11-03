//! Same-login, creation-time Job ownership for the fixed product engine.
use crate::ipc_observation::{Completion, Phase, Progress};
use crate::{Control, Result};
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
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::ConvertSidToStringSidW, Isolation::*, *},
    Storage::FileSystem::*,
    System::{
        Com::CoTaskMemFree, JobObjects::*, Pipes::CreatePipe, RemoteDesktop::ProcessIdToSessionId,
        SystemInformation::GetSystemDirectoryW, Threading::*, IO::CancelSynchronousIo,
    },
};

const MAX_INPUT: usize = 65_536;
const MAX_OUTPUT: usize = crate::MAX_OUTPUT + 65_536;
const MAX_READY: usize = crate::token_ready::MAX_READY;
const MAX_METADATA: usize = 32_768;
const MAX_STDERR: usize = 16_384;
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
struct Privileges {
    debug: Value,
    count: usize,
    host_disallowed: usize,
    sandbox_disallowed: usize,
}
fn privilege_info(token: HANDLE) -> Result<Privileges> {
    // Name resolution and TOKEN_QUERY only: no AdjustTokenPrivileges, token
    // replacement, account changes, enablement or disablement is performed.
    // Closed ordinary-interactive-user allowlist. Presence, including disabled
    // presence, counts: an untrusted process can enable a privilege it holds.
    let names = [
        "SeChangeNotifyPrivilege",
        "SeShutdownPrivilege",
        "SeUndockPrivilege",
        "SeIncreaseWorkingSetPrivilege",
        "SeTimeZonePrivilege",
        "SeDebugPrivilege",
    ];
    let mut luids = Vec::new();
    for name in names {
        let name = wide(OsStr::new(name));
        let mut luid = LUID::default();
        check(unsafe { LookupPrivilegeValueW(null(), name.as_ptr(), &mut luid) })?;
        luids.push(luid);
    }
    let storage = token_buffer(token, TokenPrivileges)?;
    let bytes = storage.len() * size_of::<usize>();
    let offset = std::mem::offset_of!(TOKEN_PRIVILEGES, Privileges);
    let count = unsafe { storage.as_ptr().cast::<u32>().read() } as usize;
    if count > 64 {
        return Err("Token privilege count exceeds the observation budget".into());
    }
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
    let equal_luid = |a: &LUID, b: &LUID| a.LowPart == b.LowPart && a.HighPart == b.HighPart;
    let attributes = privileges
        .iter()
        .find(|privilege| equal_luid(&privilege.Luid, &luids[5]))
        .map(|privilege| privilege.Attributes);
    let debug = json!({
        "present":attributes.is_some(),
        "enabled":attributes.is_some_and(|flags| flags & SE_PRIVILEGE_ENABLED != 0),
        "enabledByDefault":attributes.is_some_and(|flags| flags & SE_PRIVILEGE_ENABLED_BY_DEFAULT != 0),
        "attributes":attributes,
        "readOnlyObservation":true
    });
    Ok(Privileges {
        debug,
        count,
        host_disallowed: privileges
            .iter()
            .filter(|privilege| {
                !luids[..5]
                    .iter()
                    .any(|luid| equal_luid(&privilege.Luid, luid))
            })
            .count(),
        sandbox_disallowed: privileges
            .iter()
            // Exact ordinary capabilities only. IncreaseWorkingSet adjusts
            // residency, not the owned Job's committed-memory limit. Presence
            // of every other privilege (even disabled) remains a rejection.
            .filter(|privilege| {
                !equal_luid(&privilege.Luid, &luids[0]) && !equal_luid(&privilege.Luid, &luids[3])
            })
            .count(),
    })
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
    let owner = token_buffer(token, TokenOwner)?;
    let owner_sid = sid_text(unsafe { (*(owner.as_ptr().cast::<TOKEN_OWNER>())).Owner })?;
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
    let privileges = privilege_info(token)?;
    Ok(json!({
        "isAppContainer":is_container,"capabilityCount":capabilities.len(),
        "capabilities":capabilities,"appContainerSid":app_sid,"integrityRid":integrity_rid,
        "userSid":user_sid,"ownerSid":owner_sid,"elevated":elevated,"elevationType":elevation_type,
        "tokenType":token_u32(token, TokenType)?,"sessionId":token_u32(token, TokenSessionId)?,
        "uiAccess":token_u32(token, TokenUIAccess)? != 0,
        "administratorsGroupPresentIncludingDenyOnly":admin_group_present,
        "administratorsGroupAttributes":admin_group_attributes,
        "seDebugPrivilege":privileges.debug,
        "privilegeCount":privileges.count,
        "hostDisallowedPrivilegeCount":privileges.host_disallowed,
        "sandboxDisallowedPrivilegeCount":privileges.sandbox_disallowed,
        "standardUserTokenEvidence":!elevated && !admin_group_present && elevation_type == TokenElevationTypeDefault as u32 && privileges.debug["present"] == false
    }))
}

fn linked_authority(process: HANDLE, elevation_type: u64) -> Result<Value> {
    let mut proof = json!({"callerThreadTokenAbsent":false,
        "callerThreadQueryWin32Error":null,"queryAttempted":false,"querySucceeded":false,
        "queryWin32Error":null,"targetTokenType":null,"targetImpersonationLevel":null,
        "targetQueryWin32Error":null});
    let mut thread_token = null_mut();
    let result = unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 0, &mut thread_token) };
    if result != 0 {
        // Unexpected impersonation is never interpreted as the process caller.
        drop(unsafe { owned(thread_token)? });
        return Ok(proof);
    }
    let error = unsafe { GetLastError() };
    proof["callerThreadQueryWin32Error"] = json!(error);
    if error != ERROR_NO_TOKEN {
        return Ok(proof);
    }
    proof["callerThreadTokenAbsent"] = json!(true);
    if elevation_type != TokenElevationTypeLimited as u64 {
        // Default explicitly has no linked association. Unsupported elevation
        // types are rejected by verify_sandbox, never treated as Default here.
        return Ok(proof);
    }
    let token = open_token(process, TOKEN_QUERY)?;
    let mut linked = TOKEN_LINKED_TOKEN {
        LinkedToken: null_mut(),
    };
    let mut returned = 0;
    proof["queryAttempted"] = json!(true);
    let result = unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenLinkedToken,
            (&mut linked as *mut TOKEN_LINKED_TOKEN).cast(),
            size_of::<TOKEN_LINKED_TOKEN>() as u32,
            &mut returned,
        )
    };
    if result == 0 {
        proof["queryWin32Error"] = json!(unsafe { GetLastError() });
        return Ok(proof);
    }
    // This returned handle can have full TOKEN_ALL_ACCESS (observed 0xF01FF).
    // Its rights are NOT claimed to be query-only. We only query its token type
    // and level and immediately close it; no duplicate/adjust/impersonate/launch.
    let linked = unsafe { owned(linked.LinkedToken)? };
    proof["querySucceeded"] = json!(true);
    if returned as usize != size_of::<TOKEN_LINKED_TOKEN>() {
        return Ok(proof);
    }
    match token_u32(linked.as_raw_handle(), TokenType) {
        Ok(kind) => {
            proof["targetTokenType"] = json!(kind);
            if kind == TokenImpersonation as u32 {
                match token_u32(linked.as_raw_handle(), TokenImpersonationLevel) {
                    Ok(level) => proof["targetImpersonationLevel"] = json!(level),
                    Err(error) => {
                        proof["targetQueryWin32Error"] = json!(error
                            .downcast_ref::<std::io::Error>()
                            .and_then(|error| error.raw_os_error()))
                    }
                }
            }
        }
        Err(error) => {
            proof["targetQueryWin32Error"] = json!(error
                .downcast_ref::<std::io::Error>()
                .and_then(|error| error.raw_os_error()))
        }
    }
    Ok(proof)
}

fn sandbox_token_info(process: HANDLE) -> Result<Value> {
    let mut token = token_info(process)?;
    token["linkedAuthority"] = linked_authority(
        process,
        token["elevationType"]
            .as_u64()
            .ok_or("Missing token elevation type")?,
    )?;
    Ok(token)
}

/// Called by our fixed helper before creating WebView2; not a plugin-callable API.
pub fn child_token_report() -> Result<Value> {
    let token = sandbox_token_info(unsafe { GetCurrentProcess() })?;
    crate::token_policy::verify_sandbox(&token, None)?;
    Ok(token)
}

/// The trusted helper queries the actual browser under its own AppContainer
/// caller context. This runs before Ready and before reading any source bytes.
pub fn browser_token_from_helper(browser_pid: u32, helper: &Value) -> Result<Value> {
    if browser_pid == 0 {
        return Err("Missing native browser process identity".into());
    }
    crate::token_policy::verify_sandbox(helper, None)?;
    let browser = unsafe {
        owned(OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            browser_pid,
        ))?
    };
    let token = sandbox_token_info(browser.as_raw_handle())?;
    crate::token_policy::verify_sandbox(
        &token,
        Some((
            helper["userSid"].as_str().ok_or("Missing helper SID")?,
            u32::try_from(
                helper["sessionId"]
                    .as_u64()
                    .ok_or("Missing helper session")?,
            )?,
            helper["appContainerSid"]
                .as_str()
                .ok_or("Missing helper AppContainer SID")?,
        )),
    )?;
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
                eprintln!("Fixed engine emergency profile cleanup failed: {result:#x}");
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
        self.stop_observed(|| {})
    }
    fn stop_observed(&self, after_terminate_request: impl FnOnce()) -> Result<()> {
        // Capture a failed API call's error before the observation callback can
        // issue another Win32 call. Observations never replace this outcome.
        let termination = check(unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) });
        let deadline = Instant::now() + Duration::from_secs(2);
        after_terminate_request();
        termination?;
        while self.active()? != 0 {
            if Instant::now() >= deadline {
                return Err("Job did not confirm zero descendants after termination".into());
            }
            thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    }
}

/// Zero-time observation of our original creation handle, never a PID lookup or
/// a wait for the process. A signaled helper does not establish Job/pipe cleanup.
fn helper_exit_observation(process: &OwnedHandle) -> Value {
    let wait = unsafe { WaitForSingleObject(process.as_raw_handle(), 0) };
    let win32_error = (wait == WAIT_FAILED)
        .then(|| std::io::Error::last_os_error().raw_os_error())
        .flatten()
        .and_then(|code| u32::try_from(code).ok());
    let mut exit_code = None;
    let mut exit_code_win32_error = None;
    if wait == WAIT_OBJECT_0 {
        let mut value = 0;
        if unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut value) } != 0 {
            exit_code = Some(value);
        } else {
            exit_code_win32_error = std::io::Error::last_os_error()
                .raw_os_error()
                .and_then(|code| u32::try_from(code).ok());
        }
    }
    json!({
        "waitStatus":match wait {
            WAIT_OBJECT_0 => "signaled", WAIT_TIMEOUT => "timeout",
            WAIT_FAILED => "failed", _ => "unexpected"
        },
        "waitResult":wait,"win32Error":win32_error,
        "exitCode":exit_code,"exitCodeWin32Error":exit_code_win32_error
    })
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
        // Neither end is exposed to unrelated inheriting spawns while creating
        // the pair. Only the helper end below needs inheritance for HANDLE_LIST.
        bInheritHandle: 0,
    };
    check(unsafe { CreatePipe(&mut read, &mut write, &attrs, 4096) })?;
    let (read, write) = unsafe { (owned(read)?, owned(write)?) };
    let (parent, child) = if parent_reads {
        (read, write)
    } else {
        (write, read)
    };
    check(unsafe {
        SetHandleInformation(
            child.as_raw_handle(),
            HANDLE_FLAG_INHERIT,
            HANDLE_FLAG_INHERIT,
        )
    })?;
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
enum FixedChildEntry {
    Renderer,
    #[cfg(test)]
    TokenDiagnostic,
}
fn launch(
    exe: &Path,
    runtime: &Path,
    state: &Path,
    system: &Path,
    profile: &Profile,
    job: &Job,
) -> Result<Spawned> {
    launch_entry(
        exe,
        runtime,
        state,
        system,
        profile,
        job,
        FixedChildEntry::Renderer,
    )
}
fn launch_entry(
    exe: &Path,
    runtime: &Path,
    state: &Path,
    system: &Path,
    profile: &Profile,
    job: &Job,
    entry: FixedChildEntry,
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
    let mut command = wide(OsStr::new(&match entry {
        FixedChildEntry::Renderer => format!(
            "\"{}\" --milkup-fixed-mermaid-child \"{}\" \"{}\"",
            exe.display(), runtime.display(), state.display()
        ),
        // This branch does not exist in the product executable. It accepts no
        // caller command, source, script or module, and executes only one fixed
        // ignored native unit test before any COM/WebView/JavaScript activity.
        #[cfg(test)]
        FixedChildEntry::TokenDiagnostic => format!(
            "\"{}\" --exact launcher::token_diagnostic::child_observes_own_token --ignored --nocapture --test-threads=1",
            exe.display()
        ),
    }));
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
struct OutputProblem {
    message: String,
    kind: &'static str,
    win32_error: Option<u32>,
}
impl OutputProblem {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind,
            win32_error: None,
        }
    }
}
impl From<&str> for OutputProblem {
    fn from(message: &str) -> Self {
        Self::new("schema", message)
    }
}
impl From<std::io::Error> for OutputProblem {
    fn from(error: std::io::Error) -> Self {
        Self {
            message: error.to_string(),
            kind: "read",
            win32_error: error
                .raw_os_error()
                .and_then(|code| u32::try_from(code).ok()),
        }
    }
}
fn read_exact_bounded(
    reader: &mut File,
    count: usize,
    total: &mut usize,
) -> std::result::Result<Vec<u8>, OutputProblem> {
    *total = total
        .checked_add(count)
        .filter(|n| *n <= MAX_OUTPUT)
        .ok_or("Output aggregate budget exceeded")?;
    let mut data = vec![0; count];
    reader.read_exact(&mut data).map_err(OutputProblem::from)?;
    Ok(data)
}
fn read_frame(
    reader: &mut File,
    cap: usize,
    total: &mut usize,
) -> std::result::Result<Value, OutputProblem> {
    let prefix = read_exact_bounded(reader, 4, total)?;
    let bytes = u32::from_le_bytes(prefix.try_into().unwrap()) as usize;
    if bytes == 0 || bytes > cap {
        return Err("JSON frame exceeds its bounded schema envelope".into());
    }
    let data = read_exact_bounded(reader, bytes, total)?;
    serde_json::from_slice(&data).map_err(|error| OutputProblem::new("schema", error.to_string()))
}
struct OutputFailure {
    message: String,
    kind: &'static str,
    win32_error: Option<u32>,
    phase: &'static str,
    stop_requested_when_observed: bool,
}
fn output_reader(
    mut output: File,
    tx: mpsc::Sender<Event>,
    stop_requested: Arc<AtomicBool>,
    progress: Progress,
) -> std::result::Result<(), OutputFailure> {
    let mut phase = "ready-frame";
    progress.phase(Phase::ReadyFrame);
    let result = (|| -> std::result::Result<(), OutputProblem> {
        let mut total = 0;
        let ready = read_frame(&mut output, MAX_READY, &mut total)?;
        if ready["phase"] != "ready" {
            return Err("Helper did not send the expected ready frame".into());
        }
        phase = "ready-event";
        progress.phase(Phase::ReadyEvent);
        tx.send(Event::Ready(ready))
            .map_err(|error| OutputProblem::new("channel", error.to_string()))?;
        phase = "result-frame";
        progress.phase(Phase::ResultFrame);
        let metadata = read_frame(&mut output, MAX_METADATA, &mut total)?;
        let bytes = metadata["pngBytes"]
            .as_u64()
            .ok_or("Missing PNG byte length")?;
        if bytes > MAX_OUTPUT as u64 {
            return Err("PNG byte length exceeds budget".into());
        }
        phase = "png-body";
        progress.phase(Phase::PngBody);
        let png = read_exact_bounded(&mut output, bytes as usize, &mut total)?;
        // Let the native owner stop the Job immediately after the complete frame.
        // Browser descendants may still own a duplicate of stdout; EOF is not
        // part of successful rendering and cannot be awaited before that stop.
        phase = "result-event";
        progress.phase(Phase::ResultEvent);
        tx.send(Event::Result(metadata, png, total))
            .map_err(|error| OutputProblem::new("channel", error.to_string()))?;
        phase = "trailing-byte";
        progress.phase(Phase::TrailingByte);
        let mut tail = [0u8; 1];
        match output.read(&mut tail) {
            Ok(0) => progress.finish(Completion::Eof),
            Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => {
                progress.finish(Completion::BrokenPipe)
            }
            Ok(_) => {
                return Err(OutputProblem::new(
                    "trailing-data",
                    "Unexpected trailing helper output",
                ))
            }
            Err(error) => return Err(OutputProblem::from(error)),
        }
        Ok(())
    })();
    result.map_err(|problem| {
        progress.finish(match problem.kind {
            "read" => Completion::ReadError,
            "channel" => Completion::ChannelError,
            "trailing-data" => Completion::TrailingData,
            _ => Completion::SchemaError,
        });
        let failure = OutputFailure {
            message: problem.message,
            kind: problem.kind,
            win32_error: problem.win32_error,
            phase,
            stop_requested_when_observed: stop_requested.load(Ordering::Acquire),
        };
        let _ = tx.send(Event::Error(failure.message.clone()));
        failure
    })
}

fn join_bounded<T>(
    thread: thread::JoinHandle<T>,
    name: &str,
    errors: &mut Vec<String>,
    kinds: &mut Vec<String>,
    observations: &mut Vec<Value>,
    progress: Option<&Progress>,
) -> Option<T> {
    let started = Instant::now();
    let progress_at_join = progress.map(Progress::snapshot);
    let mut progress_at_cancel = None;
    let prior_errors = errors.len();
    let mut cancelled = false;
    let mut cancel_call_succeeded = None;
    let mut cancel_win32_error = None;
    while !thread.is_finished() && started.elapsed() < Duration::from_millis(250) {
        if !cancelled && started.elapsed() >= Duration::from_millis(50) {
            // A failed ownership proof must not hang the supervisor just because
            // an unexpected process retained a pipe. Cancel only our own thread's
            // synchronous pipe I/O, never an unowned process or another job.
            progress_at_cancel = progress.map(Progress::snapshot);
            let result = unsafe { CancelSynchronousIo(thread.as_raw_handle()) };
            let error = std::io::Error::last_os_error();
            cancel_call_succeeded = Some(result != 0);
            if result == 0 {
                cancel_win32_error = error
                    .raw_os_error()
                    .and_then(|code| u32::try_from(code).ok());
            }
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
    let finished = thread.is_finished();
    let mut panicked = false;
    let result = if !finished {
        errors.push(format!("{name} thread failed to terminate within bounded cleanup; supervisor must stop after preserving this report"));
        None
    } else {
        match thread.join() {
            Ok(value) => Some(value),
            Err(_) => {
                panicked = true;
                errors.push(format!("{name} thread panicked"));
                None
            }
        }
    };
    observations.push(json!({"stream":name,
        "elapsedMs":started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        "cancelRequested":cancelled,"cancelCallSucceeded":cancel_call_succeeded,
        "cancelWin32Error":cancel_win32_error,"finished":finished,"panicked":panicked,
        "progressAtJoin":progress_at_join,"progressAtCancel":progress_at_cancel,
        "progressAtEnd":progress.map(Progress::snapshot)}));
    if errors.len() != prior_errors {
        kinds.push(format!("{name}-join"));
    }
    result
}

/// Each call creates a new profile/process tree; failures stay failures and never
/// retry with an ordinary token, weaker Job, alternative Runtime or broader ACL.
pub fn run(runtime: &Path, input: &Value, control: &Control) -> Result<RunOutput> {
    let input_bytes = serde_json::to_vec(input)?;
    if input_bytes.len() > MAX_INPUT || input_bytes.is_empty() {
        return Err("Input JSON exceeds the fixed engine budget".into());
    }
    control.checkpoint()?;
    reject_reparse_ancestors(runtime)?;
    let runtime = fs::canonicalize(runtime)?;
    if !runtime.join("msedgewebview2.exe").is_file() {
        return Err("Installed Evergreen Runtime absent; no download fallback".into());
    }
    let host_token = token_info(unsafe { GetCurrentProcess() })?;
    let mut process_session = 0;
    check(unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut process_session) })?;
    // Read the actual current primary token. Never select a linked token,
    // enable a privilege, or change process credentials to gain compatibility.
    // Sandbox association queries below only inspect type/level and close.
    let host_class = crate::token_policy::classify_host(&host_token, process_session)?;
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
        "hostTokenClass":host_class.name(),"hostNonElevatedVerified":true,
        "cleanupOwner":"same-login-coordinator",
        "standardUserMeaning":"pure-standard retains its original no-Administrators-SID meaning. filtered-admin is a separately verified non-elevated UAC Limited primary token with medium integrity, no UIAccess, only deny-only administrator membership and ordinary-user privileges. Tokens are observed without adjustment.",
        "jobMemoryLimitBytes":JOB_MEMORY,"jobProcessLimit":JOB_PROCESSES,
        "remainingDeadlineMs":control.remaining().as_millis(),
        "aclOperations":[],"productIntegrated":true,"networkGuarantee":false,
        "runtimeInstalled":false,"firewallChanged":false,"systemAclChanged":false,"elevationRequested":false});
    let mut profile = None;
    let mut job = None;
    let mut helper_process = None;
    let mut pins = None;
    let mut readers = Vec::new();
    let mut writer = None;
    let mut stderr_reader = None;
    let mut metadata = json!({"status":"error","pngBytes":0});
    let mut png = Vec::new();
    let stop_requested = Arc::new(AtomicBool::new(false));
    let stdout_progress = Progress::default();
    let stdin_progress = Progress::default();
    let stderr_progress = Progress::default();
    // Admission means an actually created, uniquely owned native root. All
    // subsequent failures pass through the complete ownership cleanup below.
    crate::audit::emit(&json!({"phase":"admitted",
        "requestId":input["requestId"],"productPid":std::process::id()}));
    let outcome = (|| -> Result<()> {
        control.checkpoint()?;
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
        // Reset only this newly owned root. This same-login coordinator and
        // SYSTEM retain cleanup access; no other login or existing object ACL
        // is modified. The AppContainer can read/execute, never replace code.
        acl(
            &system,
            &root,
            &[
                "/inheritance:r".into(),
                "/grant:r".into(),
                format!("*{owner_sid}:(OI)(CI)F"),
                "*S-1-5-18:(OI)(CI)F".into(),
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
        let exe = code.join("milkup-fixed-mermaid.exe");
        pins = Some(pinned_copy(&std::env::current_exe()?, &exe)?);
        reject_reparse_ancestors(&exe)?;
        report["privateExecutableBytes"] = json!(fs::metadata(&exe)?.len());
        control.checkpoint()?;
        job = Some(Job::new()?);
        let job = job.as_ref().unwrap();
        let Spawned {
            process: created_process,
            thread: primary_thread,
            input: mut child_input,
            output: child_output,
            error: child_error,
        } = launch(&exe, &runtime, &state, &system, profile, job)?;
        // Preserve the actual creation handle through the outcome, including
        // every fallible token/Job proof below. No duplicate or reopened PID.
        helper_process = Some(created_process);
        let process = helper_process.as_ref().unwrap();
        report["helperProcessId"] = json!(unsafe { GetProcessId(process.as_raw_handle()) });
        let child_token = sandbox_token_info(process.as_raw_handle())?;
        report["suspendedToken"] = child_token.clone();
        crate::token_policy::verify_sandbox(
            &child_token,
            Some((owner_sid, process_session, &sid)),
        )?;
        if job.active()? != 1 {
            return Err("Suspended child identity or creation-time Job binding mismatch".into());
        }
        report["executionAncestryAccessDenials"] =
            check_code_parent_access(process.as_raw_handle(), &code)?;
        control.checkpoint()?;
        report["suspendedJob"] = job.sample()?;
        let (tx, rx) = mpsc::channel();
        let output_tx = tx.clone();
        let output_stop = stop_requested.clone();
        let output_progress = stdout_progress.clone();
        readers.push(thread::spawn(move || {
            output_reader(child_output, output_tx, output_stop, output_progress)
        }));
        let error_tx = tx.clone();
        let error_stop = stop_requested.clone();
        let error_progress = stderr_progress.clone();
        stderr_reader = Some(thread::spawn(move || {
            error_progress.phase(Phase::StderrRead);
            let mut bytes = Vec::new();
            match child_error
                .take((MAX_STDERR + 1) as u64)
                .read_to_end(&mut bytes)
            {
                Ok(_) if bytes.len() <= MAX_STDERR => {
                    error_progress.finish(Completion::Eof);
                    (bytes, false, None)
                }
                result => {
                    error_progress.finish(if result.is_err() {
                        Completion::ReadError
                    } else {
                        Completion::BudgetError
                    });
                    let failure = match &result {
                        Err(error) => json!({"kind":"read",
                            "stopRequestedWhenObserved":error_stop.load(Ordering::Acquire),
                            "win32Error":error.raw_os_error().and_then(|code| u32::try_from(code).ok())}),
                        Ok(_) => json!({"kind":"budget",
                            "stopRequestedWhenObserved":error_stop.load(Ordering::Acquire),
                            "win32Error":null}),
                    };
                    let _ = error_tx.send(Event::Error(format!(
                        "Helper stderr budget/read failure: {result:?}"
                    )));
                    bytes.truncate(MAX_STDERR);
                    (bytes, true, Some(failure))
                }
            }
        }));
        let prepare_started = Instant::now();
        if unsafe { ResumeThread(primary_thread.as_raw_handle()) } == u32::MAX {
            return Err(std::io::Error::last_os_error().into());
        }
        let ready_wait = recv_controlled(&rx, control);
        // Includes ResumeThread, using the same origin as prepareElapsedMs.
        report["readyWaitElapsedMs"] = json!(prepare_started.elapsed().as_millis());
        match ready_wait? {
            Event::Ready(ready) => report["ready"] = ready,
            Event::Error(error) => return Err(error.into()),
            _ => return Err("Invalid helper preparation event".into()),
        }
        let browser_pid = crate::token_ready::validate(
            &report["ready"],
            unsafe { GetProcessId(process.as_raw_handle()) },
            owner_sid,
            process_session,
            &sid,
        )?;
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
        report["browserToken"] = sandbox_token_info(browser.as_raw_handle())?;
        crate::token_policy::verify_sandbox(
            &report["browserToken"],
            Some((owner_sid, process_session, &sid)),
        )?;
        if in_job == 0 {
            return Err("WebView2 browser lacks the required Job/zero-capability AppContainer boundary; refusing render".into());
        }
        report["prepareElapsedMs"] = json!(prepare_started.elapsed().as_millis());
        // Publishing verified proof is immediately followed by `started`, with
        // no remaining fallible operation in between. A cancellation while
        // sampling the Job keeps the original Ready but no false started claim.
        crate::token_ready::prepare_started(&mut report, control, || job.sample())?;
        crate::audit::emit(&crate::audit::started(
            input["requestId"].as_str().unwrap_or_default(),
            &report,
        ));
        let render_started = Instant::now();
        let input_len = input_bytes.len() as u32;
        let input_progress = stdin_progress.clone();
        writer = Some(thread::spawn(move || {
            input_progress.phase(Phase::StdinWrite);
            let result = child_input
                .write_all(&input_len.to_le_bytes())
                .and_then(|_| child_input.write_all(&input_bytes))
                .and_then(|_| {
                    input_progress.phase(Phase::StdinFlush);
                    child_input.flush()
                });
            let event = match result {
                Ok(()) => {
                    input_progress.phase(Phase::WrittenEvent);
                    Event::Written
                }
                Err(error) => {
                    input_progress.finish(Completion::WriteError);
                    Event::Error(error.to_string())
                }
            };
            let written = matches!(&event, Event::Written);
            let sent = tx.send(event);
            if written {
                input_progress.finish(if sent.is_ok() {
                    Completion::Written
                } else {
                    Completion::ChannelError
                });
            }
        }));
        let mut written = false;
        let mut result = None;
        loop {
            match recv_controlled(&rx, control)? {
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
    let cleanup_started = Instant::now();
    let mut cleanup_timeline = json!({});
    stop_requested.store(true, Ordering::Release);
    report["capturedPngBytes"] = json!(png.len());
    let mut cleanup_errors = Vec::new();
    let mut cleanup_kinds = Vec::<String>::new();
    let mut ipc_cleanup = Vec::new();
    let mut empty = true;
    if let Some(job) = &job {
        report["preStopJob"] = job
            .sample()
            .unwrap_or_else(|e| json!({"inspectionError":e.to_string()}));
        let before_terminate = helper_process.as_ref().map(helper_exit_observation);
        let mut after_terminate = None;
        let mut helper_released = false;
        let stopped = job.stop_observed(|| {
            after_terminate = helper_process.as_ref().map(helper_exit_observation);
            // Release before the original accounting poll, including a failed
            // termination request. Holding a diagnostic process reference must
            // not change that poll's lifetime/accounting assumptions.
            if let Some(process) = helper_process.take() {
                drop(process);
                helper_released = true;
            }
        });
        if let (Some(before), Some(after)) = (before_terminate, after_terminate) {
            report["helperProcessExitObservation"] = json!({
                "beforeTerminate":before,
                "afterTerminateRequest":after,
                "handleReleasedBeforeAccounting":helper_released
            });
        }
        if let Err(error) = stopped {
            empty = false;
            cleanup_kinds.push("job-stop".into());
            cleanup_errors.push(error.to_string());
        } else {
            report["jobActiveAfterStop"] = json!(0);
        }
        cleanup_timeline["jobStopFinishedMs"] =
            json!(cleanup_started.elapsed().as_millis().min(u64::MAX as u128) as u64);
    }
    // Even an unexpected leaked handle cannot make these joins unbounded. Any
    // cancellation/pending thread is a failed run; the caller must end the
    // matrix after saving this report, rather than starting another helper.
    let mut ipc_threads_completed = true;
    for reader in readers {
        match join_bounded(
            reader,
            "stdout",
            &mut cleanup_errors,
            &mut cleanup_kinds,
            &mut ipc_cleanup,
            Some(&stdout_progress),
        ) {
            Some(Ok(())) => (),
            Some(Err(error)) => {
                cleanup_kinds.push("stdout-protocol".into());
                report["stdoutFailure"] = json!({"phase":error.phase,
                    "kind":error.kind,"win32Error":error.win32_error,
                    "stopRequestedWhenObserved":error.stop_requested_when_observed});
                cleanup_errors.push(format!("stdout protocol: {}", error.message));
            }
            None => ipc_threads_completed = false,
        }
    }
    if let Some(writer) = writer {
        if join_bounded(
            writer,
            "stdin",
            &mut cleanup_errors,
            &mut cleanup_kinds,
            &mut ipc_cleanup,
            Some(&stdin_progress),
        )
        .is_none()
        {
            ipc_threads_completed = false;
        }
    }
    if let Some(reader) = stderr_reader {
        match join_bounded(
            reader,
            "stderr",
            &mut cleanup_errors,
            &mut cleanup_kinds,
            &mut ipc_cleanup,
            Some(&stderr_progress),
        ) {
            Some((bytes, exceeded, failure)) => {
                report["stderr"] = json!(String::from_utf8_lossy(&bytes));
                report["stderrExceededBudget"] = json!(exceeded);
                report["stderrFailure"] = json!(failure);
                if exceeded {
                    cleanup_kinds.push("stderr-budget-or-read".into());
                    cleanup_errors.push("stderr protocol budget failed".into());
                }
            }
            None => ipc_threads_completed = false,
        }
    }
    cleanup_timeline["ipcJoinsFinishedMs"] =
        json!(cleanup_started.elapsed().as_millis().min(u64::MAX as u128) as u64);
    report["ipcThreadCleanup"] = json!(ipc_cleanup);
    report["ipcThreadsCompleted"] = json!(ipc_threads_completed);
    report["stopMatrixAfterThisCase"] = json!(!ipc_threads_completed || !empty);
    drop(job); // KILL_ON_JOB_CLOSE remains the last-resort ownership boundary.
    let had_pins = pins.is_some();
    drop(pins);
    if had_pins {
        cleanup_timeline["pinsReleasedMs"] =
            json!(cleanup_started.elapsed().as_millis().min(u64::MAX as u128) as u64);
    }
    if empty {
        if let Some(profile) = &mut profile {
            match profile.delete() {
                Ok(()) => report["profileDeletedAndFolderAbsent"] = json!(true),
                Err(e) => {
                    cleanup_kinds.push("profile-delete".into());
                    cleanup_errors.push(format!("AppContainer profile deletion: {e}"));
                }
            }
            report["profileDeleteApiSucceeded"] = json!(profile.deleted);
            cleanup_timeline["profileDeleteFinishedMs"] =
                json!(cleanup_started.elapsed().as_millis().min(u64::MAX as u128) as u64);
        }
        report["privateTreeRemoved"] = json!(false);
        let (removal, tree_facts) = crate::cleanup::remove_owned_tree_observed(&root);
        match removal {
            Ok(()) => report["privateTreeRemoved"] = json!(true),
            Err(error) => {
                cleanup_kinds.push("private-tree-delete".into());
                cleanup_errors.push(format!("Private tree deletion: {error}"));
            }
        }
        report["privateTreeDeleteAttempts"] = json!(tree_facts.observations);
        report["privateTreeCleanup"] = json!(tree_facts);
        cleanup_timeline["treeDeleteFinishedMs"] =
            json!(cleanup_started.elapsed().as_millis().min(u64::MAX as u128) as u64);
    } else {
        cleanup_kinds.push("job-not-empty".into());
        if let Some(profile) = &mut profile {
            profile.retain = true;
        }
        cleanup_errors.push(
            "Private files/profile retained because process emptiness was not established".into(),
        );
    }
    report["cleanupTimeline"] = cleanup_timeline;
    report["cleanupErrors"] = json!(cleanup_errors);
    report["cleanupFailureKinds"] = json!(cleanup_kinds);
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

fn recv_controlled(rx: &mpsc::Receiver<Event>, control: &Control) -> Result<Event> {
    loop {
        control.checkpoint()?;
        match rx.recv_timeout(control.remaining().min(Duration::from_millis(20))) {
            Ok(event) => return Ok(event),
            Err(mpsc::RecvTimeoutError::Timeout) => (),
            Err(error) => return Err(error.into()),
        }
    }
}

#[cfg(test)]
#[path = "token_diagnostic.rs"]
mod token_diagnostic;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_exit_observation_does_not_query_exit_code_of_live_process() {
        let current = unsafe { GetCurrentProcess() };
        let mut duplicate = null_mut();
        check(unsafe {
            DuplicateHandle(
                current,
                current,
                current,
                &mut duplicate,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        })
        .unwrap();
        let process = unsafe { owned(duplicate).unwrap() };
        assert_eq!(
            helper_exit_observation(&process),
            json!({"waitStatus":"timeout","waitResult":WAIT_TIMEOUT,
                "win32Error":null,"exitCode":null,"exitCodeWin32Error":null})
        );
    }

    #[test]
    fn job_stop_observation_runs_after_failed_request_without_replacing_os_error() {
        let job = Job::new().unwrap();
        let current = unsafe { GetCurrentProcess() };
        let mut duplicate = null_mut();
        // A real query-only duplicate cannot terminate the owned, empty Job.
        check(unsafe {
            DuplicateHandle(
                current,
                job.0.as_raw_handle(),
                current,
                &mut duplicate,
                0x0004, // JOB_OBJECT_QUERY (WinNT.h); test-only reduced rights.
                0,
                0,
            )
        })
        .unwrap();
        let query_only = Job(unsafe { owned(duplicate).unwrap() });
        let mut observed = false;
        let error = query_only
            .stop_observed(|| {
                observed = true;
                unsafe { SetLastError(ERROR_INVALID_FUNCTION) };
            })
            .unwrap_err();
        assert!(observed);
        assert_eq!(
            error
                .downcast_ref::<std::io::Error>()
                .unwrap()
                .raw_os_error(),
            Some(ERROR_ACCESS_DENIED as i32)
        );
        assert_eq!(job.active().unwrap(), 0);
        job.stop().unwrap();
    }

    /// A real elevated-host negative case, never a synthetic-token acceptance
    /// claim. Ordinary test runs leave it ignored; the reviewed Windows workflow
    /// supplies an already-installed Runtime and explicitly opts in.
    #[test]
    #[ignore = "requires explicitly authorized real elevated Windows runner token"]
    fn elevated_host_is_rejected_before_native_resources() {
        assert_eq!(
            std::env::var("MILKUP_MERMAID_ELEVATED_REJECTION").as_deref(),
            Ok("1")
        );
        let runtime = PathBuf::from(
            std::env::var_os("MILKUP_MERMAID_ELEVATED_REJECTION_RUNTIME")
                .expect("Explicit existing Evergreen Runtime directory is required"),
        );
        assert!(runtime.is_absolute() && runtime.join("msedgewebview2.exe").is_file());
        let host = token_info(unsafe { GetCurrentProcess() }).unwrap();
        assert_eq!(
            host["elevated"], true,
            "This case requires a real elevated token"
        );
        assert!(host["integrityRid"].as_u64().unwrap() >= 0x3000);
        assert!(matches!(host["elevationType"].as_u64(), Some(1 | 2)));
        assert_ne!(
            host["administratorsGroupAttributes"].as_u64().unwrap() & 4,
            0
        );
        let prefix = format!("milkup-fixed-mermaid-{}-", std::process::id());
        let owned_roots = || -> Vec<_> {
            let mut names: Vec<_> = fs::read_dir(std::env::temp_dir())
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .filter(|name| name.to_string_lossy().starts_with(&prefix))
                .collect();
            names.sort();
            names
        };
        let before = owned_roots();
        let control = Control {
            cancelled: Arc::new(AtomicBool::new(false)),
            deadline: Instant::now() + Duration::from_secs(5),
            unhealthy: Arc::new(AtomicBool::new(false)),
        };
        let result = run(
            &runtime,
            &json!({"requestId":"elevated-negative-self-authored",
            "source":"flowchart LR\nA-->B","width":800,"theme":"default","look":"classic"}),
            &control,
        );
        let error = match result {
            Err(error) => error.to_string(),
            Ok(_) => panic!("An elevated host must not reach a native render attempt"),
        };
        assert_eq!(error, "Elevated Mermaid host is unsupported; start Milkup normally without administrator elevation");
        assert_eq!(
            owned_roots(),
            before,
            "No owned root may be created before host rejection"
        );
        assert!(!control.unhealthy.load(Ordering::Acquire));
        println!(
            "MILKUP_MERMAID_ELEVATED_REJECTION {}",
            json!({
            "status":"passed","actualToken":crate::token_policy::audit_evidence(&host),
            "rejectionKind":"elevated-host","rejectedBeforeAdmission":true,
            "ownedRootsUnchanged":true,"helperLaunched":false,
            "scope":"Actual native pre-admission rejection; not an elevated GUI acceptance"})
        );
    }
}

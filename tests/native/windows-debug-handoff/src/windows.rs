//! Standalone, unshipped experiment. Only our copied inert helper is debugged.
//! No installation, attach API, privilege adjustment, or product IPC exists here.
use milkup_windows_debug_handoff_probe::{bind, Image, Instance, TokenFacts};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    error::Error,
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    mem::{offset_of, size_of},
    os::windows::{
        ffi::OsStrExt,
        fs::OpenOptionsExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Path, PathBuf},
    ptr::{null, null_mut},
    thread::sleep,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::*,
    Storage::FileSystem::*,
    System::{Diagnostics::Debug::*, JobObjects::*, Threading::*},
};

type R<T> = Result<T, Box<dyn Error>>;
const CASES: &[&str] = &[
    "normal",
    "null-hfile",
    "wrong-hash",
    "wrong-pid",
    "wrong-instance",
    "timeout",
    "coordinator-exit",
];
const CAP: u64 = 64 * 1024 * 1024;
const APPROVAL: &str = "controlled-self-built-processes-only";

fn check(result: i32) -> R<()> {
    if result == 0 {
        Err(std::io::Error::last_os_error().into())
    } else {
        Ok(())
    }
}
fn handle(raw: HANDLE) -> R<OwnedHandle> {
    if raw.is_null() || raw == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().into());
    }
    // Each caller passes a newly owned handle, never a pseudo/debug-event process handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(raw) })
}
fn wide(s: &OsStr) -> R<Vec<u16>> {
    let mut v: Vec<_> = s.encode_wide().collect();
    if v.contains(&0) {
        return Err("embedded NUL".into());
    }
    v.push(0);
    Ok(v)
}
fn ft(t: FILETIME) -> u64 {
    ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
}
fn instance(h: HANDLE) -> R<Instance> {
    let mut times = [FILETIME::default(); 4];
    check(unsafe {
        GetProcessTimes(
            h,
            &mut times[0],
            &mut times[1],
            &mut times[2],
            &mut times[3],
        )
    })?;
    let pid = unsafe { GetProcessId(h) };
    if pid == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(Instance {
        pid,
        created: ft(times[0]),
    })
}
fn signaled(h: HANDLE, ms: u32) -> R<bool> {
    match unsafe { WaitForSingleObject(h, ms) } {
        WAIT_OBJECT_0 => Ok(true),
        WAIT_TIMEOUT => Ok(false),
        _ => Err(std::io::Error::last_os_error().into()),
    }
}

// Variable token buffers are machine-word aligned and bounded before typed access.
struct Info {
    words: Vec<usize>,
    len: usize,
}
impl Info {
    fn get(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> R<Self> {
        let mut len = 0;
        let result = unsafe { GetTokenInformation(token, class, null_mut(), 0, &mut len) };
        let error = unsafe { GetLastError() };
        // Fixed-size TokenElevation returned ERROR_BAD_LENGTH + required size on
        // the actual Windows runner. Neither sizing error supplies token facts:
        // the following exact-size read must still succeed with TOKEN_QUERY only.
        if result != 0
            || !matches!(error, ERROR_INSUFFICIENT_BUFFER | ERROR_BAD_LENGTH)
            || len == 0
            || len > 65536
        {
            return Err(format!("token size query rejected: class={class}, result={result}, error={error}, bytes={len}").into());
        }
        let capacity = len;
        let mut words = vec![0usize; (len as usize).div_ceil(size_of::<usize>())];
        check(unsafe {
            GetTokenInformation(token, class, words.as_mut_ptr().cast(), capacity, &mut len)
        })?;
        if len > capacity {
            return Err("token buffer grew".into());
        }
        Ok(Self {
            words,
            len: len as usize,
        })
    }
    fn scalar<T: Copy>(&self) -> R<T> {
        if self.len < size_of::<T>() {
            return Err("short token info".into());
        }
        // T is a plain Windows API structure, with alignment <= usize in this probe.
        Ok(unsafe { std::ptr::read_unaligned(self.words.as_ptr().cast::<T>()) })
    }
    fn array<T: Copy>(&self, offset: usize, count: u32) -> R<Vec<T>> {
        let count = count as usize;
        if count > 4096
            || offset
                .checked_add(count * size_of::<T>())
                .is_none_or(|n| n > self.len)
        {
            return Err("invalid token array bounds".into());
        }
        let p = unsafe { self.words.as_ptr().cast::<u8>().add(offset).cast::<T>() };
        Ok((0..count)
            .map(|i| unsafe { p.add(i).read_unaligned() })
            .collect())
    }
}
fn token_facts(process: HANDLE) -> R<TokenFacts> {
    let mut raw = null_mut();
    check(unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) })?;
    let token = handle(raw)?;
    let h = token.as_raw_handle();
    let elevation: TOKEN_ELEVATION = Info::get(h, TokenElevation)?.scalar()?;
    let elevation_type: TOKEN_ELEVATION_TYPE = Info::get(h, TokenElevationType)?.scalar()?;
    let integrity = Info::get(h, TokenIntegrityLevel)?;
    let label: TOKEN_MANDATORY_LABEL = integrity.scalar()?;
    check(unsafe { IsValidSid(label.Label.Sid) })?;
    let count = unsafe { *GetSidSubAuthorityCount(label.Label.Sid) };
    if count == 0 {
        return Err("missing integrity RID".into());
    }
    let integrity_rid = unsafe { *GetSidSubAuthority(label.Label.Sid, (count - 1) as u32) };
    let groups = Info::get(h, TokenGroups)?;
    let count: u32 = groups.scalar()?;
    let mut sid = [0usize; 16];
    let mut sid_len = size_of_val(&sid) as u32;
    check(unsafe {
        CreateWellKnownSid(
            WinBuiltinAdministratorsSid,
            null_mut(),
            sid.as_mut_ptr().cast(),
            &mut sid_len,
        )
    })?;
    let mut admin = None;
    for group in groups.array::<SID_AND_ATTRIBUTES>(offset_of!(TOKEN_GROUPS, Groups), count)? {
        if unsafe { EqualSid(group.Sid, sid.as_mut_ptr().cast()) } != 0 {
            admin = Some(group.Attributes);
        }
    }
    let privileges = Info::get(h, TokenPrivileges)?;
    let count: u32 = privileges.scalar()?;
    let mut debug_luid = LUID::default();
    check(unsafe {
        LookupPrivilegeValueW(
            null(),
            wide(OsStr::new("SeDebugPrivilege"))?.as_ptr(),
            &mut debug_luid,
        )
    })?;
    let debug = privileges
        .array::<LUID_AND_ATTRIBUTES>(offset_of!(TOKEN_PRIVILEGES, Privileges), count)?
        .into_iter()
        .find(|v| v.Luid.LowPart == debug_luid.LowPart && v.Luid.HighPart == debug_luid.HighPart);
    Ok(TokenFacts {
        elevated: elevation.TokenIsElevated != 0,
        elevation_type,
        integrity_rid,
        administrators_present: admin.is_some(),
        administrators_enabled: admin.is_some_and(|a| a & 0x4 != 0), // SE_GROUP_ENABLED
        administrators_deny_only: admin.is_some_and(|a| a & 0x10 != 0), // SE_GROUP_USE_FOR_DENY_ONLY
        debug_privilege_present: debug.is_some(),
        debug_privilege_enabled: debug.is_some_and(|p| p.Attributes & SE_PRIVILEGE_ENABLED != 0),
    })
}

fn metadata(f: &File) -> R<BY_HANDLE_FILE_INFORMATION> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    check(unsafe { GetFileInformationByHandle(f.as_raw_handle(), &mut info) })?;
    if info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
        return Err("non-regular image handle".into());
    }
    Ok(info)
}
fn image(f: &mut File) -> R<Image> {
    let before = metadata(f)?;
    let bytes = ((before.nFileSizeHigh as u64) << 32) | before.nFileSizeLow as u64;
    if bytes == 0 || bytes > CAP {
        return Err("image size outside bound".into());
    }
    f.seek(SeekFrom::Start(0))?;
    let mut digest = Sha256::new();
    let mut read = 0u64;
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        read += n as u64;
        if read > bytes {
            return Err("image changed size".into());
        }
        digest.update(&buf[..n]);
    }
    let after = metadata(f)?;
    if read != bytes
        || before.dwVolumeSerialNumber != after.dwVolumeSerialNumber
        || before.nFileIndexHigh != after.nFileIndexHigh
        || before.nFileIndexLow != after.nFileIndexLow
        || before.nFileSizeHigh != after.nFileSizeHigh
        || before.nFileSizeLow != after.nFileSizeLow
        || ft(before.ftLastWriteTime) != ft(after.ftLastWriteTime)
    {
        return Err("image metadata changed during hash".into());
    }
    Ok(Image {
        volume: before.dwVolumeSerialNumber,
        index: ((before.nFileIndexHigh as u64) << 32) | before.nFileIndexLow as u64,
        bytes,
        sha256: digest.finalize().into(),
    })
}
fn fixture(path: &Path) -> R<File> {
    // This path is ONLY the fixture expectation. It is NOT loaded-image evidence.
    Ok(OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)?)
}
fn event_image(raw: HANDLE) -> R<Option<Image>> {
    if raw.is_null() {
        return Ok(None);
    }
    let original = handle(raw)?;
    let mut duplicate = null_mut();
    check(unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            original.as_raw_handle(),
            GetCurrentProcess(),
            &mut duplicate,
            FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            0,
            0,
        )
    })?;
    let readonly = handle(duplicate)?;
    let mut file = File::from(readonly);
    // The original event hFile and read-only duplicate each close exactly once.
    Ok(Some(image(&mut file)?))
}
fn digest_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

struct Job(OwnedHandle);
impl Job {
    fn new(limit: u32) -> R<Self> {
        let job = Self(handle(unsafe { CreateJobObjectW(null(), null()) })?);
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        info.BasicLimitInformation.ActiveProcessLimit = limit;
        check(unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of_val(&info) as u32,
            )
        })?;
        Ok(job)
    }
    fn active(&self) -> R<u32> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        check(unsafe {
            QueryInformationJobObject(
                self.0.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of_val(&info) as u32,
                null_mut(),
            )
        })?;
        Ok(info.ActiveProcesses)
    }
    fn terminate(&self) -> R<()> {
        check(unsafe { TerminateJobObject(self.0.as_raw_handle(), 91) })
    }
    fn empty(&self) -> R<()> {
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.active()? != 0 {
            if Instant::now() >= deadline {
                return Err("job cleanup unconfirmed".into());
            }
            sleep(Duration::from_millis(10));
        }
        Ok(())
    }
}
struct Child {
    process: OwnedHandle,
    thread: OwnedHandle,
}
fn spawn(exe: &Path, args: &[OsString], job: &Job, debug: bool) -> R<Child> {
    let app = wide(exe.as_os_str())?;
    // Arguments are exclusively generated paths/modes; quotes/newlines are refused.
    // Windows paths in this probe never end in a slash, avoiding trailing-slash quoting.
    let mut command = OsString::new();
    for arg in std::iter::once(exe.as_os_str()).chain(args.iter().map(|a| a.as_os_str())) {
        let encoded: Vec<_> = arg.encode_wide().collect();
        if encoded.iter().any(|v| matches!(*v, 0 | 10 | 13 | 34)) || encoded.last() == Some(&92) {
            return Err("unsupported argument spelling".into());
        }
        if !command.is_empty() {
            command.push(" ");
        }
        command.push("\"");
        command.push(arg);
        command.push("\"");
    }
    let mut command = wide(&command)?;
    let mut si = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut pi = PROCESS_INFORMATION::default();
    check(unsafe {
        CreateProcessW(
            app.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_SUSPENDED | if debug { DEBUG_ONLY_THIS_PROCESS } else { 0 },
            null(),
            null(),
            &mut si,
            &mut pi,
        )
    })?;
    let child = Child {
        process: handle(pi.hProcess)?,
        thread: handle(pi.hThread)?,
    };
    if let Err(error) = check(unsafe {
        AssignProcessToJobObject(job.0.as_raw_handle(), child.process.as_raw_handle())
    }) {
        // Only the handle returned by OUR CreateProcess is terminated; no PID/name kill.
        let stopped = check(unsafe { TerminateProcess(child.process.as_raw_handle(), 92) });
        let exited = signaled(child.process.as_raw_handle(), 2000);
        return Err(format!("job assignment failed: {error}; own suspended child termination: {stopped:?}; exit observed: {exited:?}").into());
    }
    if debug {
        check(unsafe { DebugSetProcessKillOnExit(1) })?;
    }
    if unsafe { ResumeThread(child.thread.as_raw_handle()) } == u32::MAX {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(child)
}

fn write_json(path: &Path, value: &Value) -> R<()> {
    let temp = path.with_extension("pending");
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    f.write_all(serde_json::to_string_pretty(value)?.as_bytes())?;
    f.sync_all()?;
    drop(f);
    fs::rename(temp, path)?;
    Ok(())
}
fn read_json(path: &Path) -> R<Option<Value>> {
    match File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(65537).read_to_end(&mut bytes)?;
            if bytes.len() > 65536 {
                return Err("oversized marker".into());
            }
            Ok(Some(serde_json::from_slice(&bytes)?))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
fn await_marker(path: &Path) -> R<Value> {
    let end = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(v) = read_json(path)? {
            return Ok(v);
        }
        if Instant::now() >= end {
            return Err(format!("marker timeout: {}", path.display()).into());
        }
        sleep(Duration::from_millis(10));
    }
}
fn validate_case(dir: &Path, case: &str) -> R<()> {
    if !CASES.contains(&case) || dir.file_name() != Some(OsStr::new(case)) {
        return Err("unknown case".into());
    }
    let root = dir.parent().ok_or("missing private root")?;
    let temp = fs::canonicalize(std::env::temp_dir())?;
    let actual = fs::canonicalize(root)?;
    if actual.parent() != Some(temp.as_path())
        || !actual
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .starts_with("milkup-debug-probe-")
        || fs::read(root.join(".probe-root"))? != b"inert-self-built-probe-only"
    {
        return Err("not this experiment's temporary root".into());
    }
    // Generated paths must resolve directly under the selected root (no junction alias).
    if fs::canonicalize(dir)? != actual.join(case) {
        return Err("case path alias".into());
    }
    Ok(())
}

fn coordinator(dir: &Path, case: &str) -> R<()> {
    validate_case(dir, case)?;
    let facts = token_facts(unsafe { GetCurrentProcess() })?;
    write_json(&dir.join("coordinator-token.json"), &facts.json())?;
    facts.admit()?;
    let exe = dir.join("helper.exe");
    let mut expected_file = fixture(&exe)?;
    let mut wanted = image(&mut expected_file)?;
    let own = image(&mut fixture(&std::env::current_exe()?)?)?;
    if own.sha256 != wanted.sha256 || own.bytes != wanted.bytes {
        return Err("helper is not our own copied inert binary".into());
    }
    // Do not impose the fixture read handle's share mode on Windows' debug handle
    // creation. Replacements after this point still have to match file ID AND digest
    // from the actual event handle; no later path open supplies loaded-image proof.
    drop(expected_file);
    let job = Job::new(1)?;
    let child = spawn(
        &exe,
        &["--helper".into(), dir.into(), case.into()],
        &job,
        true,
    )?;
    let expected = instance(child.process.as_raw_handle())?;
    let child_facts = token_facts(child.process.as_raw_handle())?;
    write_json(&dir.join("helper-token.json"), &child_facts.json())?;
    child_facts.admit()?;
    if child_facts != facts {
        return Err("helper token context changed".into());
    }
    write_json(
        &dir.join("created.json"),
        &json!({"pid":expected.pid,"created":expected.created}),
    )?;
    // Supervisor pins a read-only handle and verifies membership/creation time first.
    await_marker(&dir.join("inspect.go"))?;
    let mut bound = false;
    let mut saw_create = false;
    let mut breakpoint = false;
    let mut rejected = None;
    let mut stopping = false;
    let mut exit_code = None;
    let start = Instant::now();
    let mut stop_deadline = None;
    loop {
        if !stopping
            && start.elapsed() > Duration::from_secs(if case == "timeout" { 2 } else { 10 })
        {
            job.terminate()?;
            stopping = true;
            stop_deadline = Some(Instant::now() + Duration::from_secs(5));
            if case != "timeout" {
                return Err("unexpected coordinator timeout".into());
            }
        }
        if stop_deadline.is_some_and(|t| Instant::now() >= t) {
            return Err("debug exit event missing after stop".into());
        }
        if case == "coordinator-exit" && bound && read_json(&dir.join("exit.go"))?.is_some() {
            // Intentionally bypasses Drop. OS closes non-inherited job handle and applies
            // debugger kill-on-exit. This is process termination, NOT power-loss evidence.
            std::process::exit(23);
        }
        let mut event = DEBUG_EVENT::default();
        if unsafe { WaitForDebugEvent(&mut event, 50) } == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_SEM_TIMEOUT {
                continue;
            }
            return Err(format!("WaitForDebugEvent failed: {error}").into());
        }
        // Collect result before Continue so every received event is continued even on
        // rejection. Killing owned job happens BEFORE releasing a rejected create event.
        let mut status = DBG_CONTINUE;
        let processing = (|| -> R<()> {
            if event.dwDebugEventCode == CREATE_PROCESS_DEBUG_EVENT {
                let info = unsafe { event.u.CreateProcessInfo };
                // Consume/close event hFile even if PID or instance checks fail.
                let observed = event_image(info.hFile)?;
                if saw_create {
                    return Err("duplicate create event".into());
                }
                saw_create = true;
                let mut actual = instance(info.hProcess)?;
                if event.dwProcessId != expected.pid {
                    return Err("foreign debug event PID".into());
                }
                if case == "wrong-pid" {
                    actual.pid = actual.pid.wrapping_add(1);
                }
                if case == "wrong-instance" {
                    actual.created = actual.created.wrapping_add(1);
                }
                if case == "wrong-hash" {
                    wanted.sha256[0] ^= 1;
                }
                // Null injection tests the refusal gate. It does NOT claim Windows
                // actually returned NULL; actual handle presence is logged separately.
                let input = if case == "null-hfile" {
                    None
                } else {
                    observed.as_ref()
                };
                let result = bind(&expected, &actual, &wanted, input);
                write_json(
                    &dir.join("binding.json"),
                    &json!({
                        "source":"CREATE_PROCESS_DEBUG_EVENT.hFile", "actual_handle_present":observed.is_some(),
                        "owned_pid":expected.pid,"owned_created":expected.created,
                        "event_pid":event.dwProcessId, "event_process_instance":instance(info.hProcess)?.created,
                        "actual_sha256":observed.as_ref().map(|i|digest_hex(&i.sha256)),
                        "actual_volume":observed.as_ref().map(|i|i.volume),"actual_file_index":observed.as_ref().map(|i|i.index),
                        "injection":case, "gate":result.as_ref().err().copied().unwrap_or("accepted")
                    }),
                )?;
                if let Err(reason) = result {
                    rejected = Some(reason);
                    job.terminate()?;
                    stopping = true;
                    stop_deadline = Some(Instant::now() + Duration::from_secs(5));
                } else {
                    bound = true;
                }
            } else {
                if event.dwDebugEventCode == LOAD_DLL_DEBUG_EVENT {
                    let file = unsafe { event.u.LoadDll.hFile };
                    if !file.is_null() {
                        drop(handle(file)?);
                    }
                }
                if event.dwProcessId != expected.pid {
                    return Err("foreign event".into());
                }
                if event.dwDebugEventCode == EXCEPTION_DEBUG_EVENT {
                    let exception = unsafe { event.u.Exception };
                    if bound
                        && !breakpoint
                        && exception.dwFirstChance != 0
                        && exception.ExceptionRecord.ExceptionCode == EXCEPTION_BREAKPOINT
                    {
                        breakpoint = true;
                    } else {
                        status = DBG_EXCEPTION_NOT_HANDLED;
                        return Err("unexpected exception".into());
                    }
                }
                if event.dwDebugEventCode == EXIT_PROCESS_DEBUG_EVENT {
                    exit_code = Some(unsafe { event.u.ExitProcess.dwExitCode });
                }
            }
            Ok(())
        })();
        if processing.is_err() {
            let _ = job.terminate();
        }
        // Event process/thread handles are Windows-owned; Continue(EXIT_*) closes
        // them. PI handles above are separately owned and kept until observation ends.
        check(unsafe { ContinueDebugEvent(event.dwProcessId, event.dwThreadId, status) })?;
        processing?;
        if exit_code.is_some() {
            break;
        }
    }
    if !signaled(child.process.as_raw_handle(), 5000)? {
        return Err("owned process did not signal exit".into());
    }
    job.empty()?;
    let expected_rejection = match case {
        "null-hfile" => Some("null-image-handle"),
        "wrong-hash" => Some("image-binding-mismatch"),
        "wrong-pid" | "wrong-instance" => Some("process-instance-mismatch"),
        _ => None,
    };
    if !saw_create
        || rejected != expected_rejection
        || (expected_rejection.is_none() && !bound)
        || (case == "normal" && exit_code != Some(0))
        || (case == "timeout" && !stopping)
        || case == "coordinator-exit"
    {
        return Err("case did not reach its exact expected outcome".into());
    }
    if expected_rejection.is_some() && dir.join("helper-ready.json").exists() {
        return Err("rejected helper body executed".into());
    }
    write_json(
        &dir.join("result.json"),
        &json!({"case":case,"passed":true,"exit_code":exit_code,
        "binding_accepted":bound,"rejection":rejected,"owned_handle_signaled":true,"job_active":0}),
    )?;
    Ok(())
}

fn helper(dir: &Path, case: &str) -> R<()> {
    validate_case(dir, case)?;
    write_json(
        &dir.join("helper-ready.json"),
        &json!({"pid":std::process::id()}),
    )?;
    if matches!(case, "timeout" | "coordinator-exit") {
        sleep(Duration::from_secs(20));
    }
    Ok(())
}
fn run_case(root: &Path, case: &str, exe: &Path, facts: &TokenFacts) -> R<Value> {
    let dir = root.join(case);
    fs::create_dir(&dir)?;
    fs::copy(exe, dir.join("helper.exe"))?;
    let job = Job::new(2)?;
    let child = spawn(
        exe,
        &["--coordinator".into(), dir.clone().into(), case.into()],
        &job,
        false,
    )?;
    let outcome = (|| -> R<Value> {
        let created = await_marker(&dir.join("created.json"))?;
        let pid = u32::try_from(created["pid"].as_u64().ok_or("missing pid")?)?;
        let created = created["created"].as_u64().ok_or("missing creation time")?;
        // This is a read-only query of our blocked child, NOT debugger attach. Its
        // creation time and our outer Job membership must both match before use.
        let observed = handle(unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        })?;
        let mut belongs = 0;
        check(unsafe {
            IsProcessInJob(
                observed.as_raw_handle(),
                job.0.as_raw_handle(),
                &mut belongs,
            )
        })?;
        if belongs == 0 || instance(observed.as_raw_handle())? != (Instance { pid, created }) {
            return Err("not our pinned helper instance".into());
        }
        write_json(&dir.join("inspect.go"), &json!({"owned":true}))?;
        if case == "coordinator-exit" {
            await_marker(&dir.join("helper-ready.json"))?;
            write_json(&dir.join("exit.go"), &json!({"exit":true}))?;
        }
        if !signaled(child.process.as_raw_handle(), 20000)? {
            return Err("coordinator timeout".into());
        }
        let mut code = 0;
        check(unsafe { GetExitCodeProcess(child.process.as_raw_handle(), &mut code) })?;
        if code != if case == "coordinator-exit" { 23 } else { 0 } {
            return Err(format!("coordinator exit {code}").into());
        }
        // Observe BEFORE any outer-job fallback termination: do not mask failed cleanup.
        if !signaled(observed.as_raw_handle(), 5000)? {
            return Err("helper survived coordinator exit".into());
        }
        job.empty()?;
        for name in ["coordinator-token.json", "helper-token.json"] {
            if read_json(&dir.join(name))? != Some(facts.json()) {
                return Err("token facts differ across roles".into());
            }
        }
        let binding = read_json(&dir.join("binding.json"))?.ok_or("binding evidence missing")?;
        if binding["actual_handle_present"] != true {
            return Err("OS did not provide image handle; hypothesis unproven".into());
        }
        if matches!(case, "normal" | "timeout" | "coordinator-exit") {
            let ready =
                read_json(&dir.join("helper-ready.json"))?.ok_or("helper body did not run")?;
            if ready["pid"].as_u64() != Some(pid as u64) {
                return Err("helper readiness PID mismatch".into());
            }
            if binding["gate"] != "accepted" {
                return Err("positive binding was not accepted".into());
            }
        }
        if case != "coordinator-exit" && read_json(&dir.join("result.json"))?.is_none() {
            return Err("result missing".into());
        }
        Ok(json!({"case":case,"passed":true,"coordinator_exit":code,
            "helper_handle_signaled_before_fallback":true,"job_active":0,"binding":binding}))
    })();
    if outcome.is_err() {
        // Retain original failure; fallback cleanup never turns it into success.
        let terminate = job.terminate();
        let empty = job.empty();
        write_json(
            &dir.join("failure.json"),
            &json!({"error":outcome.as_ref().err().map(ToString::to_string),
            "fallback_terminate":format!("{terminate:?}"),"fallback_cleanup":format!("{empty:?}")}),
        )?;
    }
    outcome
}

pub(super) fn run() -> R<()> {
    if std::env::var("MILKUP_APPROVED_WINDOWS_PROBE").as_deref() != Ok(APPROVAL) {
        return Err("runtime opt-in absent; this marker does not itself grant approval".into());
    }
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.as_slice() {
        [mode, dir, case] if mode == "--coordinator" => {
            coordinator(Path::new(dir), case.to_str().ok_or("invalid case")?)
        }
        [mode, dir, case] if mode == "--helper" => {
            helper(Path::new(dir), case.to_str().ok_or("invalid case")?)
        }
        [mode] if mode == "--suite" => {
            let facts = token_facts(unsafe { GetCurrentProcess() })?;
            println!("SUPERVISOR_TOKEN={}", facts.json());
            facts.admit()?;
            let root: PathBuf = fs::canonicalize(std::env::temp_dir())?.join(format!(
                "milkup-debug-probe-{}-{}",
                std::process::id(),
                SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
            ));
            fs::create_dir(&root)?;
            let mut marker = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(root.join(".probe-root"))?;
            marker.write_all(b"inert-self-built-probe-only")?;
            marker.sync_all()?;
            println!("PRIVATE_EVIDENCE_ROOT={}", root.display());
            write_json(&root.join("supervisor-token.json"), &facts.json())?;
            let exe = std::env::current_exe()?;
            let mut results = Vec::new();
            for case in CASES {
                let result = run_case(&root, case, &exe, &facts);
                results.push(match result {
                    Ok(v) => v,
                    Err(e) => json!({"case":case,"passed":false,"error":e.to_string()}),
                });
                println!("CASE_RESULT={}", results.last().unwrap());
                if results.last().unwrap()["passed"] != true {
                    break;
                }
            }
            let passed =
                results.len() == CASES.len() && results.iter().all(|v| v["passed"] == true);
            let summary = json!({"passed":passed,"cases":results,"token":facts.json(),
                "ordinary_user_runtime_validated":passed && facts.ordinary_medium_context(),
                "installer_or_release_validated":false,"power_loss_validated":false,
                "cleanup_mechanisms":"debugger kill-on-exit plus non-inherited kill-on-close Job; not isolated attribution"});
            write_json(&root.join("summary.json"), &summary)?;
            println!("PROBE_SUMMARY={summary}");
            // Intentionally keep failure evidence in the ephemeral runner temp directory.
            // No artifact upload. No recursive deletion based on external input.
            if passed {
                Ok(())
            } else {
                Err("one or more bounded probe cases failed".into())
            }
        }
        _ => Err("expected --suite (internal roles accept only experiment temp paths)".into()),
    }
}

//! This executable is built and run only by the explicitly gated W0 CI job.
//! No product entry point, plugin IPC, permission fallback or Runtime provisioning.
mod engine;
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    fs,
    mem::size_of,
    net::{TcpListener, TcpStream, UdpSocket},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Path, PathBuf},
    process::Command,
    ptr::{null, null_mut},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::*,
    Networking::WinSock::{WSACleanup, WSAStartup, WSADATA},
    Security::{Authorization::ConvertSidToStringSidW, Isolation::*, *},
    System::{Com::CoTaskMemFree, JobObjects::*, Threading::*},
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
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
unsafe fn string(ptr: *const u16) -> String {
    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}
fn save(private: &Path, value: &Value) -> Result<()> {
    fs::write(
        private.join("child.json"),
        serde_json::to_vec_pretty(value)?,
    )?;
    Ok(())
}
fn token_info(process: HANDLE) -> Result<Value> {
    let mut raw = null_mut();
    check(unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) })?;
    let token = unsafe { owned(raw)? };
    let mut is_container = 0u32;
    let mut returned = 0;
    check(unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenIsAppContainer,
            (&mut is_container as *mut u32).cast(),
            4,
            &mut returned,
        )
    })?;
    unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenCapabilities,
            null_mut(),
            0,
            &mut returned,
        );
    }
    if returned == 0 {
        return Err("Cannot inspect token capabilities".into());
    }
    let mut buf = vec![0usize; (returned as usize).div_ceil(size_of::<usize>())];
    check(unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenCapabilities,
            buf.as_mut_ptr().cast(),
            returned,
            &mut returned,
        )
    })?;
    let capabilities = unsafe { (*(buf.as_ptr().cast::<TOKEN_GROUPS>())).GroupCount };
    Ok(json!({"isAppContainer":is_container == 1, "capabilityCount":capabilities}))
}
struct Profile {
    name: Vec<u16>,
    sid: PSID,
    folder: Option<PathBuf>,
    deleted: bool,
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
        Ok(Self {
            name,
            sid,
            folder: None,
            deleted: false,
        })
    }
    fn sid_string(&mut self) -> Result<String> {
        let mut ptr = null_mut();
        check(unsafe { ConvertSidToStringSidW(self.sid, &mut ptr) })?;
        let sid = unsafe { string(ptr) };
        let mut folder = null_mut();
        let result = unsafe { GetAppContainerFolderPath(ptr, &mut folder) };
        unsafe {
            LocalFree(ptr.cast());
        }
        hr(result)?;
        self.folder = Some(PathBuf::from(unsafe { string(folder) }));
        unsafe {
            CoTaskMemFree(folder.cast());
        }
        Ok(sid)
    }
    fn delete(&mut self) -> Result<()> {
        hr(unsafe { DeleteAppContainerProfile(self.name.as_ptr()) })?;
        self.deleted = true;
        if self.folder.as_ref().is_some_and(|p| p.exists()) {
            return Err("AppContainer profile folder remains after deletion".into());
        }
        Ok(())
    }
}
impl Drop for Profile {
    fn drop(&mut self) {
        if !self.deleted {
            let code = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
            eprintln!("W0 emergency profile cleanup HRESULT {code:#x}");
        }
        unsafe {
            FreeSid(self.sid);
        }
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
        limits.BasicLimitInformation.ActiveProcessLimit = 24;
        limits.JobMemoryLimit = 1024 * 1024 * 1024;
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
    fn members(&self) -> Result<Vec<Value>> {
        // Limit is 24. Reserve enough for the header and 24 native-width PIDs.
        let mut buf = vec![0usize; 32];
        check(unsafe {
            QueryInformationJobObject(
                self.0.as_raw_handle(),
                JobObjectBasicProcessIdList,
                buf.as_mut_ptr().cast(),
                (buf.len() * size_of::<usize>()) as u32,
                null_mut(),
            )
        })?;
        let info = unsafe { &*buf.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
        if info.NumberOfAssignedProcesses != info.NumberOfProcessIdsInList
            || info.NumberOfProcessIdsInList > 24
        {
            return Err("Incomplete Job PID enumeration".into());
        }
        let pids = unsafe {
            std::slice::from_raw_parts(
                std::ptr::addr_of!(info.ProcessIdList).cast::<usize>(),
                info.NumberOfProcessIdsInList as usize,
            )
        };
        Ok(pids
            .iter()
            .map(|&pid| {
                match unsafe {
                    owned(OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION,
                        0,
                        pid as u32,
                    ))
                } {
                    Ok(process) => match token_info(process.as_raw_handle()) {
                        Ok(token) => {
                        let mut image = vec![0u16; 32768];
                        let mut length = image.len() as u32;
                        let image = if unsafe { QueryFullProcessImageNameW(process.as_raw_handle(), 0, image.as_mut_ptr(), &mut length) } != 0 {
                            json!(String::from_utf16_lossy(&image[..length as usize]))
                        } else { json!({"inspectionError":std::io::Error::last_os_error().to_string()}) };
                        json!({"pid":pid,"token":token,"image":image})
                    },
                        Err(e) => json!({"pid":pid,"inspectionError":e.to_string()}),
                    },
                    Err(e) => json!({"pid":pid,"inspectionError":e.to_string()}),
                }
            })
            .collect())
    }
    fn stop(&self) -> Result<()> {
        check(unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) })?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.active()? != 0 {
            if Instant::now() > deadline {
                return Err("Job did not become empty".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    }
}
struct Attributes {
    storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}
impl Attributes {
    fn new(capabilities: &SECURITY_CAPABILITIES, job: &HANDLE) -> Result<Self> {
        let mut size = 0;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut size);
        }
        if size == 0 {
            return Err("Cannot size process attributes".into());
        }
        let mut storage = vec![0usize; size.div_ceil(size_of::<usize>())];
        let pointer = storage.as_mut_ptr().cast();
        check(unsafe { InitializeProcThreadAttributeList(pointer, 2, 0, &mut size) })?;
        let attrs = Self { storage, pointer };
        check(unsafe {
            UpdateProcThreadAttribute(
                pointer,
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                (capabilities as *const SECURITY_CAPABILITIES).cast(),
                size_of::<SECURITY_CAPABILITIES>(),
                null_mut(),
                null(),
            )
        })?;
        check(unsafe {
            UpdateProcThreadAttribute(
                pointer,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                (job as *const HANDLE).cast(),
                size_of::<HANDLE>(),
                null_mut(),
                null(),
            )
        })?;
        Ok(attrs)
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.pointer);
        }
        std::hint::black_box(&self.storage);
    }
}
fn launch(
    exe: &Path,
    runtime: &Path,
    private: &Path,
    profile: &Profile,
    job: &Job,
) -> Result<(OwnedHandle, OwnedHandle)> {
    // Every interpolated value is a locally generated absolute path, never user/plugin input.
    for p in [exe, runtime, private] {
        if p.to_string_lossy().contains('"') {
            return Err("Unexpected quote in probe path".into());
        }
    }
    let command = format!(
        "\"{}\" --child \"{}\" \"{}\"",
        exe.display(),
        runtime.display(),
        private.display()
    );
    let mut command = wide(OsStr::new(&command));
    let exe = wide(exe.as_os_str());
    let cwd = wide(private.as_os_str());
    let system = std::env::var("SystemRoot")?;
    let drive = std::env::var("SystemDrive")?;
    // Supply profile-related environment values for Windows startup.
    // Keep every writable profile location in this private subtree; never inherit
    // the runner's profile or WEBVIEW2_* override variables.
    let environment = format!("APPDATA={}\0LOCALAPPDATA={}\0PATH={system}\\System32\0SystemDrive={drive}\0SystemRoot={system}\0TEMP={}\0TMP={}\0USERPROFILE={}\0WINDIR={system}\0\0", private.display(), private.display(), private.display(), private.display(), private.display());
    let environment: Vec<u16> = environment.encode_utf16().collect();
    let capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: profile.sid,
        Capabilities: null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };
    let raw_job = job.0.as_raw_handle();
    let attrs = Attributes::new(&capabilities, &raw_job)
        .map_err(|e| format!("Cannot configure restricted process attributes: {e}"))?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.lpAttributeList = attrs.pointer;
    let mut info = PROCESS_INFORMATION::default();
    check(unsafe {
        CreateProcessW(
            exe.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_SUSPENDED
                | EXTENDED_STARTUPINFO_PRESENT
                | CREATE_UNICODE_ENVIRONMENT
                | CREATE_NO_WINDOW,
            environment.as_ptr().cast(),
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut info,
        )
    })
    .map_err(|e| format!("CreateProcessW restricted launch failed: {e}"))?;
    Ok(unsafe { (owned(info.hProcess)?, owned(info.hThread)?) })
}
struct Winsock;
impl Drop for Winsock {
    fn drop(&mut self) {
        unsafe {
            WSACleanup();
        }
    }
}
fn io_result<T>(result: std::io::Result<T>) -> Value {
    match result {
        Ok(_) => json!({"ok":true}),
        Err(error) => json!({"ok":false,"rawOsError":error.raw_os_error(),
            "kind":format!("{:?}",error.kind()),"message":error.to_string()}),
    }
}
fn child(runtime: &Path, private: &Path) -> Result<()> {
    let mut report = json!({"phase":"token", "token":token_info(unsafe {GetCurrentProcess()})?, "environmentCreated":false, "controllerCreated":false});
    save(private, &report)?;
    let result = (|| -> Result<()> {
        if report["token"]["isAppContainer"] != true || report["token"]["capabilityCount"] != 0 {
            return Err("Unexpected child token".into());
        }
        let input: Value = serde_json::from_slice(&fs::read(private.join("input.json"))?)?;
        let canary = Path::new(input["canary"].as_str().ok_or("Missing canary")?);
        let read = fs::read(canary).err().and_then(|e| e.raw_os_error());
        let write = fs::OpenOptions::new()
            .write(true)
            .open(canary)
            .err()
            .and_then(|e| e.raw_os_error());
        report["outsideFileReadError"] = json!(read);
        report["outsideFileWriteError"] = json!(write);
        save(private, &report)?;
        if read != Some(5) || write != Some(5) {
            return Err("Outside private directory did not deny file access".into());
        }
        report["phase"] = json!("winsock-initialization");
        let mut data = WSADATA::default();
        let startup = unsafe { WSAStartup(0x0202, &mut data) };
        report["winsockStartupCode"] = json!(startup);
        save(private, &report)?;
        if startup != 0 {
            return Err(format!(
                "WSAStartup failed with native code {startup}; network preflight unresolved"
            )
            .into());
        }
        let _winsock = Winsock;
        report["phase"] = json!("network-canaries");
        let tcp = input["tcp"].as_str().ok_or("Missing TCP canary")?.parse()?;
        let tcp_result = io_result(TcpStream::connect_timeout(&tcp, Duration::from_secs(2)));
        let udp = input["udp"].as_str().ok_or("Missing UDP canary")?;
        let udp_result = io_result(
            UdpSocket::bind("127.0.0.1:0").and_then(|socket| socket.send_to(b"w0-probe", udp)),
        );
        report["loopbackTcp"] = tcp_result.clone();
        report["loopbackUdp"] = udp_result.clone();
        // WFP can silently drop traffic: UDP send success is not delivery.
        // Let the ordinary host observe its positively tested listeners before
        // releasing this trusted static-page experiment. This is not a product
        // authorization channel or proof about DNS/WebRTC.
        report["phase"] = json!("network-await-host");
        save(private, &report)?;
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if let Ok(observation) = fs::read_to_string(private.join("network-observation")) {
                if observation != "permit-static-runtime-probe" {
                    return Err("Host did not confirm unreceived network canaries".into());
                }
                break;
            }
            if Instant::now() >= deadline {
                return Err("Host network observation deadline expired".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        report["hostNetworkCanariesUnreceived"] = json!(true);
        engine::run(runtime, private, &mut report)
    })();
    if let Err(e) = &result {
        report["error"] = json!(e.to_string());
        save(private, &report)?;
    }
    result
}
pub(super) fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|s| s == "--child") {
        if args.len() != 4 {
            return Err("Invalid child arguments".into());
        }
        return child(Path::new(&args[2]), Path::new(&args[3]));
    }
    if args.len() != 2 {
        return Err("Pass the already installed Runtime directory".into());
    }
    if std::env::var("MILKUP_W0_AUTHORIZED").as_deref()
        != Ok("temporary-ci-no-network-private-directory-only")
        || std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
    {
        return Err("W0 experiment requires its explicit authorized CI gate".into());
    }
    let runtime = PathBuf::from(&args[1]);
    if !runtime.join("msedgewebview2.exe").is_file() {
        return Err("Existing Runtime unavailable; no installation or ACL fallback".into());
    }
    let unique = format!(
        "milkup-w0-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    );
    let root = std::env::temp_dir().join(&unique);
    fs::create_dir(&root)?;
    let private = root.join("private");
    fs::create_dir(&private)?;
    let canary = root.join("outside.txt");
    fs::write(&canary, b"outside original")?;
    let mut report = json!({"name":unique,"runtime":runtime,"private":private,"capabilities":[],"productIntegrated":false,"runtimeAclChanged":false,"firewallChanged":false,"loopbackExceptionAdded":false,"privilegeElevation":false,"phase":"setup"});
    let mut profile: Option<Profile> = None;
    let mut owner: Option<Job> = None;
    let result = (|| -> Result<()> {
        let tcp = TcpListener::bind("127.0.0.1:0")?;
        let udp = UdpSocket::bind("127.0.0.1:0")?;
        // Positive controls: these exact listeners are reachable by the ordinary host.
        let control = TcpStream::connect(tcp.local_addr()?)?;
        let _ = tcp.accept()?;
        drop(control);
        let send = UdpSocket::bind("127.0.0.1:0")?;
        send.send_to(b"control", udp.local_addr()?)?;
        let mut packet = [0; 64];
        udp.set_read_timeout(Some(Duration::from_secs(2)))?;
        udp.recv_from(&mut packet)?;
        tcp.set_nonblocking(true)?;
        udp.set_nonblocking(true)?;
        report["hostNetworkControlsPassed"] = json!(true);
        fs::write(
            private.join("input.json"),
            serde_json::to_vec(
                &json!({"canary":canary,"tcp":tcp.local_addr()?.to_string(),"udp":udp.local_addr()?.to_string()}),
            )?,
        )?;
        let exe = private.join("w0.exe");
        fs::copy(std::env::current_exe()?, &exe)?;
        fs::create_dir(private.join("udf"))?;
        profile = Some(Profile::create(&unique)?);
        let profile = profile.as_mut().unwrap();
        let sid = profile.sid_string()?;
        report["appContainerSid"] = json!(sid);
        report["profileFolder"] = json!(profile.folder);
        // Only this newly created private subtree gets an ACE. No /T on any other root.
        let acl = Command::new("icacls.exe")
            .arg(&private)
            .args(["/grant", &format!("*{sid}:(OI)(CI)F")])
            .output()?;
        report["privateAclExitCode"] = json!(acl.status.code());
        report["privateAclOutput"] = json!(String::from_utf8_lossy(&acl.stdout));
        if !acl.status.success() {
            return Err("Private ACL assignment failed; no permission expansion".into());
        }
        // Low-integrity AppContainer writes also need a matching mandatory
        // label. Apply it only to this newly owned private subtree.
        let label = Command::new("icacls.exe")
            .arg(&private)
            .args(["/setintegritylevel", "(OI)(CI)L", "/T"])
            .output()?;
        report["privateIntegrityLabelExitCode"] = json!(label.status.code());
        report["privateIntegrityLabelOutput"] = json!(String::from_utf8_lossy(&label.stdout));
        if !label.status.success() {
            return Err("Private low-integrity label failed; no permission expansion".into());
        }
        owner = Some(Job::new()?);
        let job = owner.as_ref().unwrap();
        let (process, thread) = launch(&exe, &runtime, &private, profile, job)?;
        let token = token_info(process.as_raw_handle())?;
        report["launchToken"] = token.clone();
        if token["isAppContainer"] != true || token["capabilityCount"] != 0 {
            return Err("Unexpected suspended token; refusing resume".into());
        }
        if job.active()? != 1 {
            return Err("Suspended process not exclusively in owner Job".into());
        }
        if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
            return Err(std::io::Error::last_os_error().into());
        }
        let deadline = Instant::now() + Duration::from_secs(45);
        let mut samples = Vec::new();
        let mut network_window = None;
        let mut network_decided = false;
        let mut tcp_received = false;
        let mut udp_received = false;
        loop {
            match tcp.accept() {
                Ok(_) => tcp_received = true,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("TCP canary observation failed: {e}").into()),
            }
            match udp.recv_from(&mut packet) {
                Ok(_) => udp_received = true,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("UDP canary observation failed: {e}").into()),
            }
            samples.push(json!({"elapsedMs":45000u128.saturating_sub(deadline.saturating_duration_since(Instant::now()).as_millis()),"members":job.members()?}));
            if let Ok(bytes) = fs::read(private.join("child.json")) {
                if let Ok(child) = serde_json::from_slice::<Value>(&bytes) {
                    report["child"] = child;
                }
            }
            if report["child"]["phase"] == "network-await-host" && !network_decided {
                let started = network_window.get_or_insert_with(Instant::now);
                if started.elapsed() >= Duration::from_secs(1) {
                    let tcp_result = &report["child"]["loopbackTcp"];
                    let udp_result = &report["child"]["loopbackUdp"];
                    let valid_tcp = tcp_result["ok"] == false
                        && (tcp_result["rawOsError"] == 10013 || tcp_result["kind"] == "TimedOut");
                    let valid_udp = udp_result["ok"] == true || udp_result["rawOsError"] == 10013;
                    let unreceived = valid_tcp && valid_udp && !tcp_received && !udp_received;
                    report["networkCanaryWindowMs"] = json!(1000);
                    report["networkCanariesUnreceived"] = json!(unreceived);
                    report["staticRuntimeProbeReleased"] = json!(unreceived);
                    fs::write(
                        private.join("network-observation"),
                        if unreceived {
                            "permit-static-runtime-probe"
                        } else {
                            "blocked"
                        },
                    )?;
                    network_decided = true;
                }
            }
            if report["child"]["phase"] == "dom-probe-complete"
                || report["child"]["error"].is_string()
            {
                break;
            }
            if unsafe { WaitForSingleObject(process.as_raw_handle(), 0) } == WAIT_OBJECT_0 {
                break;
            }
            if Instant::now() >= deadline {
                report["deadlineExpired"] = json!(true);
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        report["processSamples"] = json!(samples);
        report["unexpectedTcpAccepted"] = json!(tcp_received);
        report["unexpectedUdpReceived"] = json!(udp_received);
        let mut exit = 0;
        check(unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut exit) })?;
        report["childExitBeforeTermination"] = json!(exit);
        if report["child"]["phase"] != "dom-probe-complete" {
            return Err("Restricted WebView2 compatibility probe did not reach DOM completion; no permission fallback".into());
        }
        if report["unexpectedTcpAccepted"] == true || report["unexpectedUdpReceived"] == true {
            return Err("Unexpected network canary traffic".into());
        }
        Ok(())
    })();
    report["probeResult"] = json!(if result.is_ok() {
        "prototype-dom-completed"
    } else {
        "blocked"
    });
    if let Err(error) = &result {
        report["error"] = json!(error.to_string());
    }
    // All cleanup is explicit and checked; failure cannot turn into a passing gate.
    let mut cleanup_errors = Vec::new();
    if let Some(job) = &owner {
        match job.stop() {
            Ok(()) => report["jobActiveAfterStop"] = json!(0),
            Err(e) => cleanup_errors.push(e.to_string()),
        }
    }
    drop(owner);
    report["outsideFileUnchanged"] =
        json!(fs::read(&canary).ok().as_deref() == Some(b"outside original"));
    if let Some(profile) = &mut profile {
        match profile.delete() {
            Ok(()) => report["profileDeletedAndFolderAbsent"] = json!(true),
            Err(e) => cleanup_errors.push(e.to_string()),
        }
    }
    match fs::remove_dir_all(&root) {
        Ok(()) => report["privateTreeAndAclRemoved"] = json!(!root.exists()),
        Err(e) => cleanup_errors.push(e.to_string()),
    }
    report["cleanupErrors"] = json!(cleanup_errors);
    report["boundary"]=json!("Compatibility preflight only. Loopback and one unrelated-file canary are not complete DNS/WebRTC/file-picker/descendant-token isolation proof. No product DOM/PDF is enabled.");
    println!(
        "::group::windows-w0-probe.json\n{}\n::endgroup::",
        serde_json::to_string_pretty(&report)?
    );
    if !cleanup_errors.is_empty() {
        return Err("W0 cleanup incomplete; inspect proof".into());
    }
    if report["outsideFileUnchanged"] != true {
        return Err("Outside canary changed".into());
    }
    result
}

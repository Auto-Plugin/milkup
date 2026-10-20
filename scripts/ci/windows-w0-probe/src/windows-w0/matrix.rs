//! Bounded, controlled-endpoint evidence. This is never a product authorization gate.
mod assessment;
mod browser;
mod dns;
mod endpoints;
mod udp_diagnosis;
use super::*;
use std::{collections::BTreeMap, io::Write};
use windows_sys::Win32::{
    NetworkManagement::WindowsFirewall::NetworkIsolationGetAppContainerConfig,
    System::{
        Memory::{GetProcessHeap, HeapFree},
        IO::{CreateIoCompletionPort, GetQueuedCompletionStatus},
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible, PostMessageW,
        WM_CLOSE,
    },
};

pub(super) fn child(runtime: &Path, private: &Path, input: &Value) -> Result<()> {
    if input["ownerExitTest"] == true {
        return owner_exit_child(runtime, private);
    }
    let mut report =
        json!({"phase":"native-controls","token":token_info(unsafe {GetCurrentProcess()})?});
    save(private, &report)?;
    let result = (|| -> Result<()> {
        report["directBreakaway"] = breakaway_probe()?;
        let canary = Path::new(input["canary"].as_str().ok_or("Missing canary")?);
        report["outsideRead"] = io_result(fs::read(canary));
        report["outsideWriteOpen"] = io_result(fs::OpenOptions::new().write(true).open(canary));
        report["privateRead"] = io_result(fs::read(private.join("allowed.html")));
        let mut native = Vec::new();
        for endpoint in input["endpoints"].as_array().ok_or("Missing endpoints")? {
            let address: std::net::SocketAddr =
                endpoint["tcp"].as_str().ok_or("Missing TCP")?.parse()?;
            let mut tcp = TcpStream::connect_timeout(&address, Duration::from_secs(2));
            let connected = match &tcp {
                Ok(_) => json!({"ok":true}),
                Err(e) => {
                    json!({"ok":false,"rawOsError":e.raw_os_error(),"kind":format!("{:?}",e.kind()),"message":e.to_string()})
                }
            };
            let sent = match &mut tcp {
                Ok(stream) => {
                    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
                    io_result(stream.write_all(format!("GET /{}/native HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", input["case"].as_str().unwrap()).as_bytes()))
                }
                Err(e) => {
                    json!({"ok":false,"rawOsError":e.raw_os_error(),"kind":format!("{:?}",e.kind()),"message":e.to_string()})
                }
            };
            let bind = if address.is_ipv4() {
                "127.0.0.1:0"
            } else {
                "[::1]:0"
            };
            let payload = format!("w0/{}/native", input["case"].as_str().unwrap());
            let udp = io_result(UdpSocket::bind(bind).and_then(|socket| {
                socket.send_to(payload.as_bytes(), endpoint["udp"].as_str().unwrap())
            }));
            native.push(
                json!({"family":endpoint["family"],"connect":connected,"write":sent,"udpSend":udp}),
            );
            report["nativeNetwork"] = json!(native);
            save(private, &report)?;
        }
        if input["dnsEnabled"] == true {
            report["phase"] = json!("explicit-server-dns");
            save(private, &report)?;
            report["explicitServerDns"] =
                dns::query(input["dnsName"].as_str().ok_or("Missing DNS name")?);
        } else {
            report["explicitServerDns"] = json!({"status":"unavailable","reason":"Controlled port 53 bind unavailable; no service/firewall/config change"});
        }
        if input["udpDiagnosis"] == true {
            report["phase"] = json!("udp-before-runtime");
            save(private, &report)?;
            report["udpBeforeRuntime"] = udp_diagnosis::run(input, "before-runtime")?;
        }
        report["phase"] = json!("webview-starting");
        save(private, &report)?;
        browser::run(runtime, private, input, &mut report)?;
        if input["udpDiagnosis"] == true {
            report["phase"] = json!("udp-after-runtime");
            save(private, &report)?;
            report["udpAfterRuntime"] = udp_diagnosis::run(input, "after-runtime")?;
        }
        report["phase"] = json!("matrix-complete");
        save(private, &report)?;
        // Leave the controller and its descendants alive for the owner termination test.
        std::thread::sleep(Duration::from_secs(120));
        Ok(())
    })();
    if let Err(e) = &result {
        report["error"] = json!(e.to_string());
        save(private, &report)?;
    }
    result
}

fn breakaway_probe() -> Result<Value> {
    let exe = wide(std::env::current_exe()?.as_os_str());
    let mut startup = STARTUPINFOW::default();
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    let mut process = PROCESS_INFORMATION::default();
    let ok = unsafe {
        CreateProcessW(
            exe.as_ptr(),
            null_mut(),
            null(),
            null(),
            0,
            CREATE_BREAKAWAY_FROM_JOB | CREATE_SUSPENDED | CREATE_NO_WINDOW,
            null(),
            null(),
            &startup,
            &mut process,
        )
    };
    if ok == 0 {
        let error = std::io::Error::last_os_error();
        return Ok(
            json!({"created":false,"rawOsError":error.raw_os_error(),"message":error.to_string()}),
        );
    }
    // A surprising allowed launch is kept suspended, terminated and waited; no
    // test code is allowed to run outside the owner Job.
    let child = unsafe { owned(process.hProcess)? };
    let _thread = unsafe { owned(process.hThread)? };
    check(unsafe { TerminateProcess(child.as_raw_handle(), 74) })?;
    let waited = unsafe { WaitForSingleObject(child.as_raw_handle(), 5000) };
    if waited != WAIT_OBJECT_0 {
        return Err("Unexpected breakaway child did not terminate".into());
    }
    Ok(json!({"created":true,"resumed":false,"terminated":true,"boundaryViolation":true}))
}

fn owner_exit_child(runtime: &Path, private: &Path) -> Result<()> {
    let leaf = private.join("leaf");
    let job = Job::new()?;
    let (process, thread) = launch_scoped(&leaf.join("w0.exe"), runtime, &leaf, None, &job)?;
    let own = token_info(unsafe { GetCurrentProcess() })?;
    let child_token = token_info(process.as_raw_handle())?;
    if child_token["isAppContainer"] != own["isAppContainer"]
        || child_token["appContainerSid"] != own["appContainerSid"]
        || child_token["capabilityCount"] != 0
    {
        return Err("Inner child token changed".into());
    }
    fs::write(
        private.join("owner.json"),
        serde_json::to_vec(
            &json!({"phase":"owned-child-started","ownerToken":own,"childToken":child_token,"innerAccounting":accounting(&job)?}),
        )?,
    )?;
    if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
        return Err(std::io::Error::last_os_error().into());
    }
    let deadline = Instant::now() + Duration::from_secs(110);
    while Instant::now() < deadline {
        if private.join("owner-exit-now").exists() {
            fs::write(
                private.join("owner.json"),
                serde_json::to_vec(
                    &json!({"phase":"exit-process-without-rust-drop","exitCode":73,"innerAccounting":accounting(&job)?,"ownerToken":own,"childToken":child_token}),
                )?,
            )?;
            // The process exits without running Rust Drop. The OS closes its last
            // non-inherited inner Job handle; KILL_ON_JOB_CLOSE must stop descendants.
            unsafe {
                ExitProcess(73);
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Err("Owner-exit test deadline expired".into())
}

fn loopback_exemptions(sid: PSID) -> Result<Value> {
    let mut count = 0;
    let mut list: *mut SID_AND_ATTRIBUTES = null_mut();
    let status = unsafe { NetworkIsolationGetAppContainerConfig(&mut count, &mut list) };
    if status != 0 {
        return Err(format!("Read-only loopback exemption query failed: {status}").into());
    }
    let mut own = false;
    // Do not log unrelated identities. Only compare our newly created SID.
    if !list.is_null() {
        for item in unsafe { std::slice::from_raw_parts(list, count as usize) } {
            own |= unsafe { EqualSid(item.Sid, sid) } != 0;
            unsafe {
                HeapFree(GetProcessHeap(), 0, item.Sid);
            }
        }
        unsafe {
            HeapFree(GetProcessHeap(), 0, list.cast());
        }
    }
    Ok(json!({"entryCount":count,"ownSidPresent":own,"readOnly":true}))
}

fn accounting(job: &Job) -> Result<Value> {
    let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
    check(unsafe {
        QueryInformationJobObject(
            job.0.as_raw_handle(),
            JobObjectBasicAccountingInformation,
            (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            null_mut(),
        )
    })?;
    Ok(
        json!({"totalProcesses":info.TotalProcesses,"activeProcesses":info.ActiveProcesses,"totalTerminatedProcesses":info.TotalTerminatedProcesses}),
    )
}

struct CompletionPort(OwnedHandle);
impl CompletionPort {
    fn attach(job: &Job) -> Result<Self> {
        let port = Self(unsafe {
            owned(CreateIoCompletionPort(
                INVALID_HANDLE_VALUE,
                null_mut(),
                0,
                1,
            ))?
        });
        let info = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: 1usize as *mut _,
            CompletionPort: port.0.as_raw_handle(),
        };
        check(unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectAssociateCompletionPortInformation,
                (&info as *const JOBOBJECT_ASSOCIATE_COMPLETION_PORT).cast(),
                size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32,
            )
        })?;
        Ok(port)
    }
    fn drain(&self) -> Result<Vec<Value>> {
        let mut events = Vec::new();
        loop {
            let mut message = 0;
            let mut key = 0;
            let mut pid = null_mut();
            if unsafe {
                GetQueuedCompletionStatus(
                    self.0.as_raw_handle(),
                    &mut message,
                    &mut key,
                    &mut pid,
                    0,
                )
            } == 0
            {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(WAIT_TIMEOUT as i32) {
                    break;
                }
                return Err(error.into());
            }
            events.push(json!({"message":message,"completionKey":key,"pidOrData":pid as usize}));
        }
        Ok(events)
    }
}

struct ObservedProcess {
    handle: OwnedHandle,
    evidence: Value,
}
fn observe(job: &Job, seen: &mut BTreeMap<u32, ObservedProcess>) -> Result<Vec<Value>> {
    let members = job.members()?;
    for member in &members {
        let pid = member["pid"].as_u64().ok_or("Missing Job PID")? as u32;
        if seen.contains_key(&pid) {
            continue;
        }
        if let Ok(handle) = unsafe {
            owned(OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            ))
        } {
            let mut in_job = 0;
            check(unsafe {
                IsProcessInJob(handle.as_raw_handle(), job.0.as_raw_handle(), &mut in_job)
            })?;
            let mut created = FILETIME::default();
            let mut exited = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            check(unsafe {
                GetProcessTimes(
                    handle.as_raw_handle(),
                    &mut created,
                    &mut exited,
                    &mut kernel,
                    &mut user,
                )
            })?;
            seen.insert(pid, ObservedProcess { handle, evidence:json!({"pid":pid,"inOwnerJob":in_job != 0,"creationTime":(u64::from(created.dwHighDateTime)<<32)|u64::from(created.dwLowDateTime),"observation":member}) });
        }
    }
    Ok(members)
}

struct DialogObservation<'a> {
    job: &'a Job,
    events: Vec<Value>,
}
unsafe extern "system" fn window_callback(window: HWND, parameter: LPARAM) -> i32 {
    let state = &mut *(parameter as *mut DialogObservation<'_>);
    let mut pid = 0;
    GetWindowThreadProcessId(window, &mut pid);
    if let Ok(process) = owned(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)) {
        let mut belongs = 0;
        if IsProcessInJob(
            process.as_raw_handle(),
            state.job.0.as_raw_handle(),
            &mut belongs,
        ) != 0
            && belongs != 0
        {
            let mut class = [0; 128];
            let n = GetClassNameW(window, class.as_mut_ptr(), class.len() as i32);
            let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
            if class == "#32770" && IsWindowVisible(window) != 0 {
                // Only close a visible dialog owned by a process verified in OUR Job.
                let posted = PostMessageW(window, WM_CLOSE, 0, 0) != 0;
                state.events.push(json!({"pid":pid,"class":class,"visible":true,"inOwnerJob":true,"closePosted":posted}));
            }
        }
    }
    1
}
fn observe_owned_dialogs(job: &Job) -> Result<Vec<Value>> {
    let mut state = DialogObservation {
        job,
        events: Vec::new(),
    };
    check(unsafe {
        EnumWindows(
            Some(window_callback),
            (&mut state as *mut DialogObservation<'_>) as LPARAM,
        )
    })?;
    Ok(state.events)
}

fn run_case(
    runtime: &Path,
    root: &Path,
    canary: &Path,
    name: &str,
    profile: Option<&Profile>,
    endpoints: &endpoints::Endpoints,
) -> Result<Value> {
    endpoints.set_case(name)?;
    let private = root.join(name);
    fs::create_dir(&private)?;
    fs::create_dir(private.join("udf"))?;
    fs::write(
        private.join("allowed.html"),
        "<!doctype html><meta charset=utf-8><p id=canary>private 中文 😀</p>",
    )?;
    let exe = private.join("w0.exe");
    fs::copy(std::env::current_exe()?, &exe)?;
    let owner_exit = name == "restricted-owner-exit";
    let deadline_test = name == "restricted-deadline";
    let mut input = json!({"mode":"matrix","case":name,"canary":canary,"endpoints":endpoints.addresses,"dnsEnabled":endpoints.dns_enabled,"dnsName":format!("w0-{name}-{}.invalid",std::process::id())});
    input["deadlineTest"] = json!(deadline_test);
    input["udpDiagnosis"] = json!(std::env::var("MILKUP_W0_UDP_DIAGNOSIS").as_deref() == Ok("1"));
    if owner_exit {
        let leaf = private.join("leaf");
        fs::create_dir(&leaf)?;
        fs::create_dir(leaf.join("udf"))?;
        fs::copy(&exe, leaf.join("w0.exe"))?;
        fs::copy(private.join("allowed.html"), leaf.join("allowed.html"))?;
        fs::write(leaf.join("input.json"), serde_json::to_vec(&input)?)?;
        input["ownerExitTest"] = json!(true);
    }
    fs::write(private.join("input.json"), serde_json::to_vec(&input)?)?;
    let mut report =
        json!({"name":name,"private":private,"restricted":profile.is_some(),"input":input});
    if let Some(profile) = profile {
        let sid = sid_text(profile.sid)?;
        for args in [
            vec!["/grant".to_string(), format!("*{sid}:(OI)(CI)F")],
            vec![
                "/setintegritylevel".to_string(),
                "(OI)(CI)L".to_string(),
                "/T".to_string(),
            ],
        ] {
            let out = Command::new("icacls.exe")
                .arg(&private)
                .args(&args)
                .output()?;
            if !out.status.success() {
                return Err(
                    format!("Private-only ACL operation failed: {:?}", out.status.code()).into(),
                );
            }
        }
        report["privateOnlyAclApplied"] = json!(true);
    }
    let job = Job::new()?;
    let port = CompletionPort::attach(&job)?;
    let mut completion_events = Vec::new();
    let mut seen = BTreeMap::new();
    let result = (|| -> Result<()> {
        let (process, thread) = launch_scoped(&exe, runtime, &private, profile, &job)?;
        let token = token_info(process.as_raw_handle())?;
        report["suspendedToken"] = token.clone();
        if token["isAppContainer"] != profile.is_some()
            || (profile.is_some() && token["capabilityCount"] != 0)
            || job.active()? != 1
        {
            return Err("Unexpected suspended token or owner Job".into());
        }
        if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
            return Err(std::io::Error::last_os_error().into());
        }
        let start = Instant::now();
        let mut samples = Vec::new();
        let mut completed_at = None;
        let mut owner_exit_requested = false;
        let mut intentional_deadline = None;
        let mut dialogs = Vec::new();
        loop {
            completion_events.extend(port.drain()?);
            samples.push(json!({"elapsedMs":start.elapsed().as_millis(),"members":observe(&job, &mut seen)?}));
            if let Ok(bytes) = fs::read(if owner_exit {
                private.join("leaf/child.json")
            } else {
                private.join("child.json")
            }) {
                if let Ok(child) = serde_json::from_slice::<Value>(&bytes) {
                    report["child"] = child;
                }
            }
            if deadline_test && report["child"]["phase"] == "intentional-pending-dom" {
                let at = intentional_deadline.get_or_insert_with(Instant::now);
                if at.elapsed() >= Duration::from_secs(2) {
                    report["intentionalDeadlineExpired"] = json!(true);
                    break;
                }
            }
            if report["child"]["phase"] == "picker-probe" {
                dialogs.extend(observe_owned_dialogs(&job)?);
            }
            if report["child"]["phase"] == "matrix-complete" {
                let done = completed_at.get_or_insert_with(Instant::now);
                if done.elapsed() >= Duration::from_secs(3) {
                    if !owner_exit {
                        break;
                    }
                    if !owner_exit_requested {
                        fs::write(
                            private.join("owner-exit-now"),
                            b"controlled-abnormal-owner-exit",
                        )?;
                        owner_exit_requested = true;
                    }
                }
            }
            if report["child"]["error"].is_string()
                || unsafe { WaitForSingleObject(process.as_raw_handle(), 0) } == WAIT_OBJECT_0
            {
                break;
            }
            if start.elapsed()
                > Duration::from_secs(if input["udpDiagnosis"] == true {
                    120
                } else {
                    90
                })
            {
                report["deadlineExpired"] = json!(true);
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if owner_exit {
            report["ownerExitRequested"] = json!(owner_exit_requested);
            report["owner"] = serde_json::from_slice(&fs::read(private.join("owner.json"))?)?;
            let mut exit = 0;
            check(unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut exit) })?;
            report["ownerExitCode"] = json!(exit);
            let deadline = Instant::now() + Duration::from_secs(5);
            while job.active()? != 0 && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            report["activeAfterOwnerExitBeforeHostStop"] = json!(job.active()?);
        }
        report["ownedPickerDialogs"] = json!(dialogs);
        report["observedDurationMs"] = json!(start.elapsed().as_millis());
        report["samples"] = json!(samples);
        report["accountingBeforeStop"] = accounting(&job)?;
        report["sampledDistinctProcesses"] = json!(seen.len());
        report["allAccountedProcessesSampled"] = json!(
            report["accountingBeforeStop"]["totalProcesses"].as_u64() == Some(seen.len() as u64)
        );
        report["completed"] = json!(
            report["child"]["phase"] == "matrix-complete"
                || (deadline_test && report["intentionalDeadlineExpired"] == true)
        );
        if report["completed"] != true
            || (owner_exit
                && (report["ownerExitCode"] != 73
                    || report["activeAfterOwnerExitBeforeHostStop"] != 0))
        {
            return Err(
                "Matrix child did not complete; preserve evidence without permission fallback"
                    .into(),
            );
        }
        Ok(())
    })();
    if let Err(e) = result {
        report["error"] = json!(e.to_string());
    }
    let stop = job.stop();
    report["stopResult"] = match stop {
        Ok(()) => json!({"ok":true}),
        Err(e) => json!({"ok":false,"error":e.to_string()}),
    };
    report["accountingAfterStop"] = accounting(&job)?;
    completion_events.extend(port.drain()?);
    report["jobCompletionEvents"] = json!(completion_events);
    report["jobCompletionBoundary"]=json!("Job notifications are not guaranteed; retain accounting totals and sampled process handles separately. An absent event is not absence of a process.");
    let mut retained = Vec::new();
    for (_, mut process) in seen {
        let wait = unsafe { WaitForSingleObject(process.handle.as_raw_handle(), 5000) };
        process.evidence["signaledAfterStop"] = json!(wait == WAIT_OBJECT_0);
        process.evidence["waitResult"] = json!(wait);
        retained.push(process.evidence);
    }
    report["retainedProcessHandles"] = json!(retained);
    report["endpointObservationsAtStop"] = endpoints.snapshot()?;
    Ok(report)
}

pub(super) fn run(runtime: &Path) -> Result<()> {
    if std::env::var("MILKUP_W0_AUTHORIZED").as_deref()
        != Ok("temporary-ci-no-network-private-directory-only")
        || std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
    {
        return Err("W0 matrix requires explicit authorized CI gate".into());
    }
    if !runtime.join("msedgewebview2.exe").is_file() {
        return Err("Existing Runtime unavailable; no download/ACL fallback".into());
    }
    let unique = format!(
        "milkup-w0-matrix-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    );
    let root = std::env::temp_dir().join(&unique);
    fs::create_dir(&root)?;
    let canary = root.join("outside.html");
    let original = b"<!doctype html><p id=canary>outside-controlled-canary</p>";
    fs::write(&canary, original)?;
    let mut report = json!({"name":unique,"runtime":runtime,"source":std::env::var("GITHUB_SHA").ok(),"productIntegrated":false,"runtimeAclChanged":false,"firewallChanged":false,"loopbackExceptionAdded":false,"privilegeElevation":false,"cases":[]});
    let mut profile = None;
    let result = (|| -> Result<()> {
        let endpoints = endpoints::Endpoints::new()?;
        report["endpoints"] = json!(endpoints.addresses);
        report["dnsServerAvailable"] = json!(endpoints.dns_enabled);
        profile = Some(Profile::create(&unique)?);
        let p = profile.as_mut().unwrap();
        report["appContainerSid"] = json!(p.sid_string()?);
        report["loopbackExemptions"] = loopback_exemptions(p.sid)?;
        if report["loopbackExemptions"]["ownSidPresent"] != false {
            return Err("Temporary identity unexpectedly has loopback exemption".into());
        }
        for (name, restricted) in [
            ("ordinary", false),
            ("restricted", true),
            ("restricted-owner-exit", true),
            ("restricted-deadline", true),
        ] {
            if std::env::var("MILKUP_W0_UDP_DIAGNOSIS").as_deref() == Ok("1")
                && name != "ordinary"
                && name != "restricted"
            {
                continue;
            }
            let case = run_case(
                runtime,
                &root,
                &canary,
                name,
                if restricted { Some(p) } else { None },
                &endpoints,
            )?;
            report["cases"].as_array_mut().unwrap().push(case);
            report[format!("loopbackExemptionsAfter-{name}")] = loopback_exemptions(p.sid)?;
        }
        report["endpointObservationsFinal"] = endpoints.snapshot()?;
        let ordinary = report["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == "ordinary");
        let mut native = Vec::new();
        if let Some(c) = ordinary {
            for key in ["udpBeforeRuntime", "udpAfterRuntime"] {
                if let Some(rows) = c["child"][key]["cases"].as_array() {
                    native.extend(rows.iter().cloned());
                }
            }
        }
        let assessment = assessment::assess(
            report["endpointObservationsFinal"].as_array().unwrap(),
            &endpoints.addresses,
            &native,
            std::env::var("MILKUP_W0_UDP_DIAGNOSIS").as_deref() == Ok("1"),
        );
        report["networkCanaryGatePassed"] = assessment["networkCanaryGatePassed"].clone();
        report["receivedRestrictedCanaries"] = assessment["receivedRestrictedCanaries"].clone();
        report["networkAssessment"] = assessment;
        Ok(())
    })();
    if let Err(e) = &result {
        report["error"] = json!(e.to_string());
    }
    let mut cleanup_errors = Vec::new();
    report["outsideFileUnchanged"] =
        json!(fs::read(&canary).ok().as_deref() == Some(original.as_slice()));
    if let Some(p) = &mut profile {
        match p.delete() {
            Ok(()) => report["profileDeletedAndFolderAbsent"] = json!(true),
            Err(e) => cleanup_errors.push(e.to_string()),
        }
    }
    match fs::remove_dir_all(&root) {
        Ok(()) => report["privateTreeAndAclRemoved"] = json!(!root.exists()),
        Err(e) => cleanup_errors.push(e.to_string()),
    }
    report["cleanupErrors"] = json!(cleanup_errors);
    report["fullIsolationGatePassed"] = json!(false);
    report["boundary"]=json!("Finite controlled loopback WebView2/native network and file observations; no system DNS, arbitrary endpoint, broker completeness, ordinary-user GUI, or full isolation acceptance. Stop/retained-handle observations do not cover unsampled/transient or broker-created processes. Product DOM/PDF stays closed.");
    println!(
        "::group::windows-w0-matrix.json\n{}\n::endgroup::",
        serde_json::to_string_pretty(&report)?
    );
    result?;
    if !cleanup_errors.is_empty()
        || report["outsideFileUnchanged"] != true
        || report["cases"].as_array().is_none_or(|cases| {
            cases.len()
                != if std::env::var("MILKUP_W0_UDP_DIAGNOSIS").as_deref() == Ok("1") {
                    2
                } else {
                    4
                }
                || cases.iter().any(|c| {
                    c["completed"] != true
                        || c["stopResult"]["ok"] != true
                        || c["error"].is_string()
                })
        })
    {
        return Err("Matrix execution/cleanup incomplete; see bounded evidence".into());
    }
    if report["networkCanaryGatePassed"] == false {
        return Err("Restricted network canary delivered: full isolation remains blocked".into());
    }
    if report["networkAssessment"]["observationControlsPassed"] != true {
        return Err("Network observation invalid: receiver or positive control failed".into());
    }
    Ok(())
}

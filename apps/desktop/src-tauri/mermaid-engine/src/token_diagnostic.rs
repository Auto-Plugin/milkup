//! Windows-only ignored native tests. No diagnostic entry exists in the product.
//! Observations are not rendering acceptance or a claim that a linked token is usable.
use super::*;
use crate::token_diagnostic_format::{
    canonical_privilege_name, object_basic_complete, parse_child_record, privilege_array_fits,
    CHILD_MARKER, OUTPUT_BUDGET,
};
use sha2::{Digest, Sha256};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

const MARKER: &str = "MILKUP_MERMAID_TOKEN_DIAGNOSTIC ";
const CHILD_TEST_SECONDS: u32 = 10;

#[repr(C)]
#[derive(Default)]
struct ObjectBasicInformation {
    attributes: u32,
    granted_access: u32,
    handle_count: u32,
    pointer_count: u32,
    reserved: [u32; 10],
}
type NtQueryObject =
    unsafe extern "system" fn(HANDLE, i32, *mut std::ffi::c_void, u32, *mut u32) -> i32;

fn error_record(stage: &'static str, error: &(dyn std::error::Error + 'static)) -> Value {
    json!({"stage":stage,"win32Error":error.downcast_ref::<std::io::Error>()
        .and_then(|error| error.raw_os_error()),"complete":false})
}

// Unlike the product's summary, this probe retains the actual returned length
// so alignment padding cannot become a privilege entry in the diagnostic.
fn information(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> Result<(Vec<usize>, usize)> {
    let mut length = 0;
    let result = unsafe { GetTokenInformation(token, class, null_mut(), 0, &mut length) };
    let error = std::io::Error::last_os_error();
    if result != 0
        || error.raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32)
        || length == 0
        || length > 1_048_576
    {
        return Err("Cannot size bounded diagnostic token information".into());
    }
    let capacity = length;
    let mut storage = vec![0usize; (capacity as usize).div_ceil(size_of::<usize>())];
    check(unsafe {
        GetTokenInformation(
            token,
            class,
            storage.as_mut_ptr().cast(),
            capacity,
            &mut length,
        )
    })?;
    if length == 0 || length > capacity {
        return Err("Invalid diagnostic token return length".into());
    }
    Ok((storage, length as usize))
}

fn full_privileges(token: HANDLE) -> Result<Value> {
    let (storage, length) = information(token, TokenPrivileges)?;
    if length < size_of::<u32>() {
        return Err("Missing privilege count".into());
    }
    let count = unsafe { storage.as_ptr().cast::<u32>().read() } as usize;
    let offset = std::mem::offset_of!(TOKEN_PRIVILEGES, Privileges);
    if !privilege_array_fits(count, length, offset, size_of::<LUID_AND_ATTRIBUTES>()) {
        return Err("Invalid bounded privilege array".into());
    }
    let entries = unsafe {
        std::slice::from_raw_parts(
            storage
                .as_ptr()
                .cast::<u8>()
                .add(offset)
                .cast::<LUID_AND_ATTRIBUTES>(),
            count,
        )
    };
    let mut seen = std::collections::HashSet::new();
    let mut values = Vec::new();
    for entry in entries {
        let luid = format!(
            "{:08x}:{:08x}",
            entry.Luid.HighPart as u32, entry.Luid.LowPart
        );
        if !seen.insert(luid.clone()) {
            return Err("Duplicate privilege LUID".into());
        }
        let mut name = [0u16; 129];
        let mut name_length = name.len() as u32;
        check(unsafe {
            LookupPrivilegeNameW(null(), &entry.Luid, name.as_mut_ptr(), &mut name_length)
        })?;
        if name_length == 0 || name_length > 128 {
            return Err("Privilege name budget exceeded".into());
        }
        let name = String::from_utf16(&name[..name_length as usize])?;
        if !canonical_privilege_name(&name) {
            return Err("Noncanonical privilege name".into());
        }
        values.push(
            json!({"luid":luid,"name":name,"attributes":entry.Attributes,
            "enabled":entry.Attributes & SE_PRIVILEGE_ENABLED != 0,
            "enabledByDefault":entry.Attributes & SE_PRIVILEGE_ENABLED_BY_DEFAULT != 0}),
        );
    }
    Ok(json!({"complete":true,"count":count,"items":values}))
}

fn token_facts(token: HANDLE) -> Result<Value> {
    let user = token_buffer(token, TokenUser)?;
    let owner = token_buffer(token, TokenOwner)?;
    let user_sid = sid_text(unsafe { (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid })?;
    let owner_sid = sid_text(unsafe { (*(owner.as_ptr().cast::<TOKEN_OWNER>())).Owner })?;
    let integrity = token_buffer(token, TokenIntegrityLevel)?;
    let label = unsafe { &*integrity.as_ptr().cast::<TOKEN_MANDATORY_LABEL>() };
    let count = unsafe { *GetSidSubAuthorityCount(label.Label.Sid) };
    if count == 0 {
        return Err("Missing integrity label".into());
    }
    let integrity_rid = unsafe { *GetSidSubAuthority(label.Label.Sid, u32::from(count) - 1) };
    let token_type = token_u32(token, TokenType)?;
    let impersonation_level = match token_type {
        1 => None,
        2 => Some(token_u32(token, TokenImpersonationLevel)?),
        _ => return Err("Unknown observed token type".into()),
    };
    if impersonation_level.is_some_and(|value| value > 3) {
        return Err("Unknown impersonation level".into());
    }
    let is_container = token_u32(token, TokenIsAppContainer)? != 0;
    let app_sid = if is_container {
        let data = token_buffer(token, TokenAppContainerSid)?;
        Some(sid_text(unsafe {
            (*(data.as_ptr().cast::<TOKEN_APPCONTAINER_INFORMATION>())).TokenAppContainer
        })?)
    } else {
        None
    };
    let groups = token_groups(token, TokenGroups)?;
    let admin = groups
        .iter()
        .find(|(sid, _)| sid == "S-1-5-32-544")
        .map(|(_, flags)| *flags);
    let capabilities = token_groups(token, TokenCapabilities)?;
    let privileges = full_privileges(token)?;
    Ok(
        json!({"tokenType":token_type,"impersonationLevel":impersonation_level,
        "userSid":user_sid,"ownerSid":owner_sid,"sessionId":token_u32(token, TokenSessionId)?,
        "elevated":token_u32(token, TokenElevation)? != 0,"elevationType":token_u32(token, TokenElevationType)?,
        "integrityRid":integrity_rid,"uiAccess":token_u32(token, TokenUIAccess)? != 0,
        "isAppContainer":is_container,"appContainerSid":app_sid,"capabilityCount":capabilities.len(),
        "administratorsGroupAttributes":admin,"privileges":privileges}),
    )
}

fn handle_access(handle: HANDLE) -> Value {
    // Only resolve the already loaded system module; never load a caller DLL.
    let module = unsafe { GetModuleHandleW(wide(OsStr::new("ntdll.dll")).as_ptr()) };
    if module.is_null() {
        return json!({"complete":false,"stage":"loaded-ntdll","win32Error":unsafe { GetLastError() }});
    }
    let address = unsafe { GetProcAddress(module, b"NtQueryObject\0".as_ptr()) };
    let Some(address) = address else {
        return json!({"complete":false,"stage":"resolve-ntqueryobject","win32Error":unsafe { GetLastError() }});
    };
    let query: NtQueryObject = unsafe { std::mem::transmute(address) };
    let mut result = ObjectBasicInformation::default();
    let mut returned = 0;
    let status = unsafe {
        query(
            handle,
            0,
            (&mut result as *mut ObjectBasicInformation).cast(),
            size_of::<ObjectBasicInformation>() as u32,
            &mut returned,
        )
    };
    let complete = object_basic_complete(status, returned);
    json!({"complete":complete,"ntstatus":status,"ntstatusHex":format!("{:08x}",status as u32),
        "returnedBytes":returned,"grantedAccess":if complete { Some(result.granted_access) } else { None },
        "handleAttributes":if complete { Some(result.attributes) } else { None }})
}

fn linked_observation(token: HANDLE, request_rights: bool) -> Value {
    // One fixed-size call only: a successful sizing probe could allocate a
    // handle that would otherwise be lost. Always own the returned handle first.
    let mut linked = TOKEN_LINKED_TOKEN {
        LinkedToken: null_mut(),
    };
    let mut returned = 0;
    let result = unsafe {
        GetTokenInformation(
            token,
            TokenLinkedToken,
            (&mut linked as *mut TOKEN_LINKED_TOKEN).cast(),
            size_of::<TOKEN_LINKED_TOKEN>() as u32,
            &mut returned,
        )
    };
    let win32 = if result == 0 {
        Some(unsafe { GetLastError() })
    } else {
        None
    };
    if result == 0 {
        return json!({"complete":true,"querySucceeded":false,"win32Error":win32,
            "returnedBytes":returned,"handleAccess":null,"target":null,"duplicateRequests":[],"allReturnedHandlesClosed":true});
    }
    let Ok(handle) = (unsafe { owned(linked.LinkedToken) }) else {
        return json!({"complete":false,"querySucceeded":true,"stage":"invalid-linked-handle"});
    };
    if returned as usize != size_of::<TOKEN_LINKED_TOKEN>() {
        drop(handle);
        return json!({"complete":false,"querySucceeded":true,"stage":"linked-return-size", "returnedBytes":returned,"allReturnedHandlesClosed":true});
    }
    let access = handle_access(handle.as_raw_handle());
    let target = token_facts(handle.as_raw_handle())
        .unwrap_or_else(|error| error_record("linked-target-query", error.as_ref()));
    let mut requests = Vec::new();
    if request_rights {
        for (kind, desired) in [
            ("duplicate", TOKEN_QUERY | TOKEN_DUPLICATE),
            ("assign-primary", TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY),
            ("impersonate", TOKEN_QUERY | TOKEN_IMPERSONATE),
        ] {
            let mut duplicate = null_mut();
            // Same process, non-inheritable, exactly the requested rights. No
            // SAME_ACCESS, CLOSE_SOURCE, MAXIMUM_ALLOWED, token duplication,
            // impersonation, privilege adjustment or launch is attempted.
            let ok = unsafe {
                DuplicateHandle(
                    GetCurrentProcess(),
                    handle.as_raw_handle(),
                    GetCurrentProcess(),
                    &mut duplicate,
                    desired,
                    0,
                    0,
                )
            };
            let error = if ok == 0 {
                Some(unsafe { GetLastError() })
            } else {
                None
            };
            let mut record = json!({"kind":kind,"requestedAccess":desired,"succeeded":ok != 0,
                "win32Error":error,"handleAccess":null,"target":null,"handleClosed":true,"complete":true});
            if ok != 0 {
                match unsafe { owned(duplicate) } {
                    Ok(duplicate) => {
                        let observed = handle_access(duplicate.as_raw_handle());
                        let facts =
                            token_facts(duplicate.as_raw_handle()).unwrap_or_else(|error| {
                                error_record("duplicate-target-query", error.as_ref())
                            });
                        record["complete"] =
                            json!(observed["complete"] == true && facts.get("tokenType").is_some());
                        record["handleAccess"] = observed;
                        record["target"] = facts;
                        drop(duplicate);
                    }
                    Err(_) => {
                        record["complete"] = json!(false);
                        record["handleClosed"] = json!(false);
                    }
                }
            }
            requests.push(record);
        }
    }
    let complete = access["complete"] == true
        && target.get("tokenType").is_some()
        && requests.iter().all(|record| record["complete"] == true);
    drop(handle);
    json!({"complete":complete,"querySucceeded":true,"win32Error":null,"returnedBytes":returned,
        "handleAccess":access,"target":target,"duplicateRequests":requests,"allReturnedHandlesClosed":true})
}

fn caller_thread_context() -> Value {
    let mut raw = null_mut();
    let result = unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 0, &mut raw) };
    if result == 0 {
        let error = unsafe { GetLastError() };
        return json!({"present":if error == ERROR_NO_TOKEN { Some(false) } else { None },
            "complete":error == ERROR_NO_TOKEN,"win32Error":error,"token":null,"handleClosed":true});
    }
    let Ok(token) = (unsafe { owned(raw) }) else {
        return json!({"present":true,"complete":false,"stage":"invalid-thread-token-handle"});
    };
    let facts = token_facts(token.as_raw_handle())
        .unwrap_or_else(|error| error_record("caller-thread-token-query", error.as_ref()));
    drop(token);
    // An unexpected impersonating caller is retained as evidence, but the
    // linked-handle experiment must not run under that different context.
    json!({"present":true,"complete":false,"win32Error":null,"token":facts,"handleClosed":true})
}

fn observe(process: HANDLE, caller: &'static str, requests: bool) -> Result<Value> {
    let context = caller_thread_context();
    let token = open_token(process, TOKEN_QUERY)?;
    let facts = token_facts(token.as_raw_handle())?;
    let linked = if context["complete"] == true {
        linked_observation(token.as_raw_handle(), requests)
    } else {
        json!({"complete":false,"queryAttempted":false,"stage":"caller-thread-context"})
    };
    Ok(
        json!({"caller":caller,"observerPid":unsafe { GetCurrentProcessId() },
        "subjectPid":unsafe { GetProcessId(process) },"token":facts,"linkedToken":linked,
        "callerThreadToken":context,
        "complete":linked["complete"] == true,"requestedSourceTokenAccess":TOKEN_QUERY}),
    )
}

fn diagnostic_child_baseline(token: &Value) -> bool {
    // This is admission for trusted native diagnostic instructions only, never
    // renderer admission. In particular, the two rejected observations remain
    // observable without altering verify_sandbox or sending any source.
    token["tokenType"] == 1
        && token["elevated"] == false
        && token["uiAccess"] == false
        && token["isAppContainer"] == true
        && token["capabilityCount"] == 0
        && token["integrityRid"]
            .as_u64()
            .is_some_and(|rid| rid <= 4096)
        && token["sessionId"]
            .as_u64()
            .is_some_and(|session| session > 0)
        && matches!(token["elevationType"].as_u64(), Some(1 | 3))
        && token["userSid"] == token["ownerSid"]
        && token["userSid"]
            .as_str()
            .is_some_and(crate::cleanup::concrete_user_sid)
        && (token["administratorsGroupAttributes"].is_null()
            || token["administratorsGroupAttributes"] == 16)
        && crate::token_policy::audit_app_sid(&token["appContainerSid"]).is_string()
        && token["privileges"]["items"]
            .as_array()
            .is_some_and(|items| {
                items.iter().all(|item| {
                    matches!(
                        item["name"].as_str(),
                        Some(
                            "SeChangeNotifyPrivilege"
                                | "SeShutdownPrivilege"
                                | "SeUndockPrivilege"
                                | "SeIncreaseWorkingSetPrivilege"
                                | "SeTimeZonePrivilege"
                        )
                    )
                })
            })
}

fn print_record(marker: &str, record: &Value) -> Result<()> {
    let original = serde_json::to_vec(record)?;
    let oversized = original.len() > OUTPUT_BUDGET - 256;
    // Preserve an explicit failed, incomplete record even when the complete
    // observation cannot fit. Never truncate JSON or label a prefix complete.
    let bytes = if oversized {
        let failure = json!({"stage":"output-budget","complete":false,"win32Error":null,
            "completeRecordBytes":original.len(),"completeRecordSha256":format!("{:x}",Sha256::digest(&original))});
        let fallback = if marker == CHILD_MARKER {
            json!({"caller":"appcontainer-self","complete":false,"failedStage":failure})
        } else {
            json!({"schema":1,"status":"failed","accountKind":record["accountKind"],
                "diagnosticOnly":true,"observationsComplete":false,"failedStage":failure,
                "cleanup":record["cleanup"]})
        };
        serde_json::to_vec(&fallback)?
    } else {
        original
    };
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(b"\n")?;
    stdout.write_all(marker.as_bytes())?;
    stdout.write_all(&bytes)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    if oversized {
        return Err("Complete diagnostic JSON exceeds output budget".into());
    }
    Ok(())
}

#[test]
#[ignore = "only the owned zero-capability native test child may run this probe"]
fn child_observes_own_token() {
    let result = (|| -> Result<Value> {
        let token = open_token(unsafe { GetCurrentProcess() }, TOKEN_QUERY)?;
        let facts = token_facts(token.as_raw_handle())?;
        // Reject accidental direct invocation before any linked-handle query or
        // duplicate request. Only the fixed owned AppContainer runs the probe.
        if !diagnostic_child_baseline(&facts) {
            return Err("Self probe requires the trusted AppContainer baseline".into());
        }
        observe(unsafe { GetCurrentProcess() }, "appcontainer-self", true)
    })();
    let observation = result.unwrap_or_else(|error| {
        json!({"caller":"appcontainer-self",
        "complete":false,"failedStage":error_record("self-token-observation", error.as_ref())})
    });
    print_record(CHILD_MARKER, &observation).unwrap();
    assert_eq!(observation["complete"], true, "Incomplete self observation");
}

fn bounded_reader(file: File) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        file.take((OUTPUT_BUDGET + 1) as u64)
            .read_to_end(&mut bytes)?;
        if bytes.len() > OUTPUT_BUDGET {
            return Err(std::io::Error::other("Diagnostic output budget"));
        }
        Ok(bytes)
    })
}

#[test]
#[ignore = "requires an explicitly authorized fresh standard or filtered-admin fixture"]
fn parent_observes_suspended_and_self_tokens() {
    assert_eq!(
        std::env::var("MILKUP_MERMAID_TOKEN_DIAGNOSTIC").as_deref(),
        Ok("1")
    );
    let expected = std::env::var("MILKUP_MERMAID_TOKEN_DIAGNOSTIC_ACCOUNT_KIND").unwrap();
    assert!(matches!(
        expected.as_str(),
        "pure-standard" | "filtered-admin"
    ));
    let mut report = json!({"schema":1,"status":"failed","accountKind":expected,"parentPid":std::process::id(),
        "host":null,"suspendedParentView":null,"childSelfView":null,"failedStage":null,
        "mermaidSourceBytes":0,"comStarted":false,"webviewStarted":false,"javascriptStarted":false,
        "renderPolicyChanged":false,"diagnosticOnly":true,"childDeadlineMs":CHILD_TEST_SECONDS*1000,
        "cleanup":{"jobCreated":false,"jobEmpty":false,"profileCreated":false,"profileDeleted":false,
            "privateTreeCreated":false,"privateTreeRemoved":false,"ipcCompleted":false,"errors":[]}});
    let mut phase = "host";
    let mut root = None;
    let mut profile = None;
    let mut job = None;
    let mut pins = None;
    let mut readers = Vec::new();
    let mut child_exit = None;
    let result = (|| -> Result<()> {
        let host_summary = token_info(unsafe { GetCurrentProcess() })?;
        let mut session = 0;
        check(unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session) })?;
        let host_class = crate::token_policy::classify_host(&host_summary, session)?;
        if host_class.name() != expected {
            return Err("Actual host class differs from the requested fixture".into());
        }
        let host = open_token(unsafe { GetCurrentProcess() }, TOKEN_QUERY)?;
        report["host"] = token_facts(host.as_raw_handle())?;
        report["hostPolicyAccepted"] = json!(true);
        phase = "owned-root";
        let unique = format!(
            "milkup-token-diagnostic-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
        );
        let temp = fs::canonicalize(std::env::temp_dir())?;
        reject_reparse_ancestors(&temp)?;
        let created = temp.join(&unique);
        fs::create_dir(&created)?;
        root = Some(created.clone());
        report["cleanup"]["privateTreeCreated"] = json!(true);
        phase = "profile";
        profile = Some(Profile::create(&unique)?);
        report["cleanup"]["profileCreated"] = json!(true);
        profile.as_mut().unwrap().initialize_folder()?;
        let profile_ref = profile.as_ref().unwrap();
        let sid = sid_text(profile_ref.sid)?;
        report["freshAppContainerSid"] = json!(sid);
        let owner = host_summary["userSid"].as_str().ok_or("Missing host SID")?;
        let system = system_directory()?;
        let mut acl_audit = json!([]);
        phase = "owned-acl-and-pinned-test-image";
        acl(
            &system,
            &created,
            &[
                "/inheritance:r".into(),
                "/grant:r".into(),
                format!("*{owner}:(OI)(CI)F"),
                "*S-1-5-18:(OI)(CI)F".into(),
                format!("*{sid}:(OI)(CI)RX"),
            ],
            &mut acl_audit,
        )?;
        let code = created.join("code");
        let state = created.join("state");
        fs::create_dir(&code)?;
        fs::create_dir(&state)?;
        acl(
            &system,
            &state,
            &["/grant:r".into(), format!("*{sid}:(OI)(CI)F")],
            &mut acl_audit,
        )?;
        acl(
            &system,
            &state,
            &["/setintegritylevel".into(), "(OI)(CI)L".into()],
            &mut acl_audit,
        )?;
        let exe = code.join("milkup-token-diagnostic.exe");
        pins = Some(pinned_copy(&std::env::current_exe()?, &exe)?);
        phase = "creation-time-job";
        job = Some(Job::new()?);
        report["cleanup"]["jobCreated"] = json!(true);
        let job_ref = job.as_ref().unwrap();
        let Spawned {
            process,
            thread: primary_thread,
            input,
            output,
            error,
        } = launch_entry(
            &exe,
            &system,
            &state,
            &system,
            profile_ref,
            job_ref,
            FixedChildEntry::TokenDiagnostic,
        )?;
        drop(input); // No source, request, input protocol or caller payload.
        phase = "parent-suspended-observation";
        let observed = observe(process.as_raw_handle(), "parent-suspended-child", false)?;
        report["suspendedParentView"] = observed.clone();
        if observed["callerThreadToken"]["complete"] != true
            || !diagnostic_child_baseline(&observed["token"])
            || observed["token"]["userSid"] != owner
            || observed["token"]["sessionId"] != session
            || observed["token"]["appContainerSid"] != sid
            || job_ref.active()? != 1
        {
            return Err("Trusted diagnostic child ownership or baseline mismatch".into());
        }
        report["executionAncestryAccessDenials"] =
            check_code_parent_access(process.as_raw_handle(), &code)?;
        report["childPid"] = json!(unsafe { GetProcessId(process.as_raw_handle()) });
        report["creationTimeJobVerified"] = json!(true);
        readers.push(("stdout", bounded_reader(output)));
        readers.push(("stderr", bounded_reader(error)));
        phase = "fixed-self-probe";
        if unsafe { ResumeThread(primary_thread.as_raw_handle()) } == u32::MAX {
            return Err(std::io::Error::last_os_error().into());
        }
        let wait =
            unsafe { WaitForSingleObject(process.as_raw_handle(), CHILD_TEST_SECONDS * 1000) };
        if wait != WAIT_OBJECT_0 {
            return Err("Diagnostic child did not exit within its original deadline".into());
        }
        let mut exit = 0;
        check(unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut exit) })?;
        child_exit = Some(exit);
        report["childExitCode"] = json!(exit);
        if exit != 0 {
            return Err("Fixed native child probe failed".into());
        }
        Ok(())
    })();
    if let Err(error) = &result {
        report["failedStage"] = error_record(phase, error.as_ref());
    }

    // One checked cleanup path even after partial construction. Never kill or
    // inspect an unowned process tree, or alter an existing login/profile/ACL.
    let mut errors = Vec::new();
    if let Some(job_ref) = &job {
        match job_ref.stop() {
            Ok(()) => report["cleanup"]["jobEmpty"] = json!(true),
            Err(error) => errors.push(error_record("owned-job-stop", error.as_ref())),
        }
    }
    let mut join_errors = Vec::new();
    let mut join_kinds = Vec::new();
    let mut joins = Vec::new();
    let mut stdout = None;
    for (name, reader) in readers {
        match join_bounded(
            reader,
            name,
            &mut join_errors,
            &mut join_kinds,
            &mut joins,
            None,
        ) {
            Some(Ok(bytes)) => {
                report[format!("{name}Bytes")] = json!(bytes.len());
                report[format!("{name}Sha256")] = json!(format!("{:x}", Sha256::digest(&bytes)));
                if name == "stdout" {
                    stdout = Some(bytes);
                } else if !bytes.is_empty() {
                    errors.push(json!({"stage":"unexpected-stderr","complete":false}));
                }
            }
            Some(Err(error)) => errors.push(error_record("pipe-read", &error)),
            None => errors.push(json!({"stage":"pipe-join","complete":false})),
        }
    }
    for kind in join_kinds {
        errors.push(json!({"stage":"pipe-join","kind":kind,"complete":false}));
    }
    report["cleanup"]["ipcCompleted"] = json!(
        joins.len() == 2
            && joins.iter().all(|join| join["finished"] == true
                && join["cancelRequested"] == false
                && join["panicked"] == false)
    );
    report["cleanup"]["joins"] = json!(joins);
    drop(pins);
    if let Some(profile_ref) = profile.as_mut() {
        if job.is_none() || report["cleanup"]["jobEmpty"] == true {
            match profile_ref.delete() {
                Ok(()) => report["cleanup"]["profileDeleted"] = json!(true),
                Err(error) => {
                    profile_ref.retain = true;
                    errors.push(error_record("profile-delete", error.as_ref()));
                }
            }
        } else {
            profile_ref.retain = true;
            errors.push(json!({"stage":"profile-retained-job-uncertain","complete":false}));
        }
    }
    if let Some(root) = &root {
        if job.is_none() || report["cleanup"]["jobEmpty"] == true {
            let until = Instant::now() + Duration::from_secs(3);
            loop {
                match fs::remove_dir_all(root) {
                    Ok(()) => {
                        report["cleanup"]["privateTreeRemoved"] = json!(!root.exists());
                        break;
                    }
                    Err(_) if Instant::now() < until => thread::sleep(Duration::from_millis(50)),
                    Err(error) => {
                        errors.push(error_record("private-tree-remove", &error));
                        break;
                    }
                }
            }
        }
    }
    report["cleanup"]["errors"] = json!(errors);
    if let Some(bytes) = stdout {
        let parsed: Result<Value> = parse_child_record(&bytes).map_err(Into::into);
        match parsed {
            Ok(value) => report["childSelfView"] = value,
            Err(error) => {
                if report["failedStage"].is_null() {
                    report["failedStage"] = error_record("child-record", error.as_ref());
                }
            }
        }
    }
    let self_token = &report["childSelfView"]["token"];
    let parent_token = &report["suspendedParentView"]["token"];
    let identity_matches = [
        "userSid",
        "ownerSid",
        "sessionId",
        "appContainerSid",
        "tokenType",
        "integrityRid",
        "elevationType",
    ]
    .iter()
    .all(|field| self_token.get(*field).is_some() && self_token[*field] == parent_token[*field])
        && report["childSelfView"]["observerPid"] == report["childPid"]
        && report["childSelfView"]["subjectPid"] == report["childPid"]
        && report["suspendedParentView"]["subjectPid"] == report["childPid"]
        && report["suspendedParentView"]["observerPid"] == report["parentPid"];
    let privileges_match = self_token.get("privileges").is_some()
        && self_token["privileges"] == parent_token["privileges"];
    report["parentAndSelfPrivilegesMatch"] = json!(privileges_match);
    report["parentAndSelfIdentityMatch"] = json!(identity_matches);
    let complete = result.is_ok()
        && child_exit == Some(0)
        && report["failedStage"].is_null()
        && report["suspendedParentView"]["complete"] == true
        && report["childSelfView"]["complete"] == true
        && identity_matches
        && report["cleanup"]["jobEmpty"] == true
        && report["cleanup"]["profileDeleted"] == true
        && report["cleanup"]["privateTreeRemoved"] == true
        && report["cleanup"]["ipcCompleted"] == true
        && errors.is_empty();
    report["status"] = json!(if complete { "observed" } else { "failed" });
    print_record(MARKER, &report).unwrap();
    assert!(
        complete,
        "Token diagnostic was incomplete; preserve the closed observation and cleanup evidence"
    );
}

#[test]
fn object_basic_information_layout_matches_documented_abi() {
    assert_eq!(size_of::<ObjectBasicInformation>(), 56);
    assert_eq!(
        std::mem::offset_of!(ObjectBasicInformation, granted_access),
        4
    );
}

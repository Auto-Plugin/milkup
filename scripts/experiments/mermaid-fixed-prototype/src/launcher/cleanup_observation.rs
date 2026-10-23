//! Bounded access observations after the original owned-tree deletion failed.
//! The caller has already released pins and stopped the owned Job. No deletion,
//! privilege adjustment, impersonation, file-content read or enumeration occurs.
use super::*;
use std::os::windows::io::IntoRawHandle;

const JSON_LIMIT: usize = 4096;
const OPEN_LIMIT: usize = 7;

fn close_observed(handle: OwnedHandle) -> Value {
    let ok = unsafe { CloseHandle(handle.into_raw_handle()) };
    // Capture the error before any formatting or another Windows call.
    let error = if ok == 0 {
        Some(unsafe { GetLastError() })
    } else {
        None
    };
    json!({"succeeded":ok != 0,"rawOsError":error})
}

fn query_error(error: &(dyn std::error::Error + 'static)) -> Value {
    json!({
        "rawOsError":error.downcast_ref::<std::io::Error>().and_then(std::io::Error::raw_os_error),
        "message":error.to_string().chars().take(96).collect::<String>()
    })
}

fn token_summary(handle: HANDLE, thread_token: bool) -> Value {
    let mut result =
        json!({"userSid":null,"isAppContainer":null,"impersonationLevel":null,"errors":{}});
    let user = (|| -> Result<String> {
        let buffer = token_buffer(handle, TokenUser)?;
        if buffer.len() * size_of::<usize>() < size_of::<TOKEN_USER>() {
            return Err("Short TOKEN_USER observation".into());
        }
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        sid_text(user.User.Sid)
    })();
    match user {
        Ok(sid) => result["userSid"] = json!(sid),
        Err(error) => result["errors"]["userSid"] = query_error(error.as_ref()),
    }
    match token_u32(handle, TokenIsAppContainer) {
        Ok(value) => result["isAppContainer"] = json!(value != 0),
        Err(error) => result["errors"]["isAppContainer"] = query_error(error.as_ref()),
    }
    if thread_token {
        match token_u32(handle, TokenImpersonationLevel) {
            Ok(value) => result["impersonationLevel"] = json!(value),
            Err(error) => result["errors"]["impersonationLevel"] = query_error(error.as_ref()),
        }
    }
    result
}

fn process_token() -> Value {
    match open_token(unsafe { GetCurrentProcess() }, TOKEN_QUERY) {
        Ok(handle) => {
            let summary = token_summary(handle.as_raw_handle(), false);
            let close = close_observed(handle);
            json!({"status":"present","summary":summary,"close":close})
        }
        Err(error) => json!({"status":"unknown","error":query_error(error.as_ref())}),
    }
}

fn thread_token() -> Value {
    let mut raw = null_mut();
    let ok = unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut raw) };
    if ok == 0 {
        let error = unsafe { GetLastError() };
        return json!({
            "status":if error == ERROR_NO_TOKEN {"none"} else {"unknown"},
            "openAsSelf":true,"rawOsError":error
        });
    }
    if raw.is_null() || raw == INVALID_HANDLE_VALUE {
        return json!({"status":"unknown","openAsSelf":true,"error":"invalid returned token handle"});
    }
    let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
    let summary = token_summary(handle.as_raw_handle(), true);
    let close = close_observed(handle);
    json!({"status":"present","openAsSelf":true,"summary":summary,"close":close})
}

fn ancestry_guard(path: &Path, directory: bool) -> Option<Value> {
    for ancestor in path.ancestors().filter(|part| !part.as_os_str().is_empty()) {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return Some(json!({"kind":"reparse-ancestor-rejected"}));
                }
                if ancestor == path
                    && (metadata.is_dir() != directory || (!directory && !metadata.is_file()))
                {
                    return Some(json!({"kind":"unexpected-target-type"}));
                }
            }
            // Partial deletion can legitimately remove any fixed target. Still
            // inspect every existing ancestor; the one open will record ENOENT.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => {
                return Some(
                    json!({"kind":"ancestry-metadata-unknown","rawOsError":error.raw_os_error()}),
                )
            }
        }
    }
    None
}

fn encoded_size(value: &Value) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

fn bounded(mut report: Value) -> Value {
    if encoded_size(&report) <= JSON_LIMIT {
        return report;
    }
    report["truncated"] = json!(true);
    report["error"] = json!("observation-json-budget");
    let mut omitted = 0;
    while encoded_size(&report) > JSON_LIMIT {
        let removed = report["opens"].as_array_mut().and_then(Vec::pop).is_some();
        if !removed {
            // Token summaries are observations too; a bounded explicit failure
            // is preferable to unbounded metadata or a claimed complete report.
            return json!({"schema":1,"originalOsError":report["originalOsError"],
                "readOnly":true,"truncated":true,"error":"observation-json-budget",
                "openAttempts":report["openAttempts"],"omittedOpenResults":omitted,"opens":[]});
        }
        omitted += 1;
        report["omittedOpenResults"] = json!(omitted);
    }
    report
}

pub(super) fn observe(root: &Path, original_os_error: Option<i32>) -> Value {
    let started = Instant::now();
    let mut report = json!({
        "schema":1,"originalOsError":original_os_error,"readOnly":true,
        "deleteDispositionSet":false,"fileContentsRead":false,"enumerationPerformed":false,
        "aclOrTokenChanged":false,"pinsAlreadyReleasedRequired":true,
        "fileOpenLimit":OPEN_LIMIT,"jsonByteLimit":JSON_LIMIT,"openAttempts":0,
        "truncated":false,"omittedOpenResults":0,"opens":[]
    });
    if original_os_error != Some(ERROR_ACCESS_DENIED as i32) {
        report["error"] = json!("requires-original-os-error-5");
        return report;
    }
    if !root.is_absolute() {
        report["error"] = json!("owned-root-must-be-absolute");
        return report;
    }
    report["processToken"] = process_token();
    report["threadToken"] = thread_token();
    let targets = [
        (".", root.to_path_buf(), true),
        ("code", root.join("code"), true),
        (
            "code/mermaid-fixed-prototype.exe",
            root.join("code").join("mermaid-fixed-prototype.exe"),
            false,
        ),
        ("state", root.join("state"), true),
    ];
    let mut opens = Vec::new();
    let mut attempts = 0;
    for (relative, path, directory) in targets {
        let rejected = ancestry_guard(&path, directory);
        for (right_name, right) in [
            ("DELETE", DELETE),
            ("FILE_LIST_DIRECTORY", FILE_LIST_DIRECTORY),
        ] {
            if !directory && right == FILE_LIST_DIRECTORY {
                continue;
            }
            let flags = FILE_FLAG_OPEN_REPARSE_POINT
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS
                } else {
                    0
                };
            let mut record = json!({"relative":relative,"right":right_name,"access":right,"flags":flags,
                "share":FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,"creation":OPEN_EXISTING,
                "inheritable":false,"attempted":false,"opened":false,"rawOsError":null,"close":null});
            let call_started = Instant::now();
            record["startedAtMicros"] = json!(call_started
                .duration_since(started)
                .as_micros()
                .min(u64::MAX as u128) as u64);
            if let Some(reason) = &rejected {
                record["guardError"] = reason.clone();
            } else {
                let name = wide(path.as_os_str());
                attempts += 1;
                record["attempted"] = json!(true);
                let raw = unsafe {
                    CreateFileW(
                        name.as_ptr(),
                        right,
                        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                        null(),
                        OPEN_EXISTING,
                        flags,
                        null_mut(),
                    )
                };
                if raw == INVALID_HANDLE_VALUE {
                    let error = unsafe { GetLastError() };
                    record["rawOsError"] = json!(error);
                } else if raw.is_null() {
                    record["error"] = json!("invalid returned file handle");
                } else {
                    // Close before allocating or formatting the successful result.
                    let close = close_observed(unsafe { OwnedHandle::from_raw_handle(raw) });
                    record["opened"] = json!(true);
                    record["close"] = close;
                }
            }
            record["elapsedMicros"] =
                json!(call_started.elapsed().as_micros().min(u64::MAX as u128) as u64);
            opens.push(record);
        }
    }
    report["openAttempts"] = json!(attempts);
    report["opens"] = json!(opens);
    report["elapsedMicros"] = json!(started.elapsed().as_micros().min(u64::MAX as u128) as u64);
    bounded(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn security_descriptor(path: &Path) -> Vec<u8> {
        let path = wide(path.as_os_str());
        let sections =
            OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
        let mut needed = 0;
        let first =
            unsafe { GetFileSecurityW(path.as_ptr(), sections, null_mut(), 0, &mut needed) };
        let error = if first == 0 {
            unsafe { GetLastError() }
        } else {
            0
        };
        assert_eq!(error, ERROR_INSUFFICIENT_BUFFER);
        assert!(needed > 0 && needed <= 65536);
        let mut storage = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
        assert_ne!(
            unsafe {
                GetFileSecurityW(
                    path.as_ptr(),
                    sections,
                    storage.as_mut_ptr().cast(),
                    needed,
                    &mut needed,
                )
            },
            0
        );
        unsafe { std::slice::from_raw_parts(storage.as_ptr().cast::<u8>(), needed as usize) }
            .to_vec()
    }

    #[test]
    fn non_access_denied_does_not_observe_or_open() {
        for error in [None, Some(0), Some(2), Some(32), Some(33)] {
            let result = observe(Path::new("not-an-owned-root"), error);
            assert_eq!(result["originalOsError"], json!(error));
            assert_eq!(result["error"], "requires-original-os-error-5");
            assert_eq!(result["openAttempts"], 0);
            assert!(result["opens"].as_array().unwrap().is_empty());
            assert!(result.get("processToken").is_none());
        }
    }

    #[test]
    fn observation_preserves_owned_bytes_attributes_acls_and_releases_handles() {
        let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
        let root = temp.join(format!(
            "milkup-fixed-mermaid-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let cleanup = Cleanup(root.clone());
        fs::create_dir(root.join("code")).unwrap();
        fs::create_dir(root.join("state")).unwrap();
        let exe = root.join("code/mermaid-fixed-prototype.exe");
        let bytes = b"synthetic access-observation fixture; never executed";
        fs::write(&exe, bytes).unwrap();
        let targets = [&root, &root.join("code"), &exe, &root.join("state")];
        let before: Vec<_> = targets
            .iter()
            .map(|path| {
                (
                    fs::symlink_metadata(path).unwrap().file_attributes(),
                    security_descriptor(path),
                )
            })
            .collect();
        let report = observe(&root, Some(5));
        assert_eq!(report["originalOsError"], 5);
        assert_eq!(report["openAttempts"], OPEN_LIMIT);
        assert_eq!(report["truncated"], false);
        assert!(encoded_size(&report) <= JSON_LIMIT);
        let opens = report["opens"].as_array().unwrap();
        assert_eq!(opens.len(), OPEN_LIMIT);
        assert_eq!(
            opens
                .iter()
                .filter(|entry| entry["right"] == "DELETE")
                .count(),
            4
        );
        assert_eq!(
            opens
                .iter()
                .filter(|entry| entry["right"] == "FILE_LIST_DIRECTORY")
                .count(),
            3
        );
        for entry in opens {
            assert_eq!(entry["opened"], true, "{entry}");
            assert_eq!(entry["close"]["succeeded"], true);
            assert_eq!(entry["rawOsError"], Value::Null);
            assert_eq!(entry["inheritable"], false);
        }
        assert_eq!(fs::read(&exe).unwrap(), bytes);
        for (path, (attributes, acl)) in targets.iter().zip(before) {
            assert_eq!(
                fs::symlink_metadata(path).unwrap().file_attributes(),
                attributes
            );
            assert_eq!(security_descriptor(path), acl);
        }
        fs::remove_dir_all(&root).unwrap();
        assert!(!root.exists());
        drop(cleanup);
    }

    #[test]
    fn serialization_budget_is_explicit_and_fail_closed() {
        let report = bounded(
            json!({"originalOsError":5,"openAttempts":7,"opens":[{"error":"x".repeat(8192)}],
            "truncated":false,"omittedOpenResults":0}),
        );
        assert!(encoded_size(&report) <= JSON_LIMIT);
        assert_eq!(report["originalOsError"], 5);
        assert_eq!(report["truncated"], true);
        assert_eq!(report["omittedOpenResults"], 1);
        assert!(report.get("error").is_some());
    }
}

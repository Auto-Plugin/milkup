//! Explicit opt-in diagnostic evidence, never a plugin command or event.
//! Only fixed ownership/cleanup fields leave the native report. No source text,
//! renderer error, private path, credentials or browser request URI is logged.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[cfg(windows)]
pub(crate) fn enabled() -> bool {
    std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1")
}
#[cfg(windows)]
pub(crate) fn emit(record: &Value) {
    if !enabled() {
        return;
    }
    let mut record = record.clone();
    record["timestampUnixMs"] = json!(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default());
    if let Ok(line) = serde_json::to_string(&record) {
        // Refuse unexpected expansion; diagnostics cannot block or replace the
        // actual native result with their own error. One bounded line per phase.
        if line.len() <= 8192 {
            use std::io::Write;
            let _ = writeln!(
                std::io::stderr().lock(),
                "MILKUP_MERMAID_NATIVE_AUDIT {line}"
            );
        }
    }
}
pub(crate) fn started(request_id: &str, report: &Value) -> Value {
    json!({
        "phase":"started","requestId":request_id,"productPid":std::process::id(),
        "hostSid":report["hostToken"]["userSid"],
        "childSid":report["suspendedToken"]["userSid"],
        "browserSid":report["browserToken"]["userSid"],
        "hostPureStandard":report["hostToken"]["standardUserTokenEvidence"]==true,
        "appContainer":report["suspendedToken"]["isAppContainer"]==true,
        "zeroCapabilities":report["suspendedToken"]["capabilityCount"]==0,
        "browserAppContainer":report["browserToken"]["isAppContainer"]==true,
        "browserZeroCapabilities":report["browserToken"]["capabilityCount"]==0,
        "browserPid":report["ready"]["browserProcessId"],
        "browserInOwnedJob":report["browserProcessInOwnedJob"]==true
    })
}
pub(crate) fn finished(
    request_id: &str,
    report: &Value,
    png: &[u8],
    cancelled: bool,
    deadline_expired: bool,
) -> Value {
    let members: Vec<_> = report["preStopJob"]["members"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|member| member["pid"].as_u64())
        .take(16)
        .collect();
    json!({
        "phase":"finished", "requestId":request_id,"productPid":std::process::id(),
        "successful":report["success"]==true,
        "hostSid":report["hostToken"]["userSid"],
        "childSid":report["suspendedToken"]["userSid"],
        "browserSid":report["browserToken"]["userSid"],
        "hostPureStandard":report["hostToken"]["standardUserTokenEvidence"]==true,
        "appContainer":report["suspendedToken"]["isAppContainer"]==true,
        "zeroCapabilities":report["suspendedToken"]["capabilityCount"]==0,
        "browserAppContainer":report["browserToken"]["isAppContainer"]==true,
        "browserZeroCapabilities":report["browserToken"]["capabilityCount"]==0,
        "browserPid":report["ready"]["browserProcessId"],
        "browserInOwnedJob":report["browserProcessInOwnedJob"]==true,
        "ownedPidsBeforeStop":members,
        "ownedJobCreated":!report["preStopJob"].is_null(),
        "jobActiveAfterStop":report["jobActiveAfterStop"],
        "ipcThreadsCompleted":report["ipcThreadsCompleted"]==true,
        "profileCreated":report["profileCreated"]==true,
        "profileDeleted":report["profileDeletedAndFolderAbsent"]==true,
        "privateTreeRemoved":report["privateTreeRemoved"]==true,
        "cleanupUncertain":report["stopMatrixAfterThisCase"]==true,
        "cancelled":cancelled,"deadlineExpired":deadline_expired,
        "pngBytes":png.len(),
        "pngSha256":if png.is_empty(){None}else{Some(format!("{:x}",Sha256::digest(png)))},
        "osAllNetworkDenied":false
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_only_copy_closed_ownership_fields_never_source_paths_or_errors() {
        let input = json!({"success":true,"hostToken":{"userSid":"S-1-5-21-1-2-3-4","standardUserTokenEvidence":true},
            "rendererMetadata":{"source":"private document","engineMessage":"private error","requestUri":"https://private.invalid"},
            "privateRoot":"C:/private-user-path","stderr":"secret stderr","error":"private error",
            "preStopJob":{"members":[{"pid":42,"image":"C:/private-path","token":{"secret":"omitted"}}]},
            "jobActiveAfterStop":0,"ipcThreadsCompleted":true,"profileDeletedAndFolderAbsent":true,"privateTreeRemoved":true});
        let start = started("opaque-id", &input);
        assert_eq!(start["phase"], "started");
        assert_eq!(start["hostSid"], "S-1-5-21-1-2-3-4");
        let output = finished("opaque-id", &input, b"test png", false, false);
        let serialized = output.to_string();
        for excluded in [
            "private document",
            "private error",
            "private-user-path",
            "C:/private-path",
            "secret",
            "https://",
            "rendererMetadata",
            "stderr",
            "requestUri",
        ] {
            assert!(!serialized.contains(excluded), "{excluded}");
        }
        assert_eq!(output["ownedPidsBeforeStop"], json!([42]));
        assert_eq!(output["hostSid"], "S-1-5-21-1-2-3-4");
        assert_eq!(output["pngBytes"], 8);
        assert_eq!(output["pngSha256"].as_str().unwrap().len(), 64);
    }
}

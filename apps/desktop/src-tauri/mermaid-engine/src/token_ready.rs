//! Closed native proof frame. JavaScript readiness is checked separately and
//! cannot supply any token facts, process IDs, or authority observations here.
use serde_json::{json, Value};

pub(crate) const MAX_READY: usize = 4096;

/// Complete every fallible pre-publication operation before exposing verified
/// helper proof. The caller emits `started` immediately after this returns.
/// A cancellation while sampling the Job leaves the original Ready evidence
/// intact, but does not publish a readiness claim that never reached `started`.
pub(crate) fn prepare_started(
    report: &mut Value,
    control: &crate::Control,
    job_snapshot: impl FnOnce() -> crate::Result<Value>,
) -> crate::Result<()> {
    control.checkpoint()?;
    let job = job_snapshot()?;
    control.checkpoint()?;
    report["readyJob"] = job;
    report["helperSelfToken"] = report["ready"]["helperSelfToken"].clone();
    report["browserFromHelperToken"] = report["ready"]["browserFromHelperToken"].clone();
    report["protocolHandlesNonInheritable"] =
        report["ready"]["protocolHandlesNonInheritable"].clone();
    report["helperNativeProofVerified"] = json!(true);
    Ok(())
}

pub(crate) fn build(
    helper_pid: u32,
    browser_pid: u32,
    helper: &Value,
    browser: &Value,
    protocol_handles_non_inheritable: bool,
) -> Result<Value, &'static str> {
    let ready = json!({"phase":"ready","engine":"12.2.0","helperProcessId":helper_pid,
        "browserProcessId":browser_pid,"helperSelfToken":crate::token_policy::compact_sandbox_evidence(helper)?,
        "browserFromHelperToken":crate::token_policy::compact_sandbox_evidence(browser)?,
        "protocolHandlesNonInheritable":protocol_handles_non_inheritable});
    let user = helper["userSid"].as_str().ok_or("Missing helper SID")?;
    let session = helper["sessionId"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or("Missing helper session")?;
    let app_sid = helper["appContainerSid"]
        .as_str()
        .ok_or("Missing helper AppContainer")?;
    validate(&ready, helper_pid, user, session, app_sid)?;
    Ok(ready)
}

pub(crate) fn validate(
    ready: &Value,
    held_helper_pid: u32,
    user_sid: &str,
    session: u32,
    app_sid: &str,
) -> Result<u32, &'static str> {
    let fields = ready
        .as_object()
        .ok_or("Native ready proof must be an object")?;
    let expected = [
        "phase",
        "engine",
        "helperProcessId",
        "browserProcessId",
        "helperSelfToken",
        "browserFromHelperToken",
        "protocolHandlesNonInheritable",
    ];
    if fields.len() != expected.len()
        || expected.iter().any(|field| !fields.contains_key(*field))
        || ready["phase"] != "ready"
        || ready["engine"] != "12.2.0"
        || ready["protocolHandlesNonInheritable"] != true
        || held_helper_pid == 0
        || ready["helperProcessId"].as_u64() != Some(u64::from(held_helper_pid))
    {
        return Err("Native helper ready identity/fields mismatch");
    }
    let browser_pid = ready["browserProcessId"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .filter(|pid| *pid != 0 && *pid != held_helper_pid)
        .ok_or("Invalid native browser identity")?;
    for name in ["helperSelfToken", "browserFromHelperToken"] {
        let token = &ready[name];
        crate::token_policy::verify_sandbox(token, Some((user_sid, session, app_sid)))?;
        if &crate::token_policy::compact_sandbox_evidence(token)? != token {
            return Err("Native ready proof contains noncanonical token fields");
        }
    }
    let size = serde_json::to_vec(ready)
        .map_err(|_| "Cannot serialize closed native ready proof")?
        .len();
    if size > MAX_READY {
        return Err("Native ready proof exceeds the unchanged 4 KiB budget");
    }
    Ok(browser_pid)
}

#[cfg(test)]
pub(crate) fn maximum_sandbox() -> Value {
    let user = "S-1-5-21-4294967295-4294967295-4294967295-4294967295";
    json!({"userSid":user,"ownerSid":user,"tokenType":1,"sessionId":u32::MAX,
        "elevated":false,"elevationType":3,"integrityRid":4096,"uiAccess":false,
        "isAppContainer":true,"appContainerSid":"S-1-15-2-4294967295-4294967295-4294967295-4294967295-4294967295-4294967295-4294967295",
        "capabilityCount":0,"administratorsGroupPresentIncludingDenyOnly":true,"administratorsGroupAttributes":16,
        "privilegeCount":64,"hostDisallowedPrivilegeCount":0,"sandboxDisallowedPrivilegeCount":0,
        "seDebugPrivilege":{"present":false},"linkedAuthority":{
            "callerThreadTokenAbsent":true,"callerThreadQueryWin32Error":1008,
            "queryAttempted":true,"querySucceeded":true,"queryWin32Error":null,
            "targetTokenType":2,"targetImpersonationLevel":1,"targetQueryWin32Error":null}})
}

#[test]
fn two_maximum_native_proofs_fit_original_ready_budget_and_are_identity_bound() {
    let token = maximum_sandbox();
    let ready = build(u32::MAX - 1, u32::MAX, &token, &token, true).unwrap();
    assert!(build(u32::MAX - 1, u32::MAX, &token, &token, false).is_err());
    let bytes = serde_json::to_vec(&ready).unwrap();
    println!(
        "NATIVE_READY_BUDGET bytes={} limit={MAX_READY}",
        bytes.len()
    );
    assert!(bytes.len() <= MAX_READY);
    let check = |value: &Value| {
        validate(
            value,
            u32::MAX - 1,
            token["userSid"].as_str().unwrap(),
            u32::MAX,
            token["appContainerSid"].as_str().unwrap(),
        )
    };
    assert_eq!(check(&ready).unwrap(), u32::MAX);
    for field in [
        "helperProcessId",
        "browserProcessId",
        "helperSelfToken",
        "browserFromHelperToken",
        "protocolHandlesNonInheritable",
    ] {
        let mut invalid = ready.clone();
        invalid.as_object_mut().unwrap().remove(field);
        assert!(check(&invalid).is_err());
    }
    let mut invalid = ready.clone();
    invalid["protocolHandlesNonInheritable"] = json!("true");
    assert!(check(&invalid).is_err());
    let mut invalid = ready.clone();
    invalid["protocolHandlesNonInheritable"] = json!(false);
    assert!(check(&invalid).is_err());
    let mut invalid = ready.clone();
    invalid["helperSelfToken"]["source"] = json!("untrusted");
    assert!(check(&invalid).is_err());
    let mut invalid = ready.clone();
    invalid["browserFromHelperToken"]["linkedAuthority"]["targetImpersonationLevel"] = json!(2);
    assert!(check(&invalid).is_err());
    let mut invalid = ready.clone();
    invalid["helperProcessId"] = json!(123);
    assert!(check(&invalid).is_err());
    let mut invalid = ready.clone();
    invalid["browserProcessId"] = json!(u32::MAX - 1);
    assert!(check(&invalid).is_err());
    let mut invalid = ready.clone();
    invalid["browserFromHelperToken"]["appContainerSid"] = json!("S-1-15-2-1-2-3-4-5-6-7");
    assert!(check(&invalid).is_err());
    let mut invalid = ready;
    invalid["javascriptTokenProof"] = json!(true);
    assert!(check(&invalid).is_err());
}

#[test]
fn cancellation_during_job_sampling_never_publishes_unstarted_helper_proof() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::{Duration, Instant};
    let token = maximum_sandbox();
    let ready = build(100, 200, &token, &token, true).unwrap();
    let original = json!({"ready":ready});
    let mut report = original.clone();
    let control = crate::Control {
        cancelled: Arc::new(AtomicBool::new(false)),
        deadline: Instant::now() + Duration::from_secs(5),
        unhealthy: Arc::new(AtomicBool::new(false)),
    };
    let result = prepare_started(&mut report, &control, || {
        control.cancelled.store(true, Ordering::Release);
        Ok(json!({"active":2}))
    });
    assert!(result.is_err());
    assert_eq!(
        report, original,
        "Keep original ready facts without claiming a started proof"
    );
    control.cancelled.store(false, Ordering::Release);
    assert!(prepare_started(&mut report, &control, || Err(
        "synthetic Job sample failure".into()
    ))
    .is_err());
    assert_eq!(report, original);
    prepare_started(&mut report, &control, || Ok(json!({"active":2}))).unwrap();
    assert_eq!(report["helperNativeProofVerified"], true);
    assert_eq!(report["protocolHandlesNonInheritable"], true);
    assert_eq!(report["helperSelfToken"], ready["helperSelfToken"]);
    assert_eq!(
        report["browserFromHelperToken"],
        ready["browserFromHelperToken"]
    );
}

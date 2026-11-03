//! Pure parsing checks for the opt-in native token tests; absent from products.
use serde_json::Value;

pub(crate) const OUTPUT_BUDGET: usize = 65_536;
pub(crate) const CHILD_MARKER: &str = "MILKUP_MERMAID_TOKEN_SELF_DIAGNOSTIC ";

pub(crate) fn privilege_array_fits(
    count: usize,
    returned: usize,
    offset: usize,
    entry: usize,
) -> bool {
    returned >= 4
        && count <= 64
        && count
            .checked_mul(entry)
            .and_then(|length| offset.checked_add(length))
            .is_some_and(|end| end <= returned)
}
pub(crate) fn canonical_privilege_name(name: &str) -> bool {
    name.len() <= 128
        && name.len() > "SePrivilege".len()
        && name.starts_with("Se")
        && name.ends_with("Privilege")
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric())
}
pub(crate) fn object_basic_complete(status: i32, returned: u32) -> bool {
    status >= 0 && returned == 56
}
pub(crate) fn parse_child_record(bytes: &[u8]) -> Result<Value, &'static str> {
    if bytes.len() > OUTPUT_BUDGET {
        return Err("Child output exceeds budget");
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "Child output is not UTF-8")?;
    let records: Vec<_> = text
        .lines()
        .filter_map(|line| line.strip_prefix(CHILD_MARKER))
        .collect();
    if records.len() != 1 {
        return Err("Exactly one complete self-probe record is required");
    }
    let value: Value = serde_json::from_str(records[0]).map_err(|_| "Malformed self-probe JSON")?;
    let object = value
        .as_object()
        .ok_or("Self-probe record is not an object")?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "caller"
                | "token"
                | "linkedToken"
                | "complete"
                | "requestedSourceTokenAccess"
                | "failedStage"
                | "observerPid"
                | "subjectPid"
                | "callerThreadToken"
        )
    }) || value["caller"] != "appcontainer-self"
        || !value["complete"].is_boolean()
    {
        return Err("Unexpected self-probe record fields");
    }
    if value["complete"] == true
        && (!value["token"].is_object()
            || !value["linkedToken"].is_object()
            || value["requestedSourceTokenAccess"] != 8
            || value.get("failedStage").is_some())
    {
        return Err("Missing complete self-probe fields");
    }
    Ok(value)
}

#[test]
fn privilege_array_uses_actual_bytes_instead_of_rounded_storage() {
    assert!(privilege_array_fits(0, 4, 4, 12));
    assert!(!privilege_array_fits(0, 3, 4, 12));
    assert!(privilege_array_fits(1, 16, 4, 12));
    assert!(!privilege_array_fits(1, 15, 4, 12));
    assert!(privilege_array_fits(64, 772, 4, 12));
    assert!(!privilege_array_fits(64, 771, 4, 12));
    assert!(!privilege_array_fits(65, 784, 4, 12));
    assert!(!privilege_array_fits(1, usize::MAX, usize::MAX, 12));
    assert!(!privilege_array_fits(64, usize::MAX, 4, usize::MAX));
}
#[test]
fn privilege_names_are_bounded_canonical_identifiers() {
    assert!(canonical_privilege_name("SeIncreaseWorkingSetPrivilege"));
    for name in [
        "SePrivilege",
        "SeDebugPrivilege\n",
        "SeDebugPrivilege\0",
        "Se调试Privilege",
        "Se DebugPrivilege",
    ] {
        assert!(!canonical_privilege_name(name), "{name:?}");
    }
    assert!(!canonical_privilege_name(&format!(
        "Se{}Privilege",
        "A".repeat(128)
    )));
}
#[test]
fn object_query_requires_success_and_exact_documented_length() {
    assert!(object_basic_complete(0, 56));
    assert!(object_basic_complete(1, 56));
    for length in [0, 55, 57, u32::MAX] {
        assert!(!object_basic_complete(0, length));
    }
    assert!(!object_basic_complete(-1, 56));
}
#[test]
fn child_record_requires_single_closed_bounded_marker() {
    let record = format!("{CHILD_MARKER}{{\"caller\":\"appcontainer-self\",\"complete\":false,\"failedStage\":{{\"stage\":\"test\"}}}}\n");
    assert!(parse_child_record(record.as_bytes()).is_ok());
    assert!(parse_child_record(format!("{record}{record}").as_bytes()).is_err());
    assert!(parse_child_record(b"no marker").is_err());
    assert!(parse_child_record(&[255]).is_err());
    assert!(parse_child_record(&vec![b'a'; OUTPUT_BUDGET + 1]).is_err());
    for json in [
        "{}",
        "[]",
        "{\"caller\":\"appcontainer-self\",\"complete\":1}",
        "{\"caller\":\"appcontainer-self\",\"complete\":true}",
        "{\"caller\":\"parent-suspended-child\",\"complete\":false}",
        "{\"caller\":\"appcontainer-self\",\"complete\":false,\"source\":\"forbidden\"}",
    ] {
        assert!(parse_child_record(format!("{CHILD_MARKER}{json}\n").as_bytes()).is_err());
    }
}

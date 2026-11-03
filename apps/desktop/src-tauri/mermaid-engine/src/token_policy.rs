//! Private Windows launch policy. Account membership is not execution authority:
//! a UAC limited token may retain Administrators only as an irreversible deny SID.
//! These checks never select a linked token, change privileges, or request elevation.
use serde::Deserialize;
use serde_json::{json, Value};

const PRIMARY: u32 = 1;
const DEFAULT: u32 = 1;
const LIMITED: u32 = 3;
const MEDIUM: u32 = 0x2000;
const LOW: u32 = 0x1000;
const DENY_ONLY: u32 = 0x10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HostClass {
    PureStandard,
    FilteredAdmin,
}
impl HostClass {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::PureStandard => "pure-standard",
            Self::FilteredAdmin => "filtered-admin",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Facts {
    user_sid: String,
    owner_sid: String,
    token_type: u32,
    session_id: u32,
    elevated: bool,
    elevation_type: u32,
    integrity_rid: u32,
    ui_access: bool,
    is_app_container: bool,
    app_container_sid: Option<String>,
    capability_count: u32,
    administrators_group_present_including_deny_only: bool,
    administrators_group_attributes: Option<u32>,
    privilege_count: u32,
    host_disallowed_privilege_count: u32,
    sandbox_disallowed_privilege_count: u32,
    se_debug_privilege: DebugPrivilege,
}
#[derive(Deserialize)]
struct DebugPrivilege {
    present: bool,
}
impl Facts {
    fn read(value: &Value) -> Result<Self, &'static str> {
        // Option-valued observations must be explicitly null, not omitted.
        for key in ["appContainerSid", "administratorsGroupAttributes"] {
            if value.get(key).is_none() {
                return Err("Incomplete Windows token evidence");
            }
        }
        serde_json::from_value(value.clone()).map_err(|_| "Incomplete Windows token evidence")
    }
    fn no_admin_authority(&self) -> bool {
        match self.administrators_group_attributes {
            None => !self.administrators_group_present_including_deny_only,
            Some(flags) => {
                self.administrators_group_present_including_deny_only && flags == DENY_ONLY
            }
        }
    }
    fn identity_is_ordinary(&self) -> bool {
        self.token_type == PRIMARY
            && self.session_id > 0
            && !self.elevated
            && !self.ui_access
            && self.privilege_count <= 64
            && self.host_disallowed_privilege_count <= self.privilege_count
            && self.sandbox_disallowed_privilege_count <= self.privilege_count
            && !self.se_debug_privilege.present
            && self.user_sid == self.owner_sid
            && crate::cleanup::concrete_user_sid(&self.user_sid)
            && self.no_admin_authority()
    }
}

pub(crate) fn classify_host(
    value: &Value,
    process_session: u32,
) -> Result<HostClass, &'static str> {
    let token = Facts::read(value)?;
    if token.elevated || token.elevation_type == 2 || token.integrity_rid > MEDIUM {
        return Err("Elevated Mermaid host is unsupported; start Milkup normally without administrator elevation");
    }
    if !token.identity_is_ordinary()
        || token.session_id != process_session
        || token.integrity_rid != MEDIUM
        || token.is_app_container
        || token.app_container_sid.is_some()
        || token.capability_count != 0
        || token.host_disallowed_privilege_count != 0
    {
        return Err("Windows host token does not meet the non-elevated Mermaid launch policy");
    }
    match (
        token.elevation_type,
        token.administrators_group_present_including_deny_only,
    ) {
        (DEFAULT, false) => Ok(HostClass::PureStandard),
        (LIMITED, true) => Ok(HostClass::FilteredAdmin),
        _ => Err("Unsupported Windows token class; only a standard or UAC-filtered normal launch is supported"),
    }
}

/// Also used in the fixed child before COM or WebView2 initialization. The
/// coordinator additionally supplies the expected fresh profile/SID/session.
pub(crate) fn verify_sandbox(
    value: &Value,
    expected: Option<(&str, u32, &str)>,
) -> Result<(), &'static str> {
    let token = Facts::read(value)?;
    if !token.identity_is_ordinary()
        // Default explicitly has no linked token. Host Limited is supported;
        // an unverified linked-token association inside the sandbox is not.
        || token.elevation_type != DEFAULT
        || token.integrity_rid > LOW
        || !token.is_app_container
        || token.capability_count != 0
        || token.sandbox_disallowed_privilege_count != 0
        || token.host_disallowed_privilege_count != 0
        || !token
            .app_container_sid
            .as_deref()
            .is_some_and(valid_app_sid)
    {
        return Err(
            "Mermaid child requires a low-integrity, non-privileged zero-capability AppContainer",
        );
    }
    if let Some((user_sid, session, app_sid)) = expected {
        if token.user_sid != user_sid
            || token.session_id != session
            || token.app_container_sid.as_deref() != Some(app_sid)
        {
            return Err("Mermaid child must retain the expected login, session and fresh AppContainer identity");
        }
    }
    Ok(())
}

fn valid_app_sid(sid: &str) -> bool {
    sid.strip_prefix("S-1-15-2-").is_some_and(|suffix| {
        let parts: Vec<_> = suffix.split('-').collect();
        parts.len() == 7
            && parts.iter().all(|part| {
                !part.is_empty() && part.parse::<u32>().is_ok_and(|n| n.to_string() == *part)
            })
    })
}

pub(crate) fn audit_app_sid(value: &Value) -> Value {
    value
        .as_str()
        .filter(|sid| valid_app_sid(sid))
        .map_or(Value::Null, |sid| json!(sid))
}

/// Closed facts only: no arbitrary privilege names, paths, source or caller text.
pub(crate) fn audit_evidence(value: &Value) -> Value {
    let Ok(token) = Facts::read(value) else {
        return Value::Null;
    };
    if token.privilege_count > 64
        || token.host_disallowed_privilege_count > token.privilege_count
        || token.sandbox_disallowed_privilege_count > token.privilege_count
        || !crate::cleanup::concrete_user_sid(&token.user_sid)
    {
        return Value::Null;
    }
    json!({"tokenType":token.token_type,"sessionId":token.session_id,
        "elevated":token.elevated,"elevationType":token.elevation_type,
        "integrityRid":token.integrity_rid,"uiAccess":token.ui_access,
        "administratorsGroupPresentIncludingDenyOnly":token.administrators_group_present_including_deny_only,
        "administratorsGroupAttributes":token.administrators_group_attributes,
        "privilegeCount":token.privilege_count,
        "hostDisallowedPrivilegeCount":token.host_disallowed_privilege_count,
        "sandboxDisallowedPrivilegeCount":token.sandbox_disallowed_privilege_count,
        "seDebugPrivilegePresent":token.se_debug_privilege.present,
        "ownerIsUser":token.owner_sid == token.user_sid})
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn standard() -> Value {
        json!({"userSid":"S-1-5-21-1-2-3-1001","ownerSid":"S-1-5-21-1-2-3-1001",
            "tokenType":1,"sessionId":2,"elevated":false,"elevationType":1,
            "integrityRid":8192,"uiAccess":false,"isAppContainer":false,
            "appContainerSid":null,"capabilityCount":0,
            "administratorsGroupPresentIncludingDenyOnly":false,"administratorsGroupAttributes":null,
            "privilegeCount":5,"hostDisallowedPrivilegeCount":0,"sandboxDisallowedPrivilegeCount":4,
            "seDebugPrivilege":{"present":false}})
    }
    fn filtered() -> Value {
        let mut value = standard();
        value["elevationType"] = json!(3);
        value["administratorsGroupPresentIncludingDenyOnly"] = json!(true);
        value["administratorsGroupAttributes"] = json!(16);
        value
    }
    fn sandbox() -> Value {
        let mut value = filtered();
        value["elevationType"] = json!(1);
        value["isAppContainer"] = json!(true);
        value["integrityRid"] = json!(4096);
        value["appContainerSid"] = json!("S-1-15-2-1-2-3-4-5-6-7");
        value["privilegeCount"] = json!(1);
        value["sandboxDisallowedPrivilegeCount"] = json!(0);
        value
    }
    #[test]
    fn classifies_real_authority_without_relabeling_filtered_as_pure_standard() {
        assert_eq!(classify_host(&standard(), 2), Ok(HostClass::PureStandard));
        assert_eq!(classify_host(&filtered(), 2), Ok(HostClass::FilteredAdmin));
        assert_ne!(
            HostClass::PureStandard.name(),
            HostClass::FilteredAdmin.name()
        );
    }
    #[test]
    fn deny_only_cannot_hide_enabled_default_enabled_or_owner_bits() {
        for flags in [0, 2, 4, 8, 16 | 1, 16 | 2, 16 | 4, 16 | 8, 16 | 0x8000] {
            let mut token = filtered();
            token["administratorsGroupAttributes"] = json!(flags);
            assert!(classify_host(&token, 2).is_err(), "flags {flags}");
        }
    }
    #[test]
    fn full_no_uac_unknown_uiaccess_privileged_and_cross_session_hosts_are_rejected() {
        for (key, value) in [
            ("elevated", json!(true)),
            ("elevationType", json!(2)),
            ("elevationType", json!(0)),
            ("elevationType", json!(1)),
            ("integrityRid", json!(12288)),
            ("integrityRid", json!(4096)),
            ("tokenType", json!(2)),
            ("sessionId", json!(3)),
            ("sessionId", json!(0)),
            ("uiAccess", json!(true)),
            ("hostDisallowedPrivilegeCount", json!(1)),
            ("seDebugPrivilege", json!({"present":true})),
            ("ownerSid", json!("S-1-5-32-544")),
            ("isAppContainer", json!(true)),
            ("capabilityCount", json!(1)),
            ("privilegeCount", json!(65)),
        ] {
            let mut token = filtered();
            token[key] = value;
            assert!(classify_host(&token, 2).is_err(), "field {key}");
        }
        let mut inconsistent = standard();
        inconsistent["administratorsGroupAttributes"] = json!(16);
        assert!(classify_host(&inconsistent, 2).is_err());
        let mut service = standard();
        service["sessionId"] = json!(0);
        assert!(classify_host(&service, 0).is_err());
    }
    #[test]
    fn missing_or_mistyped_token_evidence_never_defaults_to_safe() {
        for key in [
            "uiAccess",
            "sessionId",
            "tokenType",
            "hostDisallowedPrivilegeCount",
            "sandboxDisallowedPrivilegeCount",
            "seDebugPrivilege",
            "ownerSid",
            "appContainerSid",
            "administratorsGroupAttributes",
        ] {
            let mut token = standard();
            token.as_object_mut().unwrap().remove(key);
            assert!(classify_host(&token, 2).is_err(), "missing {key}");
            let mut token = standard();
            token[key] = json!("false");
            assert!(classify_host(&token, 2).is_err(), "type {key}");
        }
    }
    #[test]
    fn sandbox_requires_low_unprivileged_identity_and_exact_fresh_profile() {
        let expected = Some(("S-1-5-21-1-2-3-1001", 2, "S-1-15-2-1-2-3-4-5-6-7"));
        assert!(verify_sandbox(&sandbox(), expected).is_ok());
        for (key, value) in [
            ("integrityRid", json!(8192)),
            ("elevated", json!(true)),
            ("elevationType", json!(2)),
            ("elevationType", json!(3)),
            ("uiAccess", json!(true)),
            ("tokenType", json!(2)),
            ("sessionId", json!(3)),
            ("sessionId", json!(0)),
            ("sandboxDisallowedPrivilegeCount", json!(1)),
            ("capabilityCount", json!(1)),
            ("isAppContainer", json!(false)),
            ("administratorsGroupAttributes", json!(20)),
            ("appContainerSid", json!("S-1-15-2-8-8-8-8-8-8-8")),
            ("userSid", json!("S-1-5-21-1-2-3-1002")),
        ] {
            let mut token = sandbox();
            token[key] = value;
            assert!(verify_sandbox(&token, expected).is_err(), "field {key}");
        }
        let mut service = sandbox();
        service["sessionId"] = json!(0);
        assert!(verify_sandbox(&service, None).is_err());
    }
    #[test]
    fn closed_audit_facts_do_not_relabel_or_leak_unknown_fields() {
        let mut token = filtered();
        token["source"] = json!("private diagram");
        let evidence = audit_evidence(&token);
        assert_eq!(evidence["elevationType"], 3);
        assert_eq!(evidence["administratorsGroupAttributes"], 16);
        assert!(evidence.get("source").is_none());
        assert!(evidence.get("userSid").is_none());
        token["privilegeCount"] = json!(65);
        assert!(audit_evidence(&token).is_null());
        for sid in [
            "S-1-15-2-1",
            "S-1-15-2-1-2-3-4-5-6-7/private",
            "S-1-15-2-01-2-3-4-5-6-7",
        ] {
            assert!(audit_app_sid(&json!(sid)).is_null());
        }
        assert_eq!(
            audit_app_sid(&sandbox()["appContainerSid"]),
            sandbox()["appContainerSid"]
        );
    }
}

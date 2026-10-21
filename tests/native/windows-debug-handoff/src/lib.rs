//! Decision gates shared by the real Windows probe and portable static tests.
//! These tests do not establish Windows API behavior or non-elevated execution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Instance {
    pub pid: u32,
    pub created: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Image {
    pub volume: u32,
    pub index: u64,
    pub bytes: u64,
    pub sha256: [u8; 32],
}

pub fn bind(
    expected: &Instance,
    actual: &Instance,
    wanted: &Image,
    event: Option<&Image>,
) -> Result<(), &'static str> {
    if expected != actual {
        return Err("process-instance-mismatch");
    }
    let event = event.ok_or("null-image-handle")?;
    if event != wanted {
        return Err("image-binding-mismatch");
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenFacts {
    pub elevated: bool,
    pub elevation_type: i32,
    pub integrity_rid: u32,
    pub administrators_present: bool,
    pub administrators_enabled: bool,
    pub administrators_deny_only: bool,
    pub debug_privilege_present: bool,
    pub debug_privilege_enabled: bool,
}
impl TokenFacts {
    pub fn admit(&self) -> Result<(), &'static str> {
        if self.debug_privilege_enabled {
            Err("SeDebugPrivilege-already-enabled-stop")
        } else {
            Ok(())
        }
    }
    pub fn ordinary_medium_context(&self) -> bool {
        !self.elevated
            && self.elevation_type == 1
            && self.integrity_rid == 8192
            && !self.administrators_present
            && !self.debug_privilege_enabled
    }
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({"elevated":self.elevated,"elevation_type":self.elevation_type,
            "integrity_rid":self.integrity_rid,"administrators_present":self.administrators_present,
            "administrators_enabled":self.administrators_enabled,"administrators_deny_only":self.administrators_deny_only,
            "SeDebugPrivilege_present":self.debug_privilege_present,"SeDebugPrivilege_enabled":self.debug_privilege_enabled,
            "ordinary_medium_context":self.ordinary_medium_context()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binding_rejects_absent_handle_reused_pid_and_wrong_file_or_digest() {
        let instance = Instance {
            pid: 71,
            created: 1234,
        };
        let image = Image {
            volume: 2,
            index: 3,
            bytes: 100,
            sha256: [7; 32],
        };
        assert!(bind(&instance, &instance, &image, Some(&image)).is_ok());
        assert!(bind(&instance, &instance, &image, None).is_err());
        for changed in [
            Instance {
                pid: 72,
                ..instance.clone()
            },
            Instance {
                created: 1235,
                ..instance.clone()
            },
        ] {
            assert!(bind(&instance, &changed, &image, Some(&image)).is_err());
        }
        for changed in [
            Image {
                volume: 4,
                ..image.clone()
            },
            Image {
                index: 4,
                ..image.clone()
            },
            Image {
                bytes: 101,
                ..image.clone()
            },
            Image {
                sha256: [8; 32],
                ..image.clone()
            },
        ] {
            assert!(bind(&instance, &instance, &image, Some(&changed)).is_err());
        }
    }
    #[test]
    fn administrator_or_filtered_admin_success_is_not_ordinary_user_evidence() {
        let ordinary = TokenFacts {
            elevated: false,
            elevation_type: 1,
            integrity_rid: 8192,
            administrators_present: false,
            administrators_enabled: false,
            administrators_deny_only: false,
            debug_privilege_present: false,
            debug_privilege_enabled: false,
        };
        assert!(ordinary.ordinary_medium_context());
        for changed in [
            TokenFacts {
                elevated: true,
                ..ordinary.clone()
            },
            TokenFacts {
                integrity_rid: 12288,
                ..ordinary.clone()
            },
            TokenFacts {
                administrators_present: true,
                administrators_deny_only: true,
                elevation_type: 3,
                ..ordinary.clone()
            },
        ] {
            assert!(!changed.ordinary_medium_context());
        }
        assert!(TokenFacts {
            debug_privilege_enabled: true,
            ..ordinary
        }
        .admit()
        .is_err());
    }
}

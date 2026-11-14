//! ACLs for newly created, coordinator-owned directories only. No subprocess,
//! privilege adjustment, owner replacement, recursive grant or path-based setter.
use super::{check, owned, sid_text, wide, Result};
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    mem::size_of,
    os::windows::io::AsRawHandle,
    path::Path,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::SystemServices::{
        ACCESS_ALLOWED_ACE_TYPE, SYSTEM_MANDATORY_LABEL_ACE_TYPE,
        SYSTEM_MANDATORY_LABEL_NO_WRITE_UP,
    },
};

const INHERIT: u8 = (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8;
const READ_EXECUTE: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
const SYSTEM: &str = "S-1-5-18";
const LOW: &str = "S-1-16-4096";

#[derive(Clone, Copy)]
enum Scope {
    Root,
    State,
}
impl Scope {
    fn state(self) -> bool {
        matches!(self, Self::State)
    }
    fn app_mask(self) -> u32 {
        if self.state() {
            FILE_ALL_ACCESS
        } else {
            READ_EXECUTE
        }
    }
}

struct Descriptor(PSECURITY_DESCRIPTOR);
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}
impl Descriptor {
    fn parse(sddl: &str) -> Result<Self> {
        let text = wide(OsStr::new(sddl));
        let mut raw = null_mut();
        check(unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                text.as_ptr(),
                SDDL_REVISION_1,
                &mut raw,
                null_mut(),
            )
        })?;
        Ok(Self(raw))
    }
    fn read(handle: HANDLE, label: bool) -> Result<Self> {
        let mut raw = null_mut();
        win32(unsafe {
            GetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION
                    | DACL_SECURITY_INFORMATION
                    | if label { LABEL_SECURITY_INFORMATION } else { 0 },
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                &mut raw,
            )
        })?;
        Ok(Self(raw))
    }
    fn owner(&self) -> Result<String> {
        let mut sid = null_mut();
        let mut defaulted = 0;
        check(unsafe { GetSecurityDescriptorOwner(self.0, &mut sid, &mut defaulted) })?;
        if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
            return Err("Private directory owner SID is absent or invalid".into());
        }
        sid_text(sid)
    }
    fn acl(&self, label: bool) -> Result<*mut ACL> {
        let mut present = 0;
        let mut defaulted = 0;
        let mut acl = null_mut();
        check(unsafe {
            if label {
                GetSecurityDescriptorSacl(self.0, &mut present, &mut acl, &mut defaulted)
            } else {
                GetSecurityDescriptorDacl(self.0, &mut present, &mut acl, &mut defaulted)
            }
        })?;
        if present == 0 || acl.is_null() || unsafe { IsValidAcl(acl) } == 0 {
            return Err("Private directory ACL is absent, NULL or invalid".into());
        }
        Ok(acl)
    }
}
fn win32(error: WIN32_ERROR) -> Result<()> {
    if error != ERROR_SUCCESS {
        return Err(std::io::Error::from_raw_os_error(error as i32).into());
    }
    Ok(())
}

fn policy(owner: &str, app: &str, scope: Scope) -> Result<Descriptor> {
    // Both strings originate in observed Windows tokens/profile APIs, and are
    // validated before SDDL interpolation. No caller/plugin-provided ACEs exist.
    if !crate::cleanup::concrete_user_sid(owner)
        || crate::token_policy::audit_app_sid(&json!(app)).is_null()
    {
        return Err("Private ACL requires exact concrete user and AppContainer SIDs".into());
    }
    let label = if scope.state() {
        "S:(ML;OICI;NW;;;LW)"
    } else {
        ""
    };
    let descriptor = Descriptor::parse(&format!(
        "O:{owner}D:P(A;OICI;FA;;;{owner})(A;OICI;FA;;;SY)(A;OICI;0x{:x};;;{app}){label}",
        scope.app_mask()
    ))?;
    verify(&descriptor, owner, app, scope)?;
    Ok(descriptor)
}

#[derive(Debug, PartialEq)]
struct Ace {
    kind: u8,
    flags: u8,
    mask: u32,
    sid: String,
}

fn entries(acl: *const ACL, count: u32) -> Result<Vec<Ace>> {
    let mut info = ACL_SIZE_INFORMATION::default();
    check(unsafe {
        GetAclInformation(
            acl,
            (&mut info as *mut ACL_SIZE_INFORMATION).cast(),
            size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    })?;
    if info.AceCount != count {
        return Err("Private ACL has an unexpected ACE count".into());
    }
    let start = acl as usize;
    let end = start
        .checked_add(info.AclBytesInUse as usize)
        .ok_or("ACL size overflow")?;
    let mut result = Vec::new();
    for index in 0..count {
        let mut raw = null_mut();
        check(unsafe { GetAce(acl, index, &mut raw) })?;
        let address = raw as usize;
        if address < start + size_of::<ACL>()
            || address
                .checked_add(size_of::<ACE_HEADER>())
                .is_none_or(|n| n > end)
        {
            return Err("Private ACL ACE header is out of bounds".into());
        }
        let header = unsafe { raw.cast::<ACE_HEADER>().read_unaligned() };
        // These two allowed layouts both consist of ACE_HEADER, DWORD mask, SID.
        if header.AceType != ACCESS_ALLOWED_ACE_TYPE as u8
            && header.AceType != SYSTEM_MANDATORY_LABEL_ACE_TYPE as u8
        {
            return Err("Private ACL contains an unexpected ACE type".into());
        }
        let ace_end = address
            .checked_add(header.AceSize as usize)
            .filter(|n| *n <= end)
            .ok_or("Private ACL ACE exceeds its buffer")?;
        let sid_offset = size_of::<ACE_HEADER>() + size_of::<u32>();
        if (header.AceSize as usize) < sid_offset + 8 {
            return Err("Private ACL ACE lacks a complete SID header".into());
        }
        let sid = unsafe { raw.cast::<u8>().add(sid_offset) };
        let subauthorities = unsafe { *sid.add(1) } as usize;
        if (sid as usize).checked_add(8 + 4 * subauthorities) != Some(ace_end)
            || unsafe { IsValidSid(sid.cast()) } == 0
        {
            return Err("Private ACL SID length or revision is invalid".into());
        }
        result.push(Ace {
            kind: header.AceType,
            flags: header.AceFlags,
            mask: unsafe {
                raw.cast::<u8>()
                    .add(size_of::<ACE_HEADER>())
                    .cast::<u32>()
                    .read_unaligned()
            },
            sid: sid_text(sid.cast())?,
        });
    }
    Ok(result)
}

fn verify(descriptor: &Descriptor, owner: &str, app: &str, scope: Scope) -> Result<()> {
    if descriptor.owner()? != owner {
        return Err("Private directory owner changed or differs from current user".into());
    }
    let mut control = 0;
    let mut revision = 0;
    check(unsafe { GetSecurityDescriptorControl(descriptor.0, &mut control, &mut revision) })?;
    if control & SE_DACL_PROTECTED == 0 {
        return Err("Private DACL must reject inherited permissions".into());
    }
    let actual = entries(descriptor.acl(false)?, 3)?;
    for (sid, mask) in [
        (owner, FILE_ALL_ACCESS),
        (SYSTEM, FILE_ALL_ACCESS),
        (app, scope.app_mask()),
    ] {
        if actual
            .iter()
            .filter(|ace| {
                ace.kind == ACCESS_ALLOWED_ACE_TYPE as u8
                    && ace.flags == INHERIT
                    && ace.mask == mask
                    && ace.sid == sid
            })
            .count()
            != 1
        {
            return Err(
                "Private DACL rights, SID, ACE type or inheritance flags differ from policy".into(),
            );
        }
    }
    if scope.state() {
        let actual = entries(descriptor.acl(true)?, 1)?;
        if actual[0]
            != (Ace {
                kind: SYSTEM_MANDATORY_LABEL_ACE_TYPE as u8,
                flags: INHERIT,
                mask: SYSTEM_MANDATORY_LABEL_NO_WRITE_UP,
                sid: LOW.into(),
            })
        {
            return Err(
                "Private state requires exactly the inheritable Low no-write-up label".into(),
            );
        }
    }
    Ok(())
}

fn apply(path: &Path, owner: &str, app: &str, scope: Scope) -> Result<Value> {
    let desired = policy(owner, app, scope)?;
    let name = wide(path.as_os_str());
    // No DELETE sharing: the selected directory cannot be renamed/replaced
    // between attribute/owner checks, mutation and readback of this same handle.
    // OPEN_REPARSE_POINT means a link itself is checked and rejected, not followed.
    let handle = unsafe {
        owned(CreateFileW(
            name.as_ptr(),
            READ_CONTROL
                | WRITE_DAC
                | FILE_READ_ATTRIBUTES
                | if scope.state() { WRITE_OWNER } else { 0 },
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        ))?
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    check(unsafe { GetFileInformationByHandle(handle.as_raw_handle(), &mut info) })?;
    if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err("Private ACL target must be an owned non-reparse directory".into());
    }
    if Descriptor::read(handle.as_raw_handle(), false)?.owner()? != owner {
        return Err("Refusing to change ACL of a directory not owned by the observed user".into());
    }
    // The only production callers just used create_dir (CREATE_NEW) for this
    // unique request. Reject populated directories as an additional invariant:
    // SetSecurityInfo can propagate inheritable ACEs to existing descendants.
    if std::fs::read_dir(path)?.next().transpose()?.is_some() {
        return Err("Private ACL may only be initialized before creating descendants".into());
    }
    let label = if scope.state() {
        desired.acl(true)?
    } else {
        null_mut()
    };
    // LABEL_SECURITY_INFORMATION needs WRITE_OWNER, not SeSecurityPrivilege.
    // It replaces only the label; no audit SACL or existing object's owner is set.
    win32(unsafe {
        SetSecurityInfo(
            handle.as_raw_handle(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION
                | if scope.state() {
                    LABEL_SECURITY_INFORMATION
                } else {
                    0
                },
            null_mut(),
            null_mut(),
            desired.acl(false)?,
            label,
        )
    })?;
    verify(
        &Descriptor::read(handle.as_raw_handle(), scope.state())?,
        owner,
        app,
        scope,
    )?;
    Ok(
        json!({"path":path,"api":"SetSecurityInfo/GetSecurityInfo","scope":if scope.state() {"state"} else {"root"},
        "ownerVerified":true,"daclProtected":true,"exactAllowAceCount":3,"inheritanceFlags":INHERIT,
        "userMask":FILE_ALL_ACCESS,"systemMask":FILE_ALL_ACCESS,"appContainerMask":scope.app_mask(),
        "lowNoWriteUpLabelVerified":scope.state(),"sameHandleReadback":true,"externalProcessStarted":false}),
    )
}

pub(super) fn root(path: &Path, owner: &str, app: &str) -> Result<Value> {
    apply(path, owner, app, Scope::Root)
}
pub(super) fn state(path: &Path, owner: &str, app: &str) -> Result<Value> {
    // Canonical protected three-ACE DACL: equivalent effective rights to the
    // previous inherited RX plus explicit F; deliberately not byte-identical.
    apply(path, owner, app, Scope::State)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };
    const USER: &str = "S-1-5-21-1-2-3-1001";
    const APP: &str = "S-1-15-2-1-2-3-4-5-6-7";

    #[test]
    fn fixed_policy_requires_exact_sids_rights_types_and_inheritance() {
        for scope in [Scope::Root, Scope::State] {
            policy(USER, APP, scope).unwrap();
        }
        assert!(policy("SY", APP, Scope::Root).is_err());
        assert!(policy(USER, "S-1-15-2-1", Scope::State).is_err());
        let valid =
            format!("O:{USER}D:P(A;OICI;FA;;;{USER})(A;OICI;FA;;;SY)(A;OICI;0x1200a9;;;{APP})");
        for malformed in [
            valid.replace("D:P", "D:"),
            valid.replace("0x1200a9", "FA"),
            valid.replace("OICI", "CI"),
            valid.replace("OICI", "OICIID"),
            valid.replacen("(A;", "(D;", 1),
            format!("{valid}(A;OICI;FR;;;WD)"),
            valid.replace(";;;SY)", &format!(";;;{USER})")),
        ] {
            assert!(
                verify(
                    &Descriptor::parse(&malformed).unwrap(),
                    USER,
                    APP,
                    Scope::Root
                )
                .is_err(),
                "accepted {malformed}"
            );
        }
        let state = valid.replace("0x1200a9", "FA");
        for label in [
            "",
            "S:(ML;OICI;NW;;;ME)",
            "S:(ML;CI;NW;;;LW)",
            "S:(ML;OICI;NR;;;LW)",
        ] {
            assert!(verify(
                &Descriptor::parse(&format!("{state}{label}")).unwrap(),
                USER,
                APP,
                Scope::State
            )
            .is_err());
        }
    }

    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn real_directory_handle_readback_preserves_owner_and_exact_root_state_policy() {
        let token = super::super::open_token(
            unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() },
            TOKEN_QUERY,
        )
        .unwrap();
        let storage = super::super::token_buffer(token.as_raw_handle(), TokenUser).unwrap();
        let user = unsafe { &*storage.as_ptr().cast::<TOKEN_USER>() };
        let owner = sid_text(user.User.Sid).unwrap();
        let scratch = Scratch(std::env::temp_dir().join(format!(
                "milkup-acl-test-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            )));
        // An elevated test runner normally creates Administrators-owned objects.
        // Supply the token's own user as owner at CREATE_NEW in this test only;
        // production never replaces an owner or adjusts an elevated token.
        let descriptor = Descriptor::parse(&format!(
            "O:{owner}D:P(A;OICI;FA;;;{owner})(A;OICI;FA;;;SY)"
        ))
        .unwrap();
        let attrs = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        check(unsafe { CreateDirectoryW(wide(scratch.0.as_os_str()).as_ptr(), &attrs) }).unwrap();
        let root_report = root(&scratch.0, &owner, APP).unwrap();
        assert_eq!(root_report["appContainerMask"], READ_EXECUTE);
        let state_path = scratch.0.join("state");
        check(unsafe { CreateDirectoryW(wide(state_path.as_os_str()).as_ptr(), &attrs) }).unwrap();
        let state_report = state(&state_path, &owner, APP).unwrap();
        assert_eq!(state_report["appContainerMask"], FILE_ALL_ACCESS);
        assert_eq!(state_report["lowNoWriteUpLabelVerified"], true);
        assert!(root(&scratch.0, USER, APP).is_err());
        let file = scratch.0.join("ordinary-file");
        fs::write(&file, b"fixture").unwrap();
        assert!(root(&file, &owner, APP).is_err());
        assert!(
            state(&scratch.0, &owner, APP).is_err(),
            "populated root must not receive state permissions"
        );

        // A directory junction requires no symlink privilege. Build it using
        // the documented mount-point reparse buffer, only within this fixture.
        let junction = scratch.0.join("junction");
        check(unsafe { CreateDirectoryW(wide(junction.as_os_str()).as_ptr(), &attrs) }).unwrap();
        create_junction(&junction, &state_path);
        assert!(root(&junction, &owner, APP).is_err());
        // If the setter followed the junction, this exact state verification
        // would fail because root policy would have replaced AppContainer F.
        let target = unsafe {
            owned(CreateFileW(
                wide(state_path.as_os_str()).as_ptr(),
                READ_CONTROL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            ))
        }
        .unwrap();
        verify(
            &Descriptor::read(target.as_raw_handle(), true).unwrap(),
            &owner,
            APP,
            Scope::State,
        )
        .unwrap();
        drop(target);
        fs::remove_dir(&junction).unwrap();
        // All error and success paths must have released their non-delete-share
        // handles; successful rename/removal provides an actual handle check.
        let renamed = scratch.0.join("renamed");
        fs::rename(&state_path, &renamed).unwrap();
        fs::remove_dir_all(&scratch.0).unwrap();
        assert!(!scratch.0.exists());
    }

    fn create_junction(path: &Path, target: &Path) {
        use windows_sys::Win32::System::{
            Ioctl::FSCTL_SET_REPARSE_POINT, SystemServices::IO_REPARSE_TAG_MOUNT_POINT,
            IO::DeviceIoControl,
        };
        let absolute = fs::canonicalize(target).unwrap();
        let text = absolute.to_string_lossy();
        let substitute = format!("\\??\\{}", text.strip_prefix("\\\\?\\").unwrap_or(&text));
        let mut substitute = wide(OsStr::new(&substitute));
        let substitute_bytes = (substitute.len() - 1) * 2;
        // Empty print name after the substitute's NUL terminator.
        substitute.push(0);
        let mut buffer = Vec::new();
        buffer.extend(IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
        buffer.extend(
            u16::try_from(8 + substitute.len() * 2)
                .unwrap()
                .to_le_bytes(),
        );
        buffer.extend(0u16.to_le_bytes());
        buffer.extend(0u16.to_le_bytes());
        buffer.extend(u16::try_from(substitute_bytes).unwrap().to_le_bytes());
        buffer.extend(u16::try_from(substitute_bytes + 2).unwrap().to_le_bytes());
        buffer.extend(0u16.to_le_bytes());
        for unit in substitute {
            buffer.extend(unit.to_le_bytes());
        }
        let handle = unsafe {
            owned(CreateFileW(
                wide(path.as_os_str()).as_ptr(),
                GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            ))
        }
        .unwrap();
        let mut returned = 0;
        check(unsafe {
            DeviceIoControl(
                handle.as_raw_handle(),
                FSCTL_SET_REPARSE_POINT,
                buffer.as_ptr().cast(),
                u32::try_from(buffer.len()).unwrap(),
                null_mut(),
                0,
                &mut returned,
                null_mut(),
            )
        })
        .unwrap();
    }
}

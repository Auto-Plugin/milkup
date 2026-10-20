//! Local Windows HTML publication and a separately owned native picker.
//! No WebView, plugin JavaScript, Runtime bootstrap or network bridge runs here.
//! File flush is strict; no POSIX directory-fsync/power-loss guarantee is made.
use super::*;
use std::{
    mem::{offset_of, size_of},
    os::windows::io::{AsRawHandle, FromRawHandle},
    path::{Component, Prefix},
    ptr::{null, null_mut},
};

// Same NT handle-relative primitive already used by the local NTFS catalog.
// Only a random, validated single-component stage name reaches this API.
#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}
#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: *mut std::ffi::c_void,
    object_name: *mut UnicodeString,
    attributes: u32,
    security_descriptor: *mut std::ffi::c_void,
    security_quality_of_service: *mut std::ffi::c_void,
}
#[repr(C)]
#[derive(Default)]
struct IoStatus {
    status_or_pointer: usize,
    information: usize,
}
#[link(name = "ntdll")]
extern "system" {
    fn NtCreateFile(
        handle: *mut *mut std::ffi::c_void,
        access: u32,
        attributes: *mut ObjectAttributes,
        io: *mut IoStatus,
        allocation: *const i64,
        file_attributes: u32,
        share: u32,
        disposition: u32,
        options: u32,
        ea: *const std::ffi::c_void,
        ea_length: u32,
    ) -> i32;
    fn NtSetInformationFile(
        handle: *mut std::ffi::c_void,
        io: *mut IoStatus,
        info: *const std::ffi::c_void,
        length: u32,
        class: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}
fn create_stage(directory: &File, name: &str) -> Result<File> {
    component(name)?;
    let mut name: Vec<u16> = name.encode_utf16().collect();
    let mut unicode = UnicodeString {
        length: (name.len() * 2) as u16,
        maximum_length: (name.len() * 2) as u16,
        buffer: name.as_mut_ptr(),
    };
    let mut attributes = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root_directory: directory.as_raw_handle(),
        object_name: &mut unicode,
        attributes: 0x40,
        security_descriptor: null_mut(),
        security_quality_of_service: null_mut(),
    };
    let mut io = IoStatus::default();
    let mut handle = null_mut();
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            0x40000000 | 0x10000 | 0x40000 | 0x80 | 0x100000,
            &mut attributes,
            &mut io,
            null(),
            0,
            0,
            2, // FILE_CREATE, exclusive sharing
            2 | 0x20 | 0x40 | 0x200000,
            null(),
            0,
        )
    }; // write-through, synchronous, non-directory, no-follow
    if status < 0 {
        return Err(error(std::io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(status) } as i32,
        )));
    }
    Ok(unsafe { File::from_raw_handle(handle) })
}
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::{
        Authorization::{GetSecurityInfo, SetSecurityInfo, SE_FILE_OBJECT},
        GetSecurityDescriptorControl, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, SE_DACL_PROTECTED,
        UNPROTECTED_DACL_SECURITY_INFORMATION,
    },
    Storage::FileSystem::{
        FileDispositionInfo, GetDriveTypeW, GetVolumeInformationByHandleW,
        SetFileInformationByHandle, FILE_DISPOSITION_INFO, FILE_RENAME_INFO,
    },
};

#[path = "output_windows_picker.rs"]
mod picker;
pub(super) use picker::{choose_target, run_helper};

pub(super) fn validate_path(path: &Path) -> Result<()> {
    let mut parts = path.components();
    let drive =
        match parts.next() {
            Some(Component::Prefix(p)) => match p.kind() {
                Prefix::Disk(d) | Prefix::VerbatimDisk(d) if d.is_ascii_alphabetic() => d,
                _ => return Err(
                    "Windows output requires a local NTFS drive; UNC/device paths are unsupported"
                        .into(),
                ),
            },
            _ => return Err("Windows output requires an absolute drive path".into()),
        };
    if parts.next() != Some(Component::RootDir) {
        return Err("Drive-relative output is not authorized".into());
    }
    let root: Vec<_> = format!("{}:\\", drive as char)
        .encode_utf16()
        .chain(Some(0))
        .collect();
    // DRIVE_REMOTE includes mapped network drives. Reparse ancestors are checked
    // separately by the pinned-directory traversal before any leaf is opened.
    if unsafe { GetDriveTypeW(root.as_ptr()) } == 4 {
        return Err("Remote output filesystems are unsupported".into());
    }
    for part in parts {
        let Component::Normal(name) = part else {
            return Err("Relative output path component".into());
        };
        component(name.to_str().ok_or("Non-Unicode output path")?)?;
    }
    Ok(())
}
fn component(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|p| {
            stem.strip_prefix(p).is_some_and(|s| {
                matches!(
                    s,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if name.is_empty()
        || name == "."
        || name == ".."
        || device
        || name.ends_with(['.', ' '])
        || name.encode_utf16().count() > 255
        || name
            .chars()
            .any(|c| c.is_control() || "\\/:<>\"|?*".contains(c))
    {
        return Err("Invalid Windows output component or alternate data stream".into());
    }
    Ok(())
}
pub(super) fn require_ntfs(directory: &File) -> Result<()> {
    let mut name = [0u16; 32];
    if unsafe {
        GetVolumeInformationByHandleW(
            directory.as_raw_handle(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            null_mut(),
            name.as_mut_ptr(),
            name.len() as u32,
        )
    } == 0
    {
        return Err(error(std::io::Error::last_os_error()));
    }
    let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
    if String::from_utf16_lossy(&name[..end]) != "NTFS" {
        return Err(
            "Windows output currently requires local NTFS; this filesystem is unsupported".into(),
        );
    }
    Ok(())
}

// Copy the existing destination's discretionary permissions to the newly owned
// stage. No ACL is changed on the old output, source, ancestors or system files.
fn preserve_dacl(source: &File, stage: &File) -> Result<()> {
    let mut descriptor = null_mut();
    let mut dacl = null_mut();
    let status = unsafe {
        GetSecurityInfo(
            source.as_raw_handle(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        return Err(error(std::io::Error::from_raw_os_error(status as i32)));
    }
    let result = (|| {
        let mut control = 0;
        let mut revision = 0;
        if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0 {
            return Err(error(std::io::Error::last_os_error()));
        }
        let protection = if control & SE_DACL_PROTECTED != 0 {
            PROTECTED_DACL_SECURITY_INFORMATION
        } else {
            UNPROTECTED_DACL_SECURITY_INFORMATION
        };
        let status = unsafe {
            SetSecurityInfo(
                stage.as_raw_handle(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | protection,
                null_mut(),
                null_mut(),
                dacl,
                null(),
            )
        };
        if status != 0 {
            return Err(error(std::io::Error::from_raw_os_error(status as i32)));
        }
        Ok(())
    })();
    unsafe {
        LocalFree(descriptor);
    }
    result
}

struct Stage {
    file: File,
    committed: bool,
}
impl Stage {
    fn new(target: &Target) -> Result<Self> {
        let name = format!(".milkup-{}.tmp", crate::workspace::id("output-stage")?);
        // No drive-letter/pathname re-resolution after acquiring authorization.
        let file = create_stage(&target.directory, &name)?;
        Ok(Self {
            file,
            committed: false,
        })
    }
    fn rename(&mut self, target: &Target) -> Result<()> {
        let name: Vec<u16> = target.name.encode_utf16().collect();
        // Include the complete native structure, including its tail padding.
        let bytes = size_of::<FILE_RENAME_INFO>() + name.len() * 2;
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        unsafe {
            (*info).Anonymous.ReplaceIfExists = target.initial.is_some();
            // NtSetInformationFile resolves a simple name against the source
            // handle's existing parent. Stage creation is already anchored to
            // target.directory, and neither handle permits parent substitution.
            (*info).RootDirectory = null_mut();
            (*info).FileNameLength = (name.len() * 2) as u32;
            std::ptr::copy_nonoverlapping(name.as_ptr(), (*info).FileName.as_mut_ptr(), name.len());
        }
        let mut io = IoStatus::default();
        let status = unsafe {
            NtSetInformationFile(
                self.file.as_raw_handle(),
                &mut io,
                info.cast(),
                bytes as u32,
                10, // FileRenameInformation; same-parent, no pathname fallback
            )
        };
        if status < 0 {
            return Err(format!(
                "Cannot publish owned output stage: {} (NTSTATUS {status:#x})",
                std::io::Error::from_raw_os_error(unsafe { RtlNtStatusToDosError(status) } as i32)
            ));
        }
        self.committed = true;
        Ok(())
    }
    fn discard(&mut self) -> Result<()> {
        if self.committed {
            return Ok(());
        }
        // Delete by owned handle, never a possibly substituted pathname.
        let info = FILE_DISPOSITION_INFO { DeleteFile: true };
        if unsafe {
            SetFileInformationByHandle(
                self.file.as_raw_handle(),
                FileDispositionInfo,
                (&info as *const FILE_DISPOSITION_INFO).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        } == 0
        {
            return Err(format!(
                "Cannot clean owned output stage: {}",
                std::io::Error::last_os_error()
            ));
        }
        self.committed = true; // deletion pending; do not repeat it on Drop
        Ok(())
    }
}
impl Drop for Stage {
    fn drop(&mut self) {
        let _ = self.discard(); // panic/unwind fallback; normal errors checked below
    }
}
pub(super) fn publish(target: &Target, job: &Job, bytes: &[u8]) -> Result<Written> {
    let mut stage = Stage::new(target).map_err(|e| format!("Cannot create output stage: {e}"))?;
    let result = (|| {
        if target.initial.is_some() {
            preserve_dacl(&target.open()?, &stage.file)
                .map_err(|e| format!("Cannot preserve output permissions: {e}"))?;
        }
        // Do not put document bytes into a stage with broader inherited access
        // than an existing private output, including if the app dies mid-write.
        stage
            .file
            .write_all(bytes)
            .map_err(|e| format!("Cannot write output stage: {e}"))?;
        stage
            .file
            .sync_all()
            .map_err(|e| format!("Cannot flush output stage: {e}"))?;
        let _state = job.state.lock().map_err(error)?;
        job.active()?;
        target.verify(job.source.as_deref())?;
        job.protect_target(target)?;
        // Same immediate-recheck boundary as existing document save/Linux output.
        // No in-place write and no name fallback; new destinations cannot replace.
        stage.rename(target)?;
        Ok(Written {
            name: target.name.clone(),
            bytes: bytes.len(),
        })
    })();
    if let Err(failure) = &result {
        stage
            .discard()
            .map_err(|cleanup| format!("{failure}; {cleanup}"))?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_stage_structures_match_windows_pointer_width() {
        let wide = size_of::<usize>() == 8;
        assert_eq!(size_of::<UnicodeString>(), if wide { 16 } else { 8 });
        assert_eq!(offset_of!(UnicodeString, buffer), if wide { 8 } else { 4 });
        assert_eq!(size_of::<ObjectAttributes>(), if wide { 48 } else { 24 });
        assert_eq!(
            offset_of!(ObjectAttributes, object_name),
            if wide { 16 } else { 8 }
        );
        assert_eq!(size_of::<IoStatus>(), if wide { 16 } else { 8 });
        assert_eq!(
            offset_of!(FILE_RENAME_INFO, FileName),
            if wide { 20 } else { 12 }
        );
    }
    #[test]
    fn live_stage_cannot_be_substituted_and_new_destination_rename_never_replaces() {
        let root = std::env::temp_dir().join(crate::workspace::id("output-stage-proof").unwrap());
        fs::create_dir(&root).unwrap();
        let destination = root.join("new.html");
        {
            let target = Target::adopt(&destination, None).unwrap();
            let mut stage = Stage::new(&target).unwrap();
            stage.file.write_all(b"new bytes").unwrap();
            let stage_path = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
            assert_eq!(
                fs::rename(&stage_path, root.join("substitute"))
                    .unwrap_err()
                    .raw_os_error(),
                Some(32)
            );
            assert!(fs::write(&stage_path, b"tamper").is_err());
            fs::write(&destination, "external new destination").unwrap();
            assert!(stage.rename(&target).is_err());
            stage.discard().unwrap();
        }
        assert_eq!(fs::read(&destination).unwrap(), b"external new destination");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

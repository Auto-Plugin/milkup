//! Handle-relative local NTFS catalog IO. No pathname fallback after root acquisition.
//!
//! New files are write-through, flushed before publication, and the renamed handle
//! is flushed again. Windows does not provide a documented unprivileged equivalent
//! of POSIX directory fsync here: `sync` validates the pinned directory, it does NOT
//! promise a directory-metadata durability barrier. Recovery uses the existing
//! checksummed primary/backup protocol; arbitrary power-loss durability is unproven.
use super::*;
use std::ffi::c_void;
use std::fs::File;
use std::io::{Read, Write};
#[cfg(test)]
use std::mem::offset_of;
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::path::{Component, Prefix};
use std::ptr::{null, null_mut};
use std::sync::Arc;

type Handle = *mut c_void;
type Status = i32;
const READ_DATA: u32 = 1; // FILE_LIST_DIRECTORY for directories
const WRITE_DATA: u32 = 2;
const READ_ATTRIBUTES: u32 = 0x80;
const DELETE: u32 = 0x10000;
const SYNCHRONIZE: u32 = 0x100000;
const SHARE_READ: u32 = 1;
const SHARE_WRITE: u32 = 2;
const SHARE_DELETE: u32 = 4;
const OPEN: u32 = 1;
const CREATE: u32 = 2;
const OPEN_IF: u32 = 3;
const DIRECTORY: u32 = 1;
const WRITE_THROUGH: u32 = 2;
const SYNCHRONOUS: u32 = 0x20;
const NON_DIRECTORY: u32 = 0x40;
const OPEN_REPARSE: u32 = 0x200000;
const ATTR_DIRECTORY: u32 = 0x10;
const ATTR_REPARSE: u32 = 0x400;
const ATTR_DEVICE: u32 = 0x40;
const STATUS_NO_MORE_FILES: Status = 0x80000006u32 as i32;

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}
#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: Handle,
    object_name: *mut UnicodeString,
    attributes: u32,
    security_descriptor: *mut c_void,
    security_quality_of_service: *mut c_void,
}
#[repr(C)]
#[derive(Default)]
struct IoStatus {
    status_or_pointer: usize,
    information: usize,
}
#[repr(C)]
#[derive(Default)]
struct FileTime {
    low: u32,
    high: u32,
}
#[repr(C)]
#[derive(Default)]
struct FileInfo {
    attributes: u32,
    creation: FileTime,
    access: FileTime,
    write: FileTime,
    volume_serial: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    index_high: u32,
    index_low: u32,
}
#[repr(C)]
struct RenameInfo {
    replace_if_exists: u8,
    root_directory: Handle,
    file_name_length: u32,
    file_name: [u16; 1],
}
#[repr(C)]
#[derive(Default)]
struct FullSizeInfo {
    total_units: i64,
    caller_available_units: i64,
    actual_available_units: i64,
    sectors_per_unit: u32,
    bytes_per_sector: u32,
}
#[repr(C)]
#[derive(Default)]
struct DeviceInfo {
    device_type: u32,
    characteristics: u32,
}

#[link(name = "ntdll")]
extern "system" {
    fn NtCreateFile(
        handle: *mut Handle,
        access: u32,
        attributes: *mut ObjectAttributes,
        io: *mut IoStatus,
        allocation: *const i64,
        file_attributes: u32,
        share: u32,
        disposition: u32,
        options: u32,
        ea: *const c_void,
        ea_length: u32,
    ) -> Status;
    fn NtSetInformationFile(
        handle: Handle,
        io: *mut IoStatus,
        info: *const c_void,
        length: u32,
        class: u32,
    ) -> Status;
    fn NtQueryDirectoryFile(
        handle: Handle,
        event: Handle,
        apc: *const c_void,
        context: *const c_void,
        io: *mut IoStatus,
        info: *mut c_void,
        length: u32,
        class: u32,
        single: u8,
        name: *const UnicodeString,
        restart: u8,
    ) -> Status;
    fn NtQueryVolumeInformationFile(
        handle: Handle,
        io: *mut IoStatus,
        info: *mut c_void,
        length: u32,
        class: u32,
    ) -> Status;
    fn RtlNtStatusToDosError(status: Status) -> u32;
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        name: *const u16,
        access: u32,
        share: u32,
        security: *const c_void,
        disposition: u32,
        flags: u32,
        template: Handle,
    ) -> Handle;
    fn GetFileInformationByHandle(handle: Handle, info: *mut FileInfo) -> i32;
    fn GetVolumeInformationByHandleW(
        handle: Handle,
        name: *mut u16,
        name_size: u32,
        serial: *mut u32,
        max_component: *mut u32,
        flags: *mut u32,
        filesystem: *mut u16,
        filesystem_size: u32,
    ) -> i32;
}
fn nt_error(status: Status) -> String {
    let code = unsafe { RtlNtStatusToDosError(status) };
    err(
        "io",
        format!(
            "NT status 0x{:08x}: {}",
            status as u32,
            std::io::Error::from_raw_os_error(code as i32)
        ),
    )
}
fn checked(status: Status) -> Result<()> {
    if status < 0 {
        Err(nt_error(status))
    } else {
        Ok(())
    }
}
fn component(name: &str) -> Result<Vec<u16>> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
        })
        || name.ends_with([' ', '.'])
    {
        return Err(err("invalid", "invalid Windows relative IO component"));
    }
    // Device aliases are rejected even though the native relative API does not
    // apply DOS device parsing. This keeps names portable and unambiguous.
    let stem = name.split('.').next().unwrap().to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|p| {
            stem.strip_prefix(p).is_some_and(|s| {
                matches!(
                    s,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        })
    {
        return Err(err("invalid", "Windows reserved component"));
    }
    let wide: Vec<_> = name.encode_utf16().collect();
    if wide.len() > 255 {
        return Err(err("invalid", "Windows component too long"));
    }
    Ok(wide)
}
fn info(file: &File) -> Result<FileInfo> {
    let mut info = FileInfo::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(err("io", std::io::Error::last_os_error()));
    }
    if info.attributes & (ATTR_REPARSE | ATTR_DEVICE) != 0 {
        return Err(err("invalid", "reparse/device catalog entry rejected"));
    }
    // Hardlinks have no reparse flag. Never read, lock or modify an alias to a
    // regular file outside the catalog. NTFS directories normally have 1 link.
    if info.attributes & ATTR_DIRECTORY == 0 && info.links != 1 {
        return Err(err("invalid", "hard-linked catalog file rejected"));
    }
    Ok(info)
}
fn regular(file: &File) -> Result<FileInfo> {
    let meta = info(file)?;
    if meta.attributes & ATTR_DIRECTORY != 0 {
        return Err(err("invalid", "regular file required"));
    }
    Ok(meta)
}

#[derive(Clone)]
pub struct Dir {
    file: Arc<File>,
    // Each directory is opened without SHARE_DELETE; keeping all ancestor handles
    // alive prevents rename/junction replacement while descendant IO is in flight.
    ancestors: Vec<Arc<File>>,
}
impl Dir {
    pub fn open(path: &Path, create: bool) -> Result<Self> {
        let mut components = path.components();
        let drive = match components.next() {
            Some(Component::Prefix(p)) => match p.kind() {
                Prefix::Disk(d) | Prefix::VerbatimDisk(d) if d.is_ascii_alphabetic() => d,
                _ => return Err(err(
                    "unsupported",
                    "catalog requires a local drive NTFS path; UNC/device paths are unsupported",
                )),
            },
            _ => return Err(err("invalid", "absolute Windows catalog root required")),
        };
        if components.next() != Some(Component::RootDir) {
            return Err(err("invalid", "drive-relative catalog root"));
        }
        let root: Vec<u16> = format!("\\\\?\\{}:\\", drive as char)
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // Only the volume root uses Win32 pathname resolution. Every subsequent
        // component is opened relative to an already validated directory handle.
        let raw = unsafe {
            CreateFileW(
                root.as_ptr(),
                READ_DATA | READ_ATTRIBUTES | SYNCHRONIZE,
                SHARE_READ,
                null(),
                3,
                0x02000000 | OPEN_REPARSE,
                null_mut(),
            )
        };
        if raw as isize == -1 {
            return Err(err("io", std::io::Error::last_os_error()));
        }
        let file = unsafe { File::from_raw_handle(raw) };
        let mut current = Self {
            file: Arc::new(file),
            ancestors: vec![],
        };
        current.sync()?;
        current.require_local_ntfs()?;
        for c in components {
            match c {
                Component::Normal(n) => {
                    current = current.child(
                        n.to_str()
                            .ok_or_else(|| err("invalid", "non-Unicode app data path"))?,
                        create,
                    )?
                }
                _ => return Err(err("invalid", "noncanonical Windows catalog root")),
            }
        }
        Ok(current)
    }
    fn require_local_ntfs(&self) -> Result<()> {
        let mut io = IoStatus::default();
        let mut device = DeviceInfo::default();
        checked(unsafe {
            NtQueryVolumeInformationFile(
                self.file.as_raw_handle(),
                &mut io,
                &mut device as *mut _ as *mut c_void,
                size_of::<DeviceInfo>() as u32,
                4,
            )
        })?;
        if device.characteristics & 0x10 != 0 {
            return Err(err("unsupported", "remote catalog filesystem"));
        }
        let mut filesystem = [0u16; 32];
        if unsafe {
            GetVolumeInformationByHandleW(
                self.file.as_raw_handle(),
                null_mut(),
                0,
                null_mut(),
                null_mut(),
                null_mut(),
                filesystem.as_mut_ptr(),
                filesystem.len() as u32,
            )
        } == 0
        {
            return Err(err("io", std::io::Error::last_os_error()));
        }
        let len = filesystem
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(filesystem.len());
        if String::from_utf16_lossy(&filesystem[..len]) != "NTFS" {
            return Err(err("unsupported", "catalog requires local NTFS"));
        }
        Ok(())
    }
    fn raw_status(
        &self,
        name: &str,
        access: u32,
        disposition: u32,
        options: u32,
        share: u32,
    ) -> Result<std::result::Result<File, Status>> {
        let mut name = component(name)?;
        let mut unicode = UnicodeString {
            length: (name.len() * 2) as u16,
            maximum_length: (name.len() * 2) as u16,
            buffer: name.as_mut_ptr(),
        };
        let mut attrs = ObjectAttributes {
            length: size_of::<ObjectAttributes>() as u32,
            root_directory: self.file.as_raw_handle(),
            object_name: &mut unicode,
            attributes: 0x40, // OBJ_CASE_INSENSITIVE; handles are not inherited
            security_descriptor: null_mut(),
            security_quality_of_service: null_mut(),
        };
        let mut io = IoStatus::default();
        let mut handle = null_mut();
        let status = unsafe {
            NtCreateFile(
                &mut handle,
                access | READ_ATTRIBUTES | SYNCHRONIZE,
                &mut attrs,
                &mut io,
                null(),
                0,
                share,
                disposition,
                options | OPEN_REPARSE | SYNCHRONOUS,
                null(),
                0,
            )
        };
        if status < 0 {
            return Ok(Err(status));
        }
        let file = unsafe { File::from_raw_handle(handle) };
        info(&file)?;
        Ok(Ok(file))
    }
    fn raw(
        &self,
        name: &str,
        access: u32,
        disposition: u32,
        options: u32,
        share: u32,
    ) -> Result<File> {
        self.raw_status(name, access, disposition, options, share)?
            .map_err(nt_error)
    }
    fn directory(&self, name: &str, create: bool, delete: bool) -> Result<Self> {
        let file = self.raw(
            name,
            READ_DATA | if delete { DELETE } else { 0 },
            if create { OPEN_IF } else { OPEN },
            DIRECTORY,
            SHARE_READ,
        )?;
        let mut ancestors = self.ancestors.clone();
        ancestors.push(self.file.clone());
        Ok(Self {
            file: Arc::new(file),
            ancestors,
        })
    }
    pub fn child(&self, name: &str, create: bool) -> Result<Self> {
        self.directory(name, create, false)
    }
    pub fn path(&self, path: &str, create: bool) -> Result<Self> {
        let mut current = self.clone();
        for name in path.split('/') {
            current = current.child(name, create)?;
        }
        Ok(current)
    }
    fn parent(&self, path: &str, create: bool) -> Result<(Self, String)> {
        let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
        component(name)?;
        let dir = if parent.is_empty() {
            self.clone()
        } else {
            self.path(parent, create)?
        };
        Ok((dir, name.into()))
    }
    pub fn exists(&self, name: &str) -> Result<bool> {
        match self.raw_status(name, 0, OPEN, 0, SHARE_READ)? {
            Ok(_) => Ok(true),
            Err(status) if matches!(status as u32, 0xc0000034 | 0xc000003a | 0xc000000f) => {
                Ok(false)
            }
            Err(status) => Err(nt_error(status)),
        }
    }
    pub fn read(&self, path: &str, limit: usize) -> Result<Vec<u8>> {
        let (dir, name) = self.parent(path, false)?;
        let file = dir.raw(&name, READ_DATA, OPEN, NON_DIRECTORY, SHARE_READ)?;
        let meta = regular(&file)?;
        let len = (meta.size_high as u64) << 32 | meta.size_low as u64;
        if len > limit as u64 {
            return Err(err("quota", "resource must be bounded regular file"));
        }
        let mut bytes = vec![];
        file.take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| err("io", e))?;
        if bytes.len() > limit {
            return Err(err("quota", "resource grew beyond budget"));
        }
        Ok(bytes)
    }
    pub fn create(&self, path: &str, bytes: &[u8]) -> Result<()> {
        let (dir, name) = self.parent(path, true)?;
        let mut file = dir.raw(
            &name,
            WRITE_DATA,
            CREATE,
            NON_DIRECTORY | WRITE_THROUGH,
            SHARE_READ,
        )?;
        file.write_all(bytes).map_err(|e| err("io", e))?;
        file.sync_all().map_err(|e| err("io", e))?;
        dir.sync()
    }
    /// Validate the pinned directory; see module-level durability limitation.
    /// No failed file FlushFileBuffers operation is ignored or converted to success.
    pub fn sync(&self) -> Result<()> {
        if info(&self.file)?.attributes & ATTR_DIRECTORY == 0 {
            return Err(err("invalid", "directory handle required"));
        }
        Ok(())
    }
    pub fn atomic(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let wide = component(name)?;
        // Validate an existing target without following it. A concurrent final-name
        // replacement cannot redirect this rename outside the pinned parent.
        match self.raw_status(
            name,
            0,
            OPEN,
            NON_DIRECTORY,
            SHARE_READ | SHARE_WRITE | SHARE_DELETE,
        )? {
            Ok(file) => {
                regular(&file)?;
            }
            Err(status) if matches!(status as u32, 0xc0000034 | 0xc000000f) => {}
            Err(status) => return Err(nt_error(status)),
        }
        let temp = format!(".catalog-tmp-{}", token());
        let mut file = self.raw(
            &temp,
            WRITE_DATA | DELETE,
            CREATE,
            NON_DIRECTORY | WRITE_THROUGH,
            SHARE_READ,
        )?;
        file.write_all(bytes).map_err(|e| err("io", e))?;
        file.sync_all().map_err(|e| err("io", e))?;
        // repr(C) offset includes native pointer alignment on x86/x64/ARM64.
        // Microsoft requires sizeof(FILE_RENAME_INFORMATION) plus name bytes,
        // including the trailing C-struct padding, not just the field offset.
        let length = size_of::<RenameInfo>() + wide.len() * 2;
        let mut buffer = vec![0usize; length.div_ceil(size_of::<usize>())];
        let ptr = buffer.as_mut_ptr() as *mut RenameInfo;
        unsafe {
            (*ptr).replace_if_exists = 1;
            // This is always a same-directory rename of the exact temp handle.
            // A simple name with NULL RootDirectory selects its existing parent.
            // Passing our directory handle unnecessarily asks the IO manager to
            // reopen that directory for WRITE_DATA, conflicting with its pinned
            // SHARE_READ handle. Do not weaken directory sharing to compensate.
            (*ptr).root_directory = null_mut();
            (*ptr).file_name_length = (wide.len() * 2) as u32;
            std::ptr::copy_nonoverlapping(
                wide.as_ptr(),
                std::ptr::addr_of_mut!((*ptr).file_name).cast::<u16>(),
                wide.len(),
            );
        }
        let mut io = IoStatus::default();
        checked(unsafe {
            NtSetInformationFile(
                file.as_raw_handle(),
                &mut io,
                buffer.as_ptr().cast(),
                length as u32,
                10,
            )
        })?; // FileRenameInformation
        file.sync_all().map_err(|e| {
            err(
                "io",
                format!("replacement may be committed; reread catalog before retry: {e}"),
            )
        })?;
        self.sync()
    }
    pub fn lock(&self) -> Result<File> {
        // Keep the lock file pinned (no SHARE_DELETE), and reject existing hardlinks.
        let file = self.raw(
            "catalog.lock",
            READ_DATA | WRITE_DATA,
            OPEN_IF,
            NON_DIRECTORY | WRITE_THROUGH,
            SHARE_READ | SHARE_WRITE,
        )?;
        regular(&file)?;
        fs2::FileExt::try_lock_exclusive(&file)
            .map_err(|e| err("conflict", format!("catalog busy: {e}")))?;
        Ok(file)
    }
    pub fn free(&self) -> Result<u64> {
        #[cfg(test)]
        if let Some(value) = TEST_FREE.with(|v| *v.borrow()) {
            return Ok(value);
        }
        let mut io = IoStatus::default();
        let mut size = FullSizeInfo::default();
        checked(unsafe {
            NtQueryVolumeInformationFile(
                self.file.as_raw_handle(),
                &mut io,
                &mut size as *mut _ as *mut c_void,
                size_of::<FullSizeInfo>() as u32,
                7,
            )
        })?;
        if size.caller_available_units < 0
            || size.sectors_per_unit == 0
            || size.bytes_per_sector == 0
        {
            return Err(err("io", "invalid volume free-space response"));
        }
        Ok((size.caller_available_units as u64)
            .saturating_mul(size.sectors_per_unit as u64)
            .saturating_mul(size.bytes_per_sector as u64))
    }
    pub fn list(&self) -> Result<Vec<(String, bool)>> {
        // NtQueryDirectoryFile enumerates this handle, never a reconstructed path.
        let mut out = vec![];
        let mut buffer = vec![0u64; 8192];
        let mut restart = 1;
        loop {
            let mut io = IoStatus::default();
            let status = unsafe {
                NtQueryDirectoryFile(
                    self.file.as_raw_handle(),
                    null_mut(),
                    null(),
                    null(),
                    &mut io,
                    buffer.as_mut_ptr().cast(),
                    (buffer.len() * 8) as u32,
                    12,
                    0,
                    null(),
                    restart,
                )
            }; // FileNamesInformation
            restart = 0;
            if status == STATUS_NO_MORE_FILES {
                break;
            }
            checked(status)?;
            if io.information == 0 || io.information > buffer.len() * 8 {
                return Err(err("io", "invalid directory response length"));
            }
            let bytes =
                unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), io.information) };
            let mut offset = 0;
            loop {
                if offset + 12 > bytes.len() {
                    return Err(err("io", "truncated directory entry"));
                }
                let next =
                    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
                let len =
                    u32::from_le_bytes(bytes[offset + 8..offset + 12].try_into().unwrap()) as usize;
                if len % 2 != 0 || len > 510 || offset + 12 + len > bytes.len() {
                    return Err(err("io", "invalid directory name"));
                }
                let wide: Vec<u16> = bytes[offset + 12..offset + 12 + len]
                    .chunks_exact(2)
                    .map(|b| u16::from_le_bytes([b[0], b[1]]))
                    .collect();
                let name = String::from_utf16(&wide)
                    .map_err(|_| err("invalid", "non-Unicode package filename"))?;
                if name != "." && name != ".." {
                    let file = self.raw(&name, 0, OPEN, 0, SHARE_READ)?;
                    out.push((name, info(&file)?.attributes & ATTR_DIRECTORY != 0));
                    if out.len() > MAX_FILES + MAX_ENTRIES {
                        return Err(err("quota", "directory entry budget"));
                    }
                }
                if next == 0 {
                    break;
                }
                if next < 12 + len || next % 4 != 0 || offset + next >= bytes.len() {
                    return Err(err("io", "invalid directory entry offset"));
                }
                offset += next;
            }
        }
        out.sort();
        Ok(out)
    }
    pub fn remove_tree(&self, name: &str) -> Result<()> {
        let dir = self.directory(name, false, true)?;
        for (name, directory) in dir.list()? {
            if directory {
                dir.remove_tree(&name)?;
            } else {
                let file = dir.raw(&name, DELETE, OPEN, NON_DIRECTORY, SHARE_READ)?;
                Self::delete(&file)?;
            }
        }
        Self::delete(&dir.file)?;
        drop(dir);
        self.sync()
    }
    fn delete(file: &File) -> Result<()> {
        let delete: u8 = 1; // FILE_DISPOSITION_INFORMATION.DeleteFile
        let mut io = IoStatus::default();
        checked(unsafe {
            NtSetInformationFile(
                file.as_raw_handle(),
                &mut io,
                &delete as *const _ as *const c_void,
                1,
                13,
            )
        }) // FileDispositionInformation
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("milkup-windows-disk-{}", token()));
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn dir(&self) -> Dir {
            Dir::open(&self.0, false).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn DeviceIoControl(
            device: Handle,
            code: u32,
            input: *const c_void,
            input_size: u32,
            output: *mut c_void,
            output_size: u32,
            returned: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
    }
    // Mount-point junction creation needs no symlink privilege. Failure is a test
    // failure, never a skipped security assertion. Only generated temp paths used.
    fn junction(link: &Path, target: &Path) {
        std::fs::create_dir(link).unwrap();
        let canonical = target.canonicalize().unwrap();
        let canonical = canonical.to_str().unwrap();
        let print = canonical.strip_prefix("\\\\?\\").unwrap_or(canonical);
        let substitute: Vec<u16> = format!("\\??\\{print}").encode_utf16().collect();
        let print: Vec<u16> = print.encode_utf16().collect();
        let mut data = Vec::new();
        data.extend_from_slice(&0xa0000003u32.to_le_bytes()); // IO_REPARSE_TAG_MOUNT_POINT
        data.extend_from_slice(
            &((8 + (substitute.len() + print.len() + 2) * 2) as u16).to_le_bytes(),
        );
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&((substitute.len() * 2) as u16).to_le_bytes());
        data.extend_from_slice(&(((substitute.len() + 1) * 2) as u16).to_le_bytes());
        data.extend_from_slice(&((print.len() * 2) as u16).to_le_bytes());
        for c in substitute
            .into_iter()
            .chain(Some(0))
            .chain(print)
            .chain(Some(0))
        {
            data.extend_from_slice(&c.to_le_bytes());
        }
        let file = std::fs::OpenOptions::new()
            .write(true)
            .custom_flags(0x02000000 | OPEN_REPARSE)
            .open(link)
            .unwrap();
        let mut returned = 0;
        assert_ne!(
            unsafe {
                DeviceIoControl(
                    file.as_raw_handle(),
                    0x000900a4,
                    data.as_ptr().cast(),
                    data.len() as u32,
                    null_mut(),
                    0,
                    &mut returned,
                    null_mut(),
                )
            },
            0,
            "junction creation failed: {}",
            std::io::Error::last_os_error()
        );
    }
    #[test]
    fn windows_abi_layout_matches_sdk() {
        assert_eq!(size_of::<FileInfo>(), 52);
        assert_eq!(size_of::<FullSizeInfo>(), 32);
        assert_eq!(size_of::<DeviceInfo>(), 8);
        assert_eq!(size_of::<IoStatus>(), 2 * size_of::<usize>());
        assert_eq!(offset_of!(RenameInfo, root_directory), size_of::<usize>());
        assert_eq!(
            offset_of!(RenameInfo, file_name),
            2 * size_of::<usize>() + 4
        );
        assert_eq!(
            offset_of!(ObjectAttributes, root_directory),
            size_of::<usize>()
        );
    }
    #[test]
    fn windows_rejects_ambiguous_components_and_nonlocal_roots() {
        for component_name in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            "file:stream",
            "trailing.",
            "trailing ",
            "NUL",
            "com1.txt",
            "LPT²",
            "a\0b",
        ] {
            assert!(component(component_name).is_err(), "{component_name:?}");
        }
        for root in [
            r"C:relative",
            r"\\server\share\plugins",
            r"\\?\UNC\server\share\plugins",
            r"\\.\C:\plugins",
        ] {
            assert!(Dir::open(Path::new(root), false).is_err(), "{root}");
        }
    }
    #[test]
    fn windows_junction_never_reads_writes_or_removes_external_target() {
        let f = Fixture::new();
        let outside = Fixture::new();
        std::fs::write(outside.0.join("sentinel"), b"outside unchanged").unwrap();
        junction(&f.0.join("escape"), &outside.0);
        let dir = f.dir();
        assert!(dir.path("escape", false).is_err());
        assert!(dir.read("escape/sentinel", 100).is_err());
        assert!(dir.create("escape/new", b"bad").is_err());
        assert!(dir.remove_tree("escape").is_err());
        assert!(dir.list().is_err());
        assert!(Dir::open(&f.0.join("escape"), false).is_err());
        assert_eq!(
            std::fs::read(outside.0.join("sentinel")).unwrap(),
            b"outside unchanged"
        );
        assert!(!outside.0.join("new").exists());
        drop(dir);
        std::fs::remove_dir(f.0.join("escape")).unwrap();
    }
    #[test]
    fn windows_hardlinks_rejected_for_read_lock_and_replace() {
        let f = Fixture::new();
        let outside = Fixture::new();
        let sentinel = outside.0.join("sentinel");
        std::fs::write(&sentinel, b"outside unchanged").unwrap();
        std::fs::hard_link(&sentinel, f.0.join("alias")).unwrap();
        std::fs::hard_link(&sentinel, f.0.join("catalog.lock")).unwrap();
        let dir = f.dir();
        assert!(dir.read("alias", 100).is_err());
        assert!(dir.atomic("alias", b"bad").is_err());
        assert!(dir.lock().is_err());
        assert!(dir.list().is_err());
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"outside unchanged");
    }
    #[test]
    fn windows_pinned_ancestors_cannot_be_renamed_during_io() {
        let f = Fixture::new();
        let dir = Dir::open(&f.0.join("parent/child"), true).unwrap();
        assert!(std::fs::rename(f.0.join("parent"), f.0.join("moved")).is_err());
        dir.create("file", b"retained").unwrap();
        assert_eq!(dir.read("file", 10).unwrap(), b"retained");
        drop(dir);
        std::fs::rename(f.0.join("parent"), f.0.join("moved")).unwrap();
    }
    #[test]
    fn windows_replace_is_complete_or_preserves_old_on_sharing_failure() {
        let f = Fixture::new();
        let dir = f.dir();
        dir.atomic("catalog.json", b"old complete").unwrap();
        let blocker = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(SHARE_READ)
            .open(f.0.join("catalog.json"))
            .unwrap();
        assert!(dir.atomic("catalog.json", b"new complete").is_err());
        assert_eq!(dir.read("catalog.json", 100).unwrap(), b"old complete");
        drop(blocker);
        dir.atomic("catalog.json", b"new complete").unwrap();
        assert_eq!(dir.read("catalog.json", 100).unwrap(), b"new complete");
        dir.create("generation/sub/file", b"sealed").unwrap();
        assert_eq!(
            dir.path("generation", false).unwrap().list().unwrap(),
            vec![("sub".into(), true)]
        );
        dir.remove_tree("generation").unwrap();
        assert!(!dir.exists("generation").unwrap());
    }
    #[test]
    fn windows_lock_excludes_second_handle_and_releases_on_drop() {
        let f = Fixture::new();
        let dir = f.dir();
        let lock = dir.lock().unwrap();
        assert!(dir.lock().is_err());
        drop(lock);
        assert!(dir.lock().is_ok());
    }
}

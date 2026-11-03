//! The fixed helper owns its protocol endpoints. Browser descendants do not
//! need to inherit them. This removes ordinary handle inheritance only; it is
//! not a claim about explicit duplication or concurrent spawns in the parent.
use crate::Result;
use std::ptr::null_mut;
use windows_sys::Win32::{
    Foundation::{
        GetHandleInformation, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT,
        INVALID_HANDLE_VALUE,
    },
    Storage::FileSystem::{GetFileType, FILE_TYPE_PIPE},
    System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
};

fn standard_handles() -> [HANDLE; 3] {
    unsafe {
        [
            GetStdHandle(STD_INPUT_HANDLE),
            GetStdHandle(STD_OUTPUT_HANDLE),
            GetStdHandle(STD_ERROR_HANDLE),
        ]
    }
}

fn validate(handles: [HANDLE; 3], require_confined: bool) -> Result<()> {
    for (index, handle) in handles.into_iter().enumerate() {
        if handle == null_mut()
            || handle == INVALID_HANDLE_VALUE
            || handles[..index].contains(&handle)
        {
            return Err("Fixed helper requires three distinct valid protocol handles".into());
        }
        if unsafe { GetFileType(handle) } != FILE_TYPE_PIPE {
            return Err("Fixed helper standard handle is not a protocol pipe".into());
        }
        let mut flags = 0;
        if unsafe { GetHandleInformation(handle, &mut flags) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if require_confined && flags & HANDLE_FLAG_INHERIT != 0 {
            return Err("Fixed helper protocol handle remains inheritable".into());
        }
    }
    Ok(())
}

fn confine(handles: [HANDLE; 3]) -> Result<()> {
    validate(handles, false)?;
    for handle in handles {
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    validate(handles, true)
}

/// Borrowed handle values, never closed here: the process owns their lifetime.
/// Ready rejects changed standard-handle values or newly inheritable endpoints.
pub(crate) struct StandardHandles([HANDLE; 3]);

pub(crate) fn confine_standard_handles() -> Result<StandardHandles> {
    let handles = standard_handles();
    confine(handles)?;
    Ok(StandardHandles(handles))
}

impl StandardHandles {
    pub(crate) fn verify(&self) -> Result<()> {
        if standard_handles() != self.0 {
            return Err("Fixed helper protocol standard handles changed before Ready".into());
        }
        validate(self.0, true)
    }
}

#[cfg(test)]
#[path = "protocol_handles_tests.rs"]
mod tests;

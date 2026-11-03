//! CapturePreview's receiving stream is bounded independently of browser allocations.
use std::{
    ffi::c_void,
    sync::{Arc, Mutex},
};
use windows::{
    core::{implement, Ref, HRESULT},
    Win32::{
        Foundation::{E_NOTIMPL, E_POINTER, STG_E_MEDIUMFULL, S_FALSE, S_OK},
        System::Com::*,
    },
};

#[derive(Default)]
pub struct Buffer {
    pub bytes: Vec<u8>,
    position: usize,
}
#[implement(IStream)]
pub struct BoundedStream {
    pub buffer: Arc<Mutex<Buffer>>,
    pub limit: usize,
}
impl ISequentialStream_Impl for BoundedStream_Impl {
    fn Read(&self, pv: *mut c_void, cb: u32, count: *mut u32) -> HRESULT {
        if pv.is_null() && cb != 0 {
            return E_POINTER;
        }
        let Ok(mut b) = self.buffer.lock() else {
            return E_NOTIMPL;
        };
        let available = b.bytes.len().saturating_sub(b.position);
        let n = available.min(cb as usize);
        if n > 0 {
            unsafe {
                std::ptr::copy_nonoverlapping(b.bytes.as_ptr().add(b.position), pv.cast(), n);
            }
        }
        b.position += n;
        if !count.is_null() {
            unsafe {
                *count = n as u32;
            }
        }
        if n == cb as usize {
            S_OK
        } else {
            S_FALSE
        }
    }
    fn Write(&self, pv: *const c_void, cb: u32, count: *mut u32) -> HRESULT {
        if !count.is_null() {
            unsafe {
                *count = 0;
            }
        }
        if pv.is_null() && cb != 0 {
            return E_POINTER;
        }
        let Ok(mut b) = self.buffer.lock() else {
            return E_NOTIMPL;
        };
        let Some(end) = b
            .position
            .checked_add(cb as usize)
            .filter(|end| *end <= self.limit)
        else {
            return STG_E_MEDIUMFULL;
        };
        if end > b.bytes.len() {
            b.bytes.resize(end, 0);
        }
        if cb > 0 {
            unsafe {
                std::ptr::copy_nonoverlapping(
                    pv.cast::<u8>(),
                    b.bytes.as_mut_ptr().add(b.position),
                    cb as usize,
                );
            }
        }
        b.position = end;
        if !count.is_null() {
            unsafe {
                *count = cb;
            }
        }
        S_OK
    }
}
impl IStream_Impl for BoundedStream_Impl {
    fn Seek(&self, delta: i64, origin: STREAM_SEEK, result: *mut u64) -> windows::core::Result<()> {
        let mut b = self
            .buffer
            .lock()
            .map_err(|_| windows::core::Error::from(E_NOTIMPL))?;
        let base = match origin {
            STREAM_SEEK_SET => 0,
            STREAM_SEEK_CUR => b.position as i64,
            STREAM_SEEK_END => b.bytes.len() as i64,
            _ => return Err(E_NOTIMPL.into()),
        };
        let end = base
            .checked_add(delta)
            .filter(|end| *end >= 0 && *end as u64 <= self.limit as u64)
            .ok_or_else(|| windows::core::Error::from(STG_E_MEDIUMFULL))?;
        b.position = end as usize;
        if !result.is_null() {
            unsafe {
                *result = end as u64;
            }
        }
        Ok(())
    }
    fn SetSize(&self, size: u64) -> windows::core::Result<()> {
        if size > self.limit as u64 {
            return Err(STG_E_MEDIUMFULL.into());
        }
        self.buffer
            .lock()
            .map_err(|_| windows::core::Error::from(E_NOTIMPL))?
            .bytes
            .resize(size as usize, 0);
        Ok(())
    }
    fn CopyTo(
        &self,
        _: Ref<'_, IStream>,
        _: u64,
        _: *mut u64,
        _: *mut u64,
    ) -> windows::core::Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn Commit(&self, _: &STGC) -> windows::core::Result<()> {
        Ok(())
    }
    fn Revert(&self) -> windows::core::Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn LockRegion(&self, _: u64, _: u64, _: &LOCKTYPE) -> windows::core::Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn UnlockRegion(&self, _: u64, _: u64, _: u32) -> windows::core::Result<()> {
        Err(E_NOTIMPL.into())
    }
    fn Stat(&self, stat: *mut STATSTG, _: &STATFLAG) -> windows::core::Result<()> {
        if stat.is_null() {
            return Err(E_POINTER.into());
        }
        let b = self
            .buffer
            .lock()
            .map_err(|_| windows::core::Error::from(E_NOTIMPL))?;
        unsafe {
            *stat = STATSTG::default();
            (*stat).cbSize = b.bytes.len() as u64;
            (*stat).r#type = STGTY_STREAM.0 as u32;
        }
        Ok(())
    }
    fn Clone(&self) -> windows::core::Result<IStream> {
        Err(E_NOTIMPL.into())
    }
}

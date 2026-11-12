//! Bounded, opt-in observations of this WebView environment. Never authority proof.
use serde_json::{json, Value};
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, FILETIME},
    System::Threading::{
        GetProcessIoCounters, GetProcessTimes, OpenProcess, IO_COUNTERS,
        PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

static COUNT: AtomicUsize = AtomicUsize::new(0);
const RECORD_LIMIT: usize = 32;
const PROCESS_LIMIT: u32 = 16;
fn ticks(value: FILETIME) -> String {
    ((u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)).to_string()
}
fn counters(pid: u32) -> Value {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return json!({"complete":false,"openError":GetLastError()});
        }
        // No path, command line, memory, source text or environment data is read.
        let (mut created, mut exited, mut kernel, mut user) = std::mem::zeroed();
        let times = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) != 0;
        let times_error = if times { 0 } else { GetLastError() };
        let mut io: IO_COUNTERS = std::mem::zeroed();
        let io_ok = GetProcessIoCounters(handle, &mut io) != 0;
        let io_error = if io_ok { 0 } else { GetLastError() };
        let closed = CloseHandle(handle) != 0;
        json!({"complete":times&&io_ok&&closed,"handleClosed":closed,
            "timesError":times_error,"ioError":io_error,
            "times":times.then(||json!({"creationFileTime":ticks(created),"exitFileTime":ticks(exited),
                "kernel100ns":ticks(kernel),"user100ns":ticks(user)})),
            "io":io_ok.then(||json!({"readBytes":io.ReadTransferCount.to_string(),
                "writeBytes":io.WriteTransferCount.to_string(),"otherBytes":io.OtherTransferCount.to_string()}))})
    }
}
fn collect(environment: &ICoreWebView2Environment8) -> windows::core::Result<Value> {
    unsafe {
        let infos = environment.GetProcessInfos()?;
        let mut count = 0;
        infos.Count(&mut count)?;
        if count > PROCESS_LIMIT {
            return Ok(json!({"complete":false,"count":count,"processLimitExceeded":true}));
        }
        let mut rows = Vec::with_capacity(count as usize);
        let mut complete = true;
        for index in 0..count {
            let info = infos.GetValueAtIndex(index)?;
            let mut pid = 0;
            let mut kind = COREWEBVIEW2_PROCESS_KIND(0);
            info.ProcessId(&mut pid)?;
            info.Kind(&mut kind)?;
            let values = if pid > 0 {
                counters(pid as u32)
            } else {
                json!({"complete":false,"invalidPid":true})
            };
            complete &= values["complete"] == true;
            rows.push(json!({"pid":pid,"kind":kind.0,"counters":values}));
        }
        Ok(json!({"complete":complete,"count":count,"processes":rows}))
    }
}
pub(super) fn snapshot(environment: &ICoreWebView2Environment8, stage: &'static str) {
    let seq = COUNT.fetch_add(1, Ordering::Relaxed);
    if seq > RECORD_LIMIT {
        return;
    }
    let start = Instant::now();
    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let record = if seq == RECORD_LIMIT {
        json!({"schema":1,"pid":std::process::id(),"limitReached":true})
    } else {
        let result = match collect(environment) {
            Ok(value) => value,
            Err(error) => json!({"complete":false,"hresult":error.code().0}),
        };
        json!({"schema":1,"pid":std::process::id(),"seq":seq,"stage":stage,"unixMs":unix_ms,"durationUs":start.elapsed().as_micros(),"result":result})
    };
    let _ = writeln!(
        std::io::stderr().lock(),
        "MILKUP_WEBVIEW_PROCESS_TIMING {}",
        record
    );
}

//! Ownership/termination for trusted helpers and their descendants. This is NOT
//! a file/network security sandbox and must not authorize untrusted DOM code.
use std::{
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    process::Child,
    ptr::{null, null_mut},
    time::{Duration, Instant},
};
use windows_sys::Win32::System::JobObjects::*;

pub(crate) struct ProcessJob(OwnedHandle);
impl ProcessJob {
    pub(crate) fn new() -> Result<Self, String> {
        let raw = unsafe { CreateJobObjectW(null(), null()) };
        if raw.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        // NULL security attributes: the owner handle is never inherited.
        let job = Self(unsafe { OwnedHandle::from_raw_handle(raw) });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_JOB_MEMORY;
        limits.BasicLimitInformation.ActiveProcessLimit = 16;
        limits.JobMemoryLimit = 512 * 1024 * 1024;
        // Neither BREAKAWAY_OK nor SILENT_BREAKAWAY_OK is set.
        if unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(job)
    }
    /// Caller starts only our own helper, blocked on its private stdin handshake.
    /// No input or work is released until assignment succeeds. On failure the
    /// helper is killed and reaped; there is no fallback to unowned execution.
    pub(crate) fn assign(&self, child: &mut Child) -> Result<(), String> {
        if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), child.as_raw_handle()) } == 0 {
            let message = std::io::Error::last_os_error().to_string();
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Cannot own Windows helper: {message}"));
        }
        Ok(())
    }
    pub(crate) fn active(&self) -> Result<u32, String> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        if unsafe {
            QueryInformationJobObject(
                self.0.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(info.ActiveProcesses)
    }
    pub(crate) fn stop(&self) -> Result<(), String> {
        if unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.active()? != 0 {
            if Instant::now() >= deadline {
                return Err("Windows helper descendants have not confirmed cleanup".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::{
        fs,
        io::{Read, Write},
        path::{Path, PathBuf},
        process::{Command, Stdio},
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    const FIXTURE: &str = "windows_process::tests::fixture";
    fn command(mode: &str, marker: &Path) -> Command {
        let mut c = Command::new(std::env::current_exe().unwrap());
        c.args([
            FIXTURE,
            "--exact",
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("MILKUP_JOB_FIXTURE_MODE", mode)
        .env("MILKUP_JOB_FIXTURE_MARKER", marker)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        c
    }
    fn release(child: &mut Child) {
        child.stdin.take().unwrap().write_all(&[1]).unwrap();
    }
    fn marker() -> PathBuf {
        std::env::temp_dir().join(crate::workspace::id("job-proof").unwrap())
    }
    fn await_pid(marker: &Path) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok(s) = fs::read_to_string(marker) {
                if let Ok(pid) = s.parse() {
                    return pid;
                }
            }
            assert!(Instant::now() < deadline, "helper did not become ready");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn process(pid: u32) -> OwnedHandle {
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!handle.is_null(), "child must be alive before cleanup");
        unsafe { OwnedHandle::from_raw_handle(handle) }
    }
    #[test]
    #[ignore = "private subprocess fixture; exercised by actual Windows ownership tests"]
    fn fixture() {
        let Ok(mode) = std::env::var("MILKUP_JOB_FIXTURE_MODE") else {
            return;
        };
        let marker = PathBuf::from(std::env::var_os("MILKUP_JOB_FIXTURE_MARKER").unwrap());
        let mut handshake = [0];
        if std::io::stdin().read_exact(&mut handshake).is_err() || handshake != [1] {
            return;
        }
        let mut private_owner = None;
        let mut descendant = None;
        if mode == "tree" || mode == "owner" {
            let mut c = command("hold", &marker).spawn().unwrap();
            if mode == "owner" {
                let owner = ProcessJob::new().unwrap();
                owner.assign(&mut c).unwrap();
                private_owner = Some(owner);
            }
            release(&mut c);
            // Attempted escape must fail while this process belongs to our Job.
            if mode == "tree" {
                assert!(command("hold", &marker)
                    .creation_flags(0x01000000)
                    .spawn()
                    .is_err());
            }
            fs::write(&marker, c.id().to_string()).unwrap();
            descendant = Some(c);
        }
        // Keep ownership handles alive; no matching by process name/PID killing.
        std::hint::black_box((&private_owner, &descendant));
        loop {
            std::thread::sleep(Duration::from_secs(1));
        }
    }
    #[test]
    fn job_owns_grandchildren_rejects_breakaway_and_confirms_empty_after_stop() {
        let marker = marker();
        let owner = ProcessJob::new().unwrap();
        let mut child = command("tree", &marker).spawn().unwrap();
        owner.assign(&mut child).unwrap();
        release(&mut child);
        let descendant = process(await_pid(&marker));
        assert!(owner.active().unwrap() >= 2);
        owner.stop().unwrap();
        assert_eq!(owner.active().unwrap(), 0);
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.as_raw_handle(), 2000) },
            0
        );
        child.wait().unwrap();
        fs::remove_file(marker).unwrap();
    }
    #[test]
    fn owner_abnormal_exit_closes_noninherited_job_and_kills_child() {
        let marker = marker();
        let mut owner_process = command("owner", &marker).spawn().unwrap();
        release(&mut owner_process);
        let child = process(await_pid(&marker));
        owner_process.kill().unwrap();
        owner_process.wait().unwrap();
        assert_eq!(
            unsafe { WaitForSingleObject(child.as_raw_handle(), 2000) },
            0
        );
        fs::remove_file(marker).unwrap();
    }
}

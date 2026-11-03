//! Real Windows handle-inheritance regression. The holder is deliberately in a
//! second test-owned Job: this models an accidentally inherited endpoint without
//! claiming that any particular production process was the historical holder.
use super::confine;
use std::{
    ffi::OsStr,
    fs::File,
    io::{self, Read, Write},
    mem::size_of,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    ptr::{null, null_mut},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::SECURITY_ATTRIBUTES,
    System::{JobObjects::*, Pipes::CreatePipe, Threading::*, IO::CancelSynchronousIo},
};

const CHILD_TEST: &str = "protocol_handles::tests::fixed_inherited_handle_holder";

fn check(result: i32) -> io::Result<()> {
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

unsafe fn own(raw: HANDLE) -> io::Result<OwnedHandle> {
    if raw.is_null() || raw == INVALID_HANDLE_VALUE {
        Err(io::Error::last_os_error())
    } else {
        Ok(OwnedHandle::from_raw_handle(raw))
    }
}

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

/// Initially neither endpoint may leak into an unrelated concurrent spawn.
fn pipe(parent_reads: bool) -> io::Result<(File, OwnedHandle)> {
    let mut read = null_mut();
    let mut write = null_mut();
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 0,
    };
    check(unsafe { CreatePipe(&mut read, &mut write, &attributes, 4096) })?;
    let (read, write) = unsafe { (own(read)?, own(write)?) };
    let (parent, child) = if parent_reads {
        (read, write)
    } else {
        (write, read)
    };
    Ok((File::from(parent), child))
}

struct Attributes {
    _storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}

impl Attributes {
    fn new(job: &HANDLE) -> io::Result<Self> {
        let mut size = 0;
        unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size) };
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut storage = vec![0usize; size.div_ceil(size_of::<usize>())];
        let pointer = storage.as_mut_ptr().cast();
        check(unsafe { InitializeProcThreadAttributeList(pointer, 1, 0, &mut size) })?;
        let attributes = Self {
            _storage: storage,
            pointer,
        };
        check(unsafe {
            UpdateProcThreadAttribute(
                pointer,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                (job as *const HANDLE).cast(),
                size_of::<HANDLE>(),
                null_mut(),
                null(),
            )
        })?;
        Ok(attributes)
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.pointer) };
    }
}

struct Child {
    job: OwnedHandle,
    process: OwnedHandle,
    stopped: bool,
}

impl Child {
    /// The executable and test name are fixed. No shell, external program,
    /// elevation, Runtime, credentials or caller-provided command is involved.
    fn spawn(standard_handles: Option<[HANDLE; 3]>) -> io::Result<Self> {
        let job = unsafe { own(CreateJobObjectW(null(), null()))? };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.BasicLimitInformation.ActiveProcessLimit = 1;
        check(unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        })?;
        let raw_job = job.as_raw_handle();
        let attributes = Attributes::new(&raw_job)?;
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.lpAttributeList = attributes.pointer;
        if let Some(handles) = standard_handles {
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = handles[0];
            startup.StartupInfo.hStdOutput = handles[1];
            startup.StartupInfo.hStdError = handles[2];
        }
        let executable = std::env::current_exe()?;
        let application = wide(&executable);
        let mut command = wide(format!(
            "\"{}\" --exact {CHILD_TEST} --ignored --nocapture --test-threads=1",
            executable.display()
        ));
        let mut info = PROCESS_INFORMATION::default();
        // Deliberate generic inheritance, with no HANDLE_LIST. This is the
        // condition under test; production still uses its exact three-handle
        // allowlist and its original zero-capability creation attributes.
        check(unsafe {
            CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
                null(),
                null(),
                &startup.StartupInfo,
                &mut info,
            )
        })?;
        let child = Self {
            job,
            process: unsafe { own(info.hProcess)? },
            stopped: false,
        };
        let primary_thread = unsafe { own(info.hThread)? };
        if unsafe { ResumeThread(primary_thread.as_raw_handle()) } == u32::MAX {
            return Err(io::Error::last_os_error());
        }
        Ok(child)
    }

    fn alive(&self) -> bool {
        (unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) }) == WAIT_TIMEOUT
    }

    fn stop(&mut self) -> io::Result<()> {
        check(unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) })?;
        if unsafe { WaitForSingleObject(self.process.as_raw_handle(), 2000) } != WAIT_OBJECT_0 {
            return Err(io::Error::other(
                "Test child did not signal after owned Job stop",
            ));
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            check(unsafe {
                QueryInformationJobObject(
                    self.job.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    null_mut(),
                )
            })?;
            if accounting.ActiveProcesses == 0 {
                self.stopped = true;
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(io::Error::other(
                    "Test Job did not reach zero active processes",
                ));
            }
            thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for Child {
    fn drop(&mut self) {
        if !self.stopped {
            // Only our retained Job/process handles, never a PID lookup/kill.
            unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) };
            unsafe { WaitForSingleObject(self.process.as_raw_handle(), 2000) };
        }
    }
}

struct Reader(Option<thread::JoinHandle<io::Result<usize>>>);

impl Reader {
    fn start(pipe: File) -> Self {
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let thread = thread::spawn(move || {
            let mut bytes = Vec::new();
            started_tx.send(()).unwrap();
            // Only the fixed test harness can write here. Bound its output and
            // reject reaching the cap so a truncated read is never called EOF.
            pipe.take(4097).read_to_end(&mut bytes).and_then(|count| {
                if count > 4096 {
                    Err(io::Error::other("Fixed fixture output exceeded its bound"))
                } else {
                    Ok(count)
                }
            })
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        Self(Some(thread))
    }

    fn pending(&self) -> bool {
        !self.0.as_ref().unwrap().is_finished()
    }

    fn cancel(&self) -> io::Result<()> {
        let thread = self.0.as_ref().unwrap();
        let deadline = Instant::now() + Duration::from_millis(250);
        loop {
            if unsafe { CancelSynchronousIo(thread.as_raw_handle()) } != 0 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            // A test worker can be descheduled between its start signal and
            // ReadFile. Retry only the absence of current I/O, never a result.
            if error.raw_os_error() != Some(ERROR_NOT_FOUND as i32)
                || thread.is_finished()
                || Instant::now() >= deadline
            {
                return Err(error);
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn join(mut self) -> io::Result<usize> {
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.pending() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!self.pending(), "Owned test pipe read did not finish");
        self.0.take().unwrap().join().unwrap()
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        if let Some(thread) = self.0.take() {
            if !thread.is_finished() {
                unsafe { CancelSynchronousIo(thread.as_raw_handle()) };
                let deadline = Instant::now() + Duration::from_millis(250);
                while !thread.is_finished() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(5));
                }
            }
            if thread.is_finished() {
                let _ = thread.join();
            }
        }
    }
}

#[test]
#[ignore = "fixed child entry for owned inheritance regression only"]
fn fixed_inherited_handle_holder() {
    // Parent kills the retained test Job; this independent upper bound prevents
    // an orphan if the test driver itself dies before its kill-on-close runs.
    thread::sleep(Duration::from_secs(30));
    std::process::exit(0);
}

#[test]
fn confinement_rejects_invalid_alias_and_nonpipe_before_changing_valid_handles() {
    let (_input, child_input) = pipe(false).unwrap();
    let (mut output, child_output) = pipe(true).unwrap();
    let (_error, child_error) = pipe(true).unwrap();
    let handles = [
        child_input.as_raw_handle(),
        child_output.as_raw_handle(),
        child_error.as_raw_handle(),
    ];
    for handle in handles {
        check(unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) })
            .unwrap();
    }
    let job = unsafe { own(CreateJobObjectW(null(), null())).unwrap() };
    for bad in [
        null_mut(),
        INVALID_HANDLE_VALUE,
        handles[0],
        job.as_raw_handle(),
    ] {
        assert!(confine([handles[0], bad, handles[2]]).is_err());
        for handle in handles {
            let mut flags = 0;
            check(unsafe { GetHandleInformation(handle, &mut flags) }).unwrap();
            assert_ne!(flags & HANDLE_FLAG_INHERIT, 0);
        }
    }
    confine(handles).unwrap();
    for handle in handles {
        let mut flags = 0;
        check(unsafe { GetHandleInformation(handle, &mut flags) }).unwrap();
        assert_eq!(flags & HANDLE_FLAG_INHERIT, 0);
    }
    let mut writer = File::from(child_output);
    writer.write_all(b"protocol remains usable").unwrap();
    drop(writer);
    let mut bytes = Vec::new();
    output.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"protocol remains usable");
}

#[test]
fn confined_protocol_handles_prevent_generic_child_from_holding_pipe_eof() {
    for confined in [false, true] {
        let (input, child_input) = pipe(false).unwrap();
        let (output, child_output) = pipe(true).unwrap();
        let (error, child_error) = pipe(true).unwrap();
        let handles = [
            child_input.as_raw_handle(),
            child_output.as_raw_handle(),
            child_error.as_raw_handle(),
        ];
        for handle in handles {
            check(unsafe {
                SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)
            })
            .unwrap();
        }
        let mut renderer = Child::spawn(Some(handles)).unwrap();
        if confined {
            // The test process stands in for the fixed helper here: it owns the
            // exact three handles and confines them before a generic child spawn.
            confine(handles).unwrap();
        }
        let mut holder = Child::spawn(None).unwrap();
        drop((input, child_input, child_output, child_error));
        let stdout = Reader::start(output);
        let stderr = Reader::start(error);
        renderer.stop().unwrap();
        assert!(
            holder.alive(),
            "The separate owned holder must still be running"
        );
        let (stdout_error, stderr_error) = if confined {
            stdout.join().unwrap();
            stderr.join().unwrap();
            assert!(holder.alive(), "EOF must precede holder exit");
            (None, None)
        } else {
            thread::sleep(Duration::from_millis(50));
            assert!(stdout.pending() && stderr.pending());
            stdout.cancel().unwrap();
            stderr.cancel().unwrap();
            let stdout_error = stdout.join().unwrap_err().raw_os_error();
            let stderr_error = stderr.join().unwrap_err().raw_os_error();
            assert_eq!(stdout_error, Some(995));
            assert_eq!(stderr_error, Some(995));
            assert!(holder.alive());
            (stdout_error, stderr_error)
        };
        holder.stop().unwrap();
        println!(
            "MILKUP_PROTOCOL_INHERITANCE {}",
            serde_json::json!({
                "scope":"generic-child-inheritance-mechanism; test parent stands in for helper",
                "confined":confined,
                "rendererJobActiveAfterStop":0,
                "rendererHeldProcessSignaled":renderer.stopped,
                "holderAliveAtPipeResult":true,
                "stdoutEof":stdout_error.is_none(),
                "stderrEof":stderr_error.is_none(),
                "stdoutWin32Error":stdout_error,
                "stderrWin32Error":stderr_error,
                "holderJobActiveAfterStop":0,
                "holderHeldProcessSignaled":holder.stopped,
                "historicalHolderIdentified":false
            })
        );
    }
}

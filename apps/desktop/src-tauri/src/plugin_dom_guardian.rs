//! Dedicated single-instance native cleanup guardian. No GTK initialization,
//! JavaScript, resource loading, or plugin command parsing occurs in this process.
//! The editor is the deadline authority; FD4 is its separate nonblocking stop
//! channel. Closing its sole writer (including editor SIGKILL) also revokes it.
use super::*;
use std::{
    fs::File,
    os::fd::{AsRawFd, FromRawFd},
    time::Instant,
};

pub(super) fn run() {
    let result = run_inner();
    if let Some(path) = std::env::var_os("MILKUP_INTERNAL_DOM_GUARD_DIR") {
        helper::PrivateDirectory(std::path::PathBuf::from(path)).cleanup();
    }
    if let Err(error) = result {
        eprintln!("DOM guardian cleanup failed: {error}");
        std::process::exit(1);
    }
}
fn run_inner() -> Result<(), String> {
    supervise(helper::run)
}
pub(crate) fn supervise(renderer: fn()) -> Result<(), String> {
    if unsafe { libc::fcntl(4, libc::F_GETFD) } < 0 {
        return Err("Missing dedicated DOM stop channel".into());
    }
    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let child = unsafe { libc::fork() };
    if child < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if child == 0 {
        // The renderer never receives its owner's stop reader or writer. Only
        // stdin and FD3 cross into this child, and helper marks both CLOEXEC.
        unsafe {
            libc::close(4);
        }
        if unsafe { libc::setpgid(0, 0) } != 0 {
            std::process::exit(1);
        }
        renderer();
        std::process::exit(0);
    }
    // Complete the process-group assignment even if this side runs first.
    unsafe {
        libc::setpgid(child, child);
        libc::close(0);
        libc::close(3);
    }
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, child, 0) as i32 };
    if fd < 0 {
        let error = std::io::Error::last_os_error().to_string();
        let _ = cleanup(child);
        return Err(format!(
            "Cannot observe exact renderer process identity: {error}"
        ));
    }
    let child_identity = unsafe { File::from_raw_fd(fd) };
    let mut poll = [
        libc::pollfd {
            fd: 4,
            events: libc::POLLIN | libc::POLLHUP | libc::POLLERR,
            revents: 0,
        },
        libc::pollfd {
            fd: child_identity.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        },
    ];
    loop {
        let result = unsafe { libc::poll(poll.as_mut_ptr(), poll.len() as libc::nfds_t, -1) };
        if result > 0 {
            break;
        }
        if result < 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR) {
            break;
        }
    }
    cleanup(child)
}
fn cleanup(renderer_group: i32) -> Result<(), String> {
    // The direct renderer leader has not been reaped, so its PID cannot be
    // reused here. SIGKILL the whole renderer group before scanning or waiting.
    native_trace("kill-start", None, None);
    unsafe {
        libc::kill(-renderer_group, libc::SIGKILL);
        libc::kill(renderer_group, libc::SIGKILL);
    }
    let own_pid = unsafe { libc::getpid() };
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut reported = false;
    loop {
        // This process has exactly one owned renderer tree. Orphans that leave
        // its process group reparent here, even if never sampled before stop.
        let table = process::proc_table();
        let mut owned = std::collections::HashSet::from([own_pid]);
        loop {
            let extra: Vec<_> = table
                .iter()
                .filter(|(pid, p)| !owned.contains(pid) && owned.contains(&p.parent))
                .map(|(pid, _)| *pid)
                .collect();
            if extra.is_empty() {
                break;
            }
            owned.extend(extra);
        }
        for pid in owned.into_iter().filter(|pid| *pid != own_pid) {
            if let Some(stat) = table.get(&pid) {
                if let Err(error) = process::signal_exact(pid, stat.birth) {
                    if !reported {
                        eprintln!("DOM guardian cleanup is still pending: {error}");
                        reported = true;
                    }
                }
            }
        }
        // Unlike the editor, this guardian owns *all* of its children; waitpid
        // -1 is confined to its single renderer task and cannot steal siblings.
        let mut no_children = false;
        loop {
            let result = unsafe { libc::waitpid(-1, std::ptr::null_mut(), libc::WNOHANG) };
            if result > 0 {
                continue;
            }
            if result < 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD) {
                no_children = true;
            }
            break;
        }
        if no_children {
            native_trace("cleanup-complete", None, None);
            return Ok(());
        }
        if Instant::now() >= deadline && !reported {
            eprintln!(
                "DOM guardian cleanup exceeded its budget; guardian remains alive until ECHILD"
            );
            reported = true;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::os::unix::process::CommandExt;
    #[test]
    #[ignore = "private subprocess fixture, launched by the guardian ownership test"]
    fn guardian_escape_worker() {
        assert_eq!(
            std::env::var("MILKUP_DOM_GUARDIAN_FIXTURE").as_deref(),
            Ok("1")
        );
        fn child() {
            // Async-signal-safe exec immediately after fork in this test runner;
            // the real internal guardian forks before any GTK or application threads.
            unsafe {
                libc::execlp(c"python3".as_ptr(), c"python3".as_ptr(), c"-u".as_ptr(), c"-c".as_ptr(), c"import os,time\np=os.fork()\nif p==0:\n os.setsid()\n print('ESCAPED '+str(os.getpid()),flush=True)\n while True: time.sleep(1)\nwhile True: time.sleep(1)".as_ptr(), std::ptr::null::<libc::c_char>());
                libc::_exit(127);
            }
        }
        supervise(child).unwrap();
    }
    #[test]
    fn guardian_adopts_unsampled_escaped_descendant_on_control_eof() {
        let mut pipe = [-1; 2];
        assert_eq!(
            unsafe { libc::pipe2(pipe.as_mut_ptr(), libc::O_CLOEXEC) },
            0
        );
        let read = unsafe { File::from_raw_fd(pipe[0]) };
        let write = unsafe { File::from_raw_fd(pipe[1]) };
        let fd = read.as_raw_fd();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "plugin_dom::guardian::tests::guardian_escape_worker",
                "--exact",
                "--ignored",
                "--test-threads=1",
                "--nocapture",
            ])
            .env("MILKUP_DOM_GUARDIAN_FIXTURE", "1")
            .stdout(std::process::Stdio::piped());
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(fd, 4) < 0 || libc::fcntl(4, libc::F_SETFD, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut guardian = command.spawn().unwrap();
        drop(read);
        let mut output = BufReader::new(guardian.stdout.take().unwrap());
        let escaped = loop {
            let mut line = String::new();
            assert!(
                output.read_line(&mut line).unwrap() > 0,
                "fixture closed before escaped child appeared"
            );
            if let Some((_, pid)) = line.split_once("ESCAPED ") {
                break pid.trim().parse::<i32>().unwrap();
            }
        };
        let birth = process::proc_table().get(&escaped).unwrap().birth;
        // No parent-side sampling or pre-registration of this PID. EOF happens
        // immediately after setsid; dedicated guardian adoption establishes ownership.
        drop(write);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = guardian.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            assert!(Instant::now() < deadline, "guardian did not finish");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!process::proc_table()
            .get(&escaped)
            .is_some_and(|p| p.birth == birth));
    }
}

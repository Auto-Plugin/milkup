//! Trusted native picker in its own bounded process; it never receives HTML.
use super::*;
use crate::windows_process::ProcessJob;
use ::windows::{
    core::{w, PCWSTR},
    Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{
            Common::COMDLG_FILTERSPEC, FileSaveDialog, IFileSaveDialog, FOS_DONTADDTORECENT,
            FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_NODEREFERENCELINKS, FOS_NOTESTFILECREATE,
            FOS_OVERWRITEPROMPT, FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH,
        },
    },
};
use std::{
    io::{BufReader, Read, Write},
    os::windows::process::CommandExt,
    process::{Command, Stdio},
    sync::mpsc,
};
struct Apartment;
impl Apartment {
    fn enter() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(error)?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
fn configured_dialog(name: &str) -> Result<IFileSaveDialog> {
    unsafe {
        let dialog: IFileSaveDialog =
            CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER).map_err(error)?;
        // In particular, never let the picker probe-create/truncate a selected
        // file before the host has protected source/open-document identities.
        dialog
            .SetOptions(
                FOS_FORCEFILESYSTEM
                    | FOS_PATHMUSTEXIST
                    | FOS_OVERWRITEPROMPT
                    | FOS_NOCHANGEDIR
                    | FOS_NOTESTFILECREATE
                    | FOS_DONTADDTORECENT
                    | FOS_NODEREFERENCELINKS,
            )
            .map_err(error)?;
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        dialog.SetFileName(PCWSTR(name.as_ptr())).map_err(error)?;
        dialog.SetTitle(w!("Export HTML")).map_err(error)?;
        dialog.SetDefaultExtension(w!("html")).map_err(error)?;
        dialog
            .SetFileTypes(&[COMDLG_FILTERSPEC {
                pszName: w!("HTML"),
                pszSpec: w!("*.html"),
            }])
            .map_err(error)?;
        Ok(dialog)
    }
}
fn select_path(name: &str) -> Result<Option<PathBuf>> {
    let _apartment = Apartment::enter()?;
    let dialog = configured_dialog(name)?;
    unsafe {
        if let Err(failure) = dialog.Show(None) {
            return if failure.code().0 as u32 == 0x800704c7 {
                Ok(None)
            } else {
                Err(error(failure))
            };
        }
        let item = dialog.GetResult().map_err(error)?;
        let path = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(error)?;
        let result = path.to_string().map(PathBuf::from).map_err(error);
        CoTaskMemFree(Some(path.0.cast()));
        result.map(Some)
    }
}

fn read_frame<T: serde::de::DeserializeOwned>(reader: &mut impl Read, limit: usize) -> Result<T> {
    let mut length = [0; 4];
    reader.read_exact(&mut length).map_err(error)?;
    let length = u32::from_le_bytes(length) as usize;
    if length > limit {
        return Err("Windows picker frame exceeds budget".into());
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(error)?;
    serde_json::from_slice(&bytes).map_err(error)
}
fn write_frame(writer: &mut impl Write, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(error)?;
    writer
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(error)
}
pub(in crate::output) fn run_helper() {
    let result = (|| -> Result<()> {
        // This read is before COM initialization or any child creation. The
        // owner writes the bounded filename only after successful Job assignment.
        let name: String = read_frame(&mut std::io::stdin().lock(), 1024)?;
        if name.is_empty()
            || name.len() > 512
            || name.chars().any(|c| c.is_control() || "\\/:".contains(c))
        {
            return Err("Invalid picker filename".into());
        }
        let path = select_path(&name)?;
        write_frame(&mut std::io::stdout().lock(), &path)
    })();
    std::process::exit(if result.is_ok() { 0 } else { 1 });
}
fn receive_selection(job: &Arc<Job>, mut command: Command, name: &str) -> Result<Option<PathBuf>> {
    job.active()?;
    let owner = ProcessJob::new()?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000); // CREATE_NO_WINDOW
    #[cfg(test)]
    command.stderr(Stdio::piped()); // Rust test harness owns stdout in fixtures.
    let mut child = command.spawn().map_err(error)?;
    owner.assign(&mut child)?;
    let mut input = child.stdin.take().ok_or("Missing picker input pipe")?;
    #[cfg(not(test))]
    let output = child.stdout.take().ok_or("Missing picker result pipe")?;
    #[cfg(test)]
    let output = child.stderr.take().ok_or("Missing fixture result pipe")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        let result = read_frame::<Option<PathBuf>>(&mut BufReader::new(output), 65536);
        let _ = sender.send(result);
    });
    let result = (|| {
        write_frame(&mut input, &name)?;
        drop(input);
        loop {
            job.active()?;
            match receiver.recv_timeout(Duration::from_millis(20)) {
                Ok(result) => {
                    job.active()?;
                    return result;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Err("Windows picker exited without a complete selection".into()),
            }
        }
    })();
    // Termination/empty-job proof happens before exposing even a successful path.
    // Dropping the non-inherited owner handle also kills helpers on host death.
    owner.stop()?;
    child.wait().map_err(error)?;
    reader.join().map_err(|_| "Windows picker reader failed")?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "output::windows::picker::tests::fixture",
                "--exact",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("MILKUP_PICKER_FIXTURE_MODE", mode);
        command
    }
    fn lease() -> Arc<Job> {
        Arc::new(Job {
            format: Format::Html,
            source: None,
            source_identity: None,
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            state: Mutex::new(JobState::Choosing),
        })
    }
    #[test]
    fn actual_native_dialog_configuration_disables_probe_writes_and_link_resolution() {
        let _apartment = Apartment::enter().unwrap();
        let dialog = configured_dialog("中文 😀.html").unwrap();
        let options = unsafe { dialog.GetOptions().unwrap() };
        for required in [
            FOS_NOTESTFILECREATE,
            FOS_NODEREFERENCELINKS,
            FOS_FORCEFILESYSTEM,
            FOS_NOCHANGEDIR,
            FOS_OVERWRITEPROMPT,
            FOS_PATHMUSTEXIST,
            FOS_DONTADDTORECENT,
        ] {
            assert_eq!(options.0 & required.0, required.0);
        }
        // Deliberately no Show(): this verifies native configuration, not GUI.
    }
    #[test]
    #[ignore = "private pipe fixture; executed by actual Windows picker protocol tests"]
    fn fixture() {
        let Ok(mode) = std::env::var("MILKUP_PICKER_FIXTURE_MODE") else {
            return;
        };
        let _: String = read_frame(&mut std::io::stdin().lock(), 1024).unwrap();
        match mode.as_str() {
            "cancel" => {
                write_frame(&mut std::io::stderr().lock(), &Option::<PathBuf>::None).unwrap()
            }
            "oversize" => std::io::stderr()
                .write_all(&65537u32.to_le_bytes())
                .unwrap(),
            "partial" => std::io::stderr().write_all(&[10, 0, 0, 0, b'"']).unwrap(),
            "hang" => loop {
                std::thread::sleep(Duration::from_secs(1));
            },
            _ => panic!("unknown fixture"),
        }
        std::process::exit(0);
    }
    #[test]
    fn bounded_picker_protocol_accepts_cancel_and_rejects_truncated_or_oversized_frames() {
        assert!(receive_selection(&lease(), command("cancel"), "test.html")
            .unwrap()
            .is_none());
        for mode in ["partial", "oversize"] {
            assert!(receive_selection(&lease(), command(mode), "test.html").is_err());
        }
    }
    #[test]
    fn cancelled_picker_is_killed_before_returning_any_authorization() {
        let job = lease();
        let cancel = job.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            cancel.cancelled.store(true, Ordering::Release);
        });
        let start = Instant::now();
        let rejection = receive_selection(&job, command("hang"), "test.html").unwrap_err();
        canceller.join().unwrap();
        assert!(rejection.contains("cancelled"), "{rejection}");
        assert!(start.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn picker_deadline_expires_while_helper_is_running_and_old_lease_cannot_retry() {
        let mut job = lease();
        Arc::get_mut(&mut job).unwrap().created =
            Instant::now() - LEASE + Duration::from_millis(100);
        let start = Instant::now();
        assert!(receive_selection(&job, command("hang"), "test.html")
            .unwrap_err()
            .contains("expired"));
        assert!(start.elapsed() < Duration::from_secs(3));
        assert!(receive_selection(&job, command("cancel"), "test.html").is_err());
    }
}
pub(in crate::output) fn choose_target(job: &Arc<Job>, title: String) -> Result<Option<Target>> {
    if job.format != Format::Html {
        return Err("Native Windows PDF output is not available on this platform".into());
    }
    let name: String = title
        .chars()
        .filter(|c| !c.is_control() && !"\\/:<>\"|?*".contains(*c))
        .take(100)
        .collect();
    let name = format!(
        "{}.html",
        if name.trim_matches([' ', '.']).is_empty() {
            "document"
        } else {
            name.trim_end_matches([' ', '.'])
        }
    );
    let mut command = Command::new(std::env::current_exe().map_err(error)?);
    command.arg("--milkup-internal-output-helper");
    let path = receive_selection(job, command, &name)?;
    job.active()?;
    path.map(|p| Target::adopt(&p, job.source.as_deref()))
        .transpose()
}

//! Static document rendering and native print submission in an isolated helper. The
//! existing native guardian owns every descendant and observes parent EOF.
use super::*;
use glib::translate::{from_glib_full, from_glib_none, ToGlibPtr};
use gtk::prelude::DialogExt as GtkDialogExt;
use gtk::{gio, glib, prelude::*};
use std::{
    cell::RefCell,
    io::BufReader,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            fs::{DirBuilderExt, OpenOptionsExt},
            process::CommandExt,
        },
    },
    process::{Command, Stdio},
    rc::Rc,
    sync::mpsc,
};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    html: String,
    page_size: PageSize,
    landscape: bool,
    print: bool,
    choose: Option<String>,
    directory: PathBuf,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Event {
    Dialog,
    Selection { path: PathBuf },
    Rendering,
    Pdf,
    Printed,
    Submitting,
    Cancelled,
    Chosen,
    Failed { error: String },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SelectionAck {
    overwrite: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SubmissionAck {
    submit: bool,
}
struct Private(PathBuf);
impl Private {
    fn new() -> Result<Self> {
        let path = std::env::temp_dir().join(crate::workspace::id("milkup-output")?);
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(error)?;
        let private = Self(path);
        Ok(private)
    }
}
impl Drop for Private {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn frame_write(writer: &mut impl Write, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(error)?;
    writer
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(error)
}
fn frame_read<T: serde::de::DeserializeOwned>(reader: &mut impl Read, limit: usize) -> Result<T> {
    let mut length = [0; 4];
    reader.read_exact(&mut length).map_err(error)?;
    let length = u32::from_le_bytes(length) as usize;
    if length > limit {
        return Err("Native output frame exceeds its budget".into());
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(error)?;
    serde_json::from_slice(&bytes).map_err(error)
}

pub(super) fn render(
    job: &Arc<Job>,
    html: String,
    page_size: PageSize,
    landscape: bool,
) -> Result<NativeResult> {
    render_with_executable(
        job,
        html,
        page_size,
        landscape,
        std::env::current_exe().map_err(error)?,
        false,
        None,
    )
}
pub(super) fn choose_target(job: &Arc<Job>, title: String) -> Result<Option<Target>> {
    let title: String = title
        .chars()
        .filter(|c| !c.is_control() && !"/\\:".contains(*c))
        .take(100)
        .collect();
    let name = format!(
        "{}.{}",
        if title.is_empty() { "document" } else { &title },
        if job.format == Format::Html {
            "html"
        } else {
            "pdf"
        }
    );
    match render_with_executable(
        job,
        String::new(),
        PageSize::A4,
        false,
        std::env::current_exe().map_err(error)?,
        false,
        Some(name),
    )? {
        NativeResult::Chosen(target) => Ok(Some(target)),
        NativeResult::Cancelled => Ok(None),
        _ => Err("Output picker did not return a selection".into()),
    }
}
fn render_with_executable(
    job: &Arc<Job>,
    html: String,
    page_size: PageSize,
    landscape: bool,
    executable: PathBuf,
    fixture: bool,
    choose: Option<String>,
) -> Result<NativeResult> {
    let private = Private::new()?;
    let mut result_fds = [-1; 2];
    let mut stop_fds = [-1; 2];
    if unsafe { libc::pipe2(result_fds.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    let reader = unsafe { File::from_raw_fd(result_fds[0]) };
    let writer = unsafe { File::from_raw_fd(result_fds[1]) };
    if unsafe { libc::pipe2(stop_fds.as_mut_ptr(), libc::O_CLOEXEC | libc::O_NONBLOCK) } != 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    let stop_reader = unsafe { File::from_raw_fd(stop_fds[0]) };
    let stop_writer = unsafe { File::from_raw_fd(stop_fds[1]) };
    let result_fd = writer.as_raw_fd();
    let stop_fd = stop_reader.as_raw_fd();
    let mut command = Command::new(executable);
    if fixture {
        command
            .args([
                "output::linux::tests::native_output_helper",
                "--exact",
                "--ignored",
                "--test-threads=1",
            ])
            .env("MILKUP_OUTPUT_TEST_HELPER", "1");
    } else {
        command.arg("--milkup-internal-output-helper");
    }
    command
        .env("MILKUP_INTERNAL_OUTPUT_DIRECTORY", &private.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    let parent = unsafe { libc::getpid() };
    unsafe {
        command.pre_exec(move || {
            if libc::setsid() < 0 || libc::getppid() != parent {
                return Err(std::io::Error::last_os_error());
            }
            // Duplicate above the reserved descriptors first: either source pipe
            // may otherwise occupy FD3 or FD4 before the first dup2 overwrites it.
            let result_copy = libc::fcntl(result_fd, libc::F_DUPFD_CLOEXEC, 5);
            let stop_copy = libc::fcntl(stop_fd, libc::F_DUPFD_CLOEXEC, 5);
            if result_copy < 0
                || stop_copy < 0
                || libc::dup2(result_copy, 3) < 0
                || libc::dup2(stop_copy, 4) < 0
            {
                return Err(std::io::Error::last_os_error());
            }
            libc::close(result_copy);
            libc::close(stop_copy);
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(error)?;
    drop(writer);
    drop(stop_reader);
    let mut input = child
        .stdin
        .take()
        .ok_or("Output helper input unavailable")?;
    let choosing = choose.is_some();
    let snapshot = Input {
        html,
        page_size,
        landscape,
        print: job.format == Format::Print,
        choose,
        directory: private.0.clone(),
    };
    // The helper reads the immutable snapshot before GTK initialization. The
    // owner never waits on this write while enforcing cancellation/deadlines.
    let (input_send, input_receive) = mpsc::channel();
    std::thread::spawn(move || {
        let result = frame_write(&mut input, &snapshot);
        let _ = input_send.send((input, result));
    });
    let (send, receive) = mpsc::sync_channel(4);
    std::thread::spawn(move || {
        let mut reader = reader;
        loop {
            let event = frame_read::<Event>(&mut reader, 16384);
            let finished = event.is_err()
                || matches!(
                    event,
                    Ok(Event::Pdf
                        | Event::Printed
                        | Event::Cancelled
                        | Event::Chosen
                        | Event::Failed { .. })
                );
            if send.send(event).is_err() || finished {
                break;
            }
        }
    });
    let mut deadline = Instant::now() + Duration::from_secs(60);
    let mut target = None;
    let mut helper_input = None;
    let mut submitting = false;
    let result = (|| loop {
        if !submitting {
            job.active()?;
        }
        if Instant::now() >= deadline {
            return Err("Native output exceeded its deadline".into());
        }
        match receive.recv_timeout(Duration::from_millis(25)) {
            Ok(Ok(Event::Dialog)) => {
                if submitting || (job.format != Format::Print && !choosing) {
                    return Err("Unexpected output dialog".into());
                }
                deadline = Instant::now() + LEASE;
            }
            Ok(Ok(Event::Selection { path })) => {
                if submitting || (job.format != Format::Print && !choosing) || target.is_some() {
                    return Err("Unexpected print destination".into());
                }
                let chosen = Target::adopt(&path, job.source.as_deref())?;
                job.protect_target(&chosen)?;
                if helper_input.is_none() {
                    let (input, result) = input_receive
                        .recv_timeout(Duration::from_secs(1))
                        .map_err(error)?;
                    result?;
                    helper_input = Some(input);
                }
                frame_write(
                    helper_input.as_mut().unwrap(),
                    &SelectionAck {
                        overwrite: chosen.initial.is_some(),
                    },
                )?;
                target = Some(chosen);
            }
            Ok(Ok(Event::Rendering)) => {
                if submitting {
                    return Err("Unexpected render after print submission".into());
                }
                deadline = Instant::now() + Duration::from_secs(60);
            }
            Ok(Ok(Event::Submitting)) => {
                if choosing || target.is_some() || submitting {
                    return Err("Unexpected print submission".into());
                }
                if helper_input.is_none() {
                    let (input, result) = input_receive
                        .recv_timeout(Duration::from_secs(1))
                        .map_err(error)?;
                    result?;
                    helper_input = Some(input);
                }
                job.begin_submission()?;
                submitting = true;
                deadline = Instant::now() + Duration::from_secs(30);
                frame_write(
                    helper_input.as_mut().unwrap(),
                    &SubmissionAck { submit: true },
                )?;
            }
            Ok(Ok(Event::Pdf)) => {
                if submitting {
                    return Err("Unexpected PDF after print submission".into());
                }
                let path = private.0.join("document.pdf");
                let mut file = fs::OpenOptions::new()
                    .read(true)
                    .custom_flags(libc::O_NOFOLLOW)
                    .open(path)
                    .map_err(error)?;
                let metadata = file.metadata().map_err(error)?;
                if !metadata.is_file() || metadata.len() > MAX_PDF as u64 {
                    return Err("Native PDF exceeds its 64 MiB budget".into());
                }
                let mut bytes = Vec::new();
                std::io::Read::by_ref(&mut file)
                    .take(MAX_PDF as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(error)?;
                if bytes.len() > MAX_PDF
                    || !bytes.starts_with(b"%PDF-")
                    || !bytes.windows(5).any(|b| b == b"%%EOF")
                {
                    return Err("Native output is not a complete PDF".into());
                }
                return Ok(NativeResult::Pdf(bytes, target));
            }
            Ok(Ok(Event::Printed)) if submitting => return Ok(NativeResult::Printed),
            Ok(Ok(Event::Printed)) => return Err("Print submission acknowledgement missing".into()),
            Ok(Ok(Event::Chosen)) => {
                let chosen = target.take().ok_or("Output selection missing")?;
                chosen.verify(job.source.as_deref())?;
                return Ok(NativeResult::Chosen(chosen));
            }
            Ok(Ok(Event::Cancelled)) if !submitting => return Ok(NativeResult::Cancelled),
            Ok(Ok(Event::Cancelled)) => {
                return Err("Unexpected result after print submission".into())
            }
            Ok(Ok(Event::Failed { error })) => return Err(error),
            Ok(Err(e)) => return Err(e),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => return Err(error(e)),
        }
    })()
    .map_err(|e| {
        if submitting {
            submission_uncertain(e)
        } else {
            e
        }
    });
    drop(stop_writer);
    drop(helper_input);
    // Never kill the guardian ahead of its owned-descendant cleanup.
    let cleanup_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() && result.is_ok() {
                    if matches!(result, Ok(NativeResult::Printed)) {
                        eprintln!("Print submitted; output guardian reported incomplete cleanup. Private stage retained: {}", private.0.display());
                        std::mem::forget(private);
                        return result;
                    }
                    return Err("Output guardian reported incomplete cleanup".into());
                }
                break;
            }
            Err(e) => {
                if matches!(result, Ok(NativeResult::Printed)) {
                    eprintln!("Print submitted; output cleanup could not be confirmed: {e}. Private stage retained: {}", private.0.display());
                    std::mem::forget(private);
                    return result;
                }
                return Err(if submitting {
                    submission_uncertain(e)
                } else {
                    error(e)
                });
            }
            _ => {}
        }
        if Instant::now() >= cleanup_deadline {
            let printed = matches!(result, Ok(NativeResult::Printed));
            eprintln!(
                "Output cleanup pending; private stage retained: {}",
                private.0.display()
            );
            std::mem::forget(private);
            return if printed {
                result
            } else if submitting {
                Err(submission_uncertain(
                    "Output cleanup is still pending; private files retained",
                ))
            } else {
                Err("Output cleanup is still pending; private files retained".into())
            };
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    result
}

pub(super) fn run_guarded() {
    let owner = unsafe { libc::getppid() };
    let result = crate::plugin_dom::supervise_native_output(helper);
    // A live owner consumes the PDF before removing this directory. If the
    // editor died, the guardian owns cleanup of the abandoned private stage.
    if unsafe { libc::getppid() } != owner {
        if let Some(directory) = std::env::var_os("MILKUP_INTERNAL_OUTPUT_DIRECTORY") {
            let path = PathBuf::from(directory);
            if path.parent() == Some(std::env::temp_dir().as_path())
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("milkup-output-"))
            {
                let _ = fs::remove_dir_all(path);
            }
        }
    }
    if let Err(e) = result {
        eprintln!("Output guardian failed: {e}");
        std::process::exit(1);
    }
}
fn helper() {
    // Neither snapshot/result descriptors are inherited by the renderer.
    for fd in [0, 3] {
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return;
        }
    }
    let output = Rc::new(RefCell::new(unsafe { File::from_raw_fd(3) }));
    if let Err(e) = helper_inner(output.clone()) {
        let _ = frame_write(&mut *output.borrow_mut(), &Event::Failed { error: e });
    }
}

fn helper_inner(output: Rc<RefCell<File>>) -> Result<()> {
    let mut input = BufReader::new(std::io::stdin());
    let snapshot: Input = frame_read(&mut input, MAX_HTML * 6 + 4096)?;
    if snapshot.choose.is_none() && !snapshot.print {
        validate_html(&snapshot.html)?;
        frame_write(&mut *output.borrow_mut(), &Event::Rendering)?;
        super::chromium::render(
            &snapshot.html,
            &snapshot.directory,
            snapshot.page_size,
            snapshot.landscape,
        )?;
        return frame_write(&mut *output.borrow_mut(), &Event::Pdf);
    }
    gtk::init().map_err(error)?;
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("Document output");
    window.set_default_size(1024, 768);
    if let Some(name) = snapshot.choose {
        return choose_dialog(&window, &name, &mut input, &output);
    }
    validate_html(&snapshot.html)?;
    start_print(
        &window,
        snapshot.print,
        &snapshot.html,
        snapshot.page_size,
        snapshot.landscape,
        &snapshot.directory,
        &mut input,
        output,
    )
}

fn approve_selection(
    window: &gtk::Window,
    path: PathBuf,
    input: &mut impl Read,
    output: &Rc<RefCell<File>>,
) -> Result<bool> {
    frame_write(
        &mut *output.borrow_mut(),
        &Event::Selection { path: path.clone() },
    )?;
    let ack: SelectionAck = frame_read(input, 1024)?;
    if !ack.overwrite {
        return Ok(true);
    }
    let confirm = gtk::MessageDialog::new(
        Some(window),
        gtk::DialogFlags::MODAL,
        gtk::MessageType::Question,
        gtk::ButtonsType::YesNo,
        &format!(
            "Replace the existing output file {}?",
            path.file_name().unwrap_or_default().to_string_lossy()
        ),
    );
    let yes = confirm.run() == gtk::ResponseType::Yes;
    unsafe {
        confirm.destroy();
    }
    Ok(yes)
}
fn choose_dialog(
    window: &gtk::Window,
    name: &str,
    input: &mut impl Read,
    output: &Rc<RefCell<File>>,
) -> Result<()> {
    frame_write(&mut *output.borrow_mut(), &Event::Dialog)?;
    let dialog = gtk::FileChooserDialog::new(
        Some("Choose output destination"),
        Some(window),
        gtk::FileChooserAction::Save,
    );
    dialog.add_buttons(&[
        ("Cancel", gtk::ResponseType::Cancel),
        ("Save", gtk::ResponseType::Accept),
    ]);
    dialog.set_current_name(name);
    dialog.set_do_overwrite_confirmation(false);
    dialog.set_local_only(true);
    let filter = gtk::FileFilter::new();
    let extension = if name.ends_with(".html") {
        "html"
    } else {
        "pdf"
    };
    filter.set_name(Some(extension));
    filter.add_pattern(&format!("*.{extension}"));
    dialog.add_filter(filter);
    let selected = if dialog.run() == gtk::ResponseType::Accept {
        dialog.filename()
    } else {
        None
    };
    unsafe {
        dialog.destroy();
    }
    let approved = match selected {
        Some(path) => approve_selection(window, path, input, output)?,
        None => false,
    };
    frame_write(
        &mut *output.borrow_mut(),
        if approved {
            &Event::Chosen
        } else {
            &Event::Cancelled
        },
    )
}

// GtkPrintUnixDialog is part of the already-linked GTK 3 library, but is not
// wrapped by gtk-rs 0.18. The dialog collects settings without starting a job.
extern "C" {
    fn gtk_print_unix_dialog_new(
        title: *const libc::c_char,
        parent: *mut gtk::ffi::GtkWindow,
    ) -> *mut gtk::ffi::GtkWidget;
    fn gtk_print_unix_dialog_set_settings(
        dialog: *mut libc::c_void,
        settings: *mut gtk::ffi::GtkPrintSettings,
    );
    fn gtk_print_unix_dialog_set_page_setup(
        dialog: *mut libc::c_void,
        setup: *mut gtk::ffi::GtkPageSetup,
    );
    fn gtk_print_unix_dialog_set_manual_capabilities(
        dialog: *mut libc::c_void,
        capabilities: libc::c_int,
    );
    fn gtk_print_unix_dialog_get_settings(
        dialog: *mut libc::c_void,
    ) -> *mut gtk::ffi::GtkPrintSettings;
    fn gtk_print_unix_dialog_get_page_setup(
        dialog: *mut libc::c_void,
    ) -> *mut gtk::ffi::GtkPageSetup;
    fn gtk_print_unix_dialog_get_selected_printer(dialog: *mut libc::c_void) -> *mut libc::c_void;
    fn gtk_printer_is_virtual(printer: *mut libc::c_void) -> libc::c_int;
    fn gtk_printer_get_backend(printer: *mut libc::c_void) -> *mut glib::gobject_ffi::GObject;
    fn gtk_printer_accepts_pdf(printer: *mut libc::c_void) -> libc::c_int;
    fn gtk_print_job_new(
        title: *const libc::c_char,
        printer: *mut libc::c_void,
        settings: *mut gtk::ffi::GtkPrintSettings,
        setup: *mut gtk::ffi::GtkPageSetup,
    ) -> *mut glib::gobject_ffi::GObject;
    fn gtk_print_job_set_source_fd(
        job: *mut libc::c_void,
        fd: libc::c_int,
        error: *mut *mut glib::ffi::GError,
    ) -> libc::c_int;
    fn gtk_print_job_send(
        job: *mut libc::c_void,
        callback: Option<
            unsafe extern "C" fn(*mut libc::c_void, *mut libc::c_void, *const glib::ffi::GError),
        >,
        data: *mut libc::c_void,
        destroy: Option<unsafe extern "C" fn(*mut libc::c_void)>,
    );

}
fn is_file_printer(printer: *mut libc::c_void) -> bool {
    let pointer = unsafe { gtk_printer_get_backend(printer) };
    if pointer.is_null() {
        return false;
    }
    let backend: glib::Object = unsafe { from_glib_none(pointer) };
    backend.type_().name() == "GtkPrintBackendFile"
}
fn page_options(setup: &gtk::PageSetup) -> Result<(PageSize, bool)> {
    let paper = setup.paper_size();
    let width = paper.width(gtk::Unit::Mm);
    let height = paper.height(gtk::Unit::Mm);
    let page = if (width - 210.0).abs() < 0.1 && (height - 297.0).abs() < 0.1 {
        PageSize::A4
    } else if (width - 215.9).abs() < 0.1 && (height - 279.4).abs() < 0.1 {
        PageSize::Letter
    } else {
        return Err("Unsupported print paper; choose A4 or Letter".into());
    };
    let landscape = match setup.orientation() {
        gtk::PageOrientation::Portrait => false,
        gtk::PageOrientation::Landscape => true,
        _ => return Err("Unsupported print orientation; choose portrait or landscape".into()),
    };
    Ok((page, landscape))
}

fn submission_uncertain(reason: impl std::fmt::Display) -> String {
    format!("[output:unavailable] Print submission status is unknown; check the printer queue before retrying. {reason}")
}

struct SendState {
    result: Rc<RefCell<Option<Result<()>>>>,
    main_loop: glib::MainLoop,
}
unsafe extern "C" fn send_finished(
    _job: *mut libc::c_void,
    data: *mut libc::c_void,
    failure: *const glib::ffi::GError,
) {
    let state = &*(data as *const SendState);
    *state.result.borrow_mut() = Some(if failure.is_null() {
        Ok(())
    } else {
        let error: glib::Error = from_glib_none(failure);
        Err(submission_uncertain(error))
    });
    state.main_loop.quit();
}
unsafe extern "C" fn drop_send_state(data: *mut libc::c_void) {
    drop(Box::from_raw(data as *mut SendState));
}

fn submit_pdf(
    printer: &glib::Object,
    settings: &gtk::PrintSettings,
    setup: &gtk::PageSetup,
    directory: &Path,
    input: &mut impl Read,
    output: &Rc<RefCell<File>>,
) -> Result<()> {
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(directory.join("document.pdf"))
        .map_err(error)?;
    let metadata = file.metadata().map_err(error)?;
    if !metadata.is_file() || metadata.len() > MAX_PDF as u64 {
        return Err("Native PDF exceeds its 64 MiB budget".into());
    }
    let raw_job = unsafe {
        gtk_print_job_new(
            c"Document output".as_ptr(),
            printer.as_ptr().cast(),
            settings.to_glib_none().0,
            setup.to_glib_none().0,
        )
    };
    if raw_job.is_null() {
        return Err("Native print job unavailable".into());
    }
    let job: glib::Object = unsafe { from_glib_full(raw_job) };
    let mut failure = std::ptr::null_mut();
    if unsafe { gtk_print_job_set_source_fd(job.as_ptr().cast(), file.as_raw_fd(), &mut failure) }
        == 0
    {
        return Err(if failure.is_null() {
            "Native printer could not open the PDF".into()
        } else {
            let error: glib::Error = unsafe { from_glib_full(failure) };
            error.to_string()
        });
    }
    // The owner serializes this acknowledgement with output_abort. No spool
    // request is sent until it enters the irreversible submission state.
    frame_write(&mut *output.borrow_mut(), &Event::Submitting)?;
    let ack: SubmissionAck = frame_read(input, 1024)?;
    if !ack.submit {
        return Err("Output cancelled before print submission".into());
    }
    let result = Rc::new(RefCell::new(None));
    let main_loop = glib::MainLoop::new(None, false);
    let state = Box::new(SendState {
        result: result.clone(),
        main_loop: main_loop.clone(),
    });
    unsafe {
        gtk_print_job_send(
            job.as_ptr().cast(),
            Some(send_finished),
            Box::into_raw(state).cast(),
            Some(drop_send_state),
        );
    }
    if result.borrow().is_none() {
        main_loop.run();
    }
    // The source FD remains open until send completed. A successful callback
    // means the spooler accepted the job, not that paper physically emerged.
    let outcome = result
        .borrow_mut()
        .take()
        .ok_or_else(|| submission_uncertain("No submission result"))?;
    outcome?;
    frame_write(&mut *output.borrow_mut(), &Event::Printed)
}

fn start_print(
    window: &gtk::Window,
    print: bool,
    html: &str,
    page_size: PageSize,
    landscape: bool,
    directory: &Path,
    input: &mut impl Read,
    output: Rc<RefCell<File>>,
) -> Result<()> {
    let mut settings = gtk::PrintSettings::new();
    let mut setup = gtk::PageSetup::new();
    setup.set_paper_size(&gtk::PaperSize::new(Some(match page_size {
        PageSize::A4 => "iso_a4",
        PageSize::Letter => "na_letter",
    })));
    setup.set_orientation(if landscape {
        gtk::PageOrientation::Landscape
    } else {
        gtk::PageOrientation::Portrait
    });
    let mut printer = None;
    if print {
        frame_write(&mut *output.borrow_mut(), &Event::Dialog)?;
        let widget: gtk::Widget = unsafe {
            from_glib_none(gtk_print_unix_dialog_new(
                c"Print document".as_ptr(),
                window.to_glib_none().0,
            ))
        };
        let dialog = widget
            .dynamic_cast::<gtk::Dialog>()
            .map_err(|_| "Native print dialog unavailable")?;
        let pointer = dialog.as_ptr().cast();
        unsafe {
            gtk_print_unix_dialog_set_settings(pointer, settings.to_glib_none().0);
            gtk_print_unix_dialog_set_page_setup(pointer, setup.to_glib_none().0);
            gtk_print_unix_dialog_set_manual_capabilities(pointer, 1 << 5);
        }
        let response = dialog.run();
        if response != gtk::ResponseType::Ok {
            unsafe {
                dialog.destroy();
            }
            return frame_write(&mut *output.borrow_mut(), &Event::Cancelled);
        }
        let selected = unsafe { gtk_print_unix_dialog_get_selected_printer(pointer) };
        if selected.is_null() {
            unsafe {
                dialog.destroy();
            }
            return Err("No printer selected".into());
        }
        // Retain the selected printer before destroying its owning dialog.
        let selected: glib::Object =
            unsafe { from_glib_none(selected.cast::<glib::gobject_ffi::GObject>()) };
        let file_output = is_file_printer(selected.as_ptr().cast());
        settings = unsafe { from_glib_full(gtk_print_unix_dialog_get_settings(pointer)) };
        setup = unsafe { from_glib_none(gtk_print_unix_dialog_get_page_setup(pointer)) };
        unsafe {
            dialog.destroy();
        }
        if file_output {
            let uri = settings
                .get("output-uri")
                .ok_or("Print-to-file destination missing")?;
            let path = gio::File::for_uri(&uri)
                .path()
                .ok_or("Print-to-file requires a local destination")?;
            if !approve_selection(window, path, input, &output)? {
                return frame_write(&mut *output.borrow_mut(), &Event::Cancelled);
            }
        } else {
            if unsafe { gtk_printer_is_virtual(selected.as_ptr().cast()) } != 0 {
                return Err("Unsupported virtual print destination".into());
            }
            if unsafe { gtk_printer_accepts_pdf(selected.as_ptr().cast()) } == 0 {
                return Err("Unsupported printer: PDF input is required".into());
            }
            printer = Some(selected);
        }
    }
    let (page_size, landscape) = page_options(&setup)?;
    if settings.print_pages() != gtk::PrintPages::All
        || settings.n_copies() != 1
        || settings.number_up() != 1
        || (settings.scale() - 100.0).abs() > 0.001
        || settings.is_reverse()
        || settings.page_set() != gtk::PageSet::All
    {
        return Err("Unsupported print settings; use all pages, one copy, one page per sheet, 100% scale and normal order".into());
    }
    frame_write(&mut *output.borrow_mut(), &Event::Rendering)?;
    super::chromium::render(html, directory, page_size, landscape)?;
    if let Some(printer) = printer {
        submit_pdf(&printer, &settings, &setup, directory, input, &output)
    } else {
        frame_write(&mut *output.borrow_mut(), &Event::Pdf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires a native display and the local GTK FileBackend; sends no external print job"]
    fn real_gtk_source_fd_submission_preserves_pdf_bytes() {
        extern "C" {
            fn gtk_enumerate_printers(
                callback: Option<
                    unsafe extern "C" fn(*mut libc::c_void, *mut libc::c_void) -> libc::c_int,
                >,
                data: *mut libc::c_void,
                destroy: Option<unsafe extern "C" fn(*mut libc::c_void)>,
                wait: libc::c_int,
            );
        }
        unsafe extern "C" fn local_file_printer(
            printer: *mut libc::c_void,
            data: *mut libc::c_void,
        ) -> libc::c_int {
            if !is_file_printer(printer) {
                return 0;
            }
            *(data as *mut Option<glib::Object>) =
                Some(from_glib_none(printer.cast::<glib::gobject_ffi::GObject>()));
            1
        }
        gtk::init().unwrap();
        let mut printer: Option<glib::Object> = None;
        unsafe {
            gtk_enumerate_printers(
                Some(local_file_printer),
                (&mut printer as *mut Option<glib::Object>).cast(),
                None,
                1,
            );
        }
        let printer = printer.expect("local GTK FileBackend required");
        let private = Private::new().unwrap();
        let source = std::env::var_os("MILKUP_OUTPUT_TEST_SOURCE_PDF")
            .expect("explicit completed evidence PDF required");
        let bytes = fs::read(source).unwrap();
        assert!(bytes.starts_with(b"%PDF-") && bytes.len() <= MAX_PDF);
        fs::write(private.0.join("document.pdf"), &bytes).unwrap();
        let spooled = private.0.join("spooled.pdf");
        let settings = gtk::PrintSettings::new();
        settings.set_printer(&printer.property::<String>("name"));
        settings.set("output-file-format", Some("pdf"));
        settings.set("output-uri", Some(&gio::File::for_path(&spooled).uri()));
        let setup = gtk::PageSetup::new();
        let mut acknowledgement = Vec::new();
        frame_write(&mut acknowledgement, &SubmissionAck { submit: true }).unwrap();
        let events = private.0.join("events");
        let output = Rc::new(RefCell::new(File::create(&events).unwrap()));
        submit_pdf(
            &printer,
            &settings,
            &setup,
            &private.0,
            &mut std::io::Cursor::new(acknowledgement),
            &output,
        )
        .unwrap();
        assert_eq!(fs::read(&spooled).unwrap(), bytes);
        assert_eq!(fs::read(private.0.join("document.pdf")).unwrap(), bytes);
        let mut events = File::open(events).unwrap();
        assert!(matches!(
            frame_read::<Event>(&mut events, 16384).unwrap(),
            Event::Submitting
        ));
        assert!(matches!(
            frame_read::<Event>(&mut events, 16384).unwrap(),
            Event::Printed
        ));
        eprintln!("GTK_SOURCE_FD_BYTES_IDENTICAL bytes={} sha256={:x}; local FileBackend only, no physical printer", bytes.len(), Sha256::digest(&bytes));
    }
    #[test]
    #[ignore = "private helper launched by the real native output test"]
    fn native_output_helper() {
        assert_eq!(
            std::env::var("MILKUP_OUTPUT_TEST_HELPER").as_deref(),
            Ok("1")
        );
        run_guarded();
    }
    #[test]
    #[ignore = "requires the sandbox-enabled system Chromium runtime"]
    fn real_chromium_pdf_output() {
        let job = Arc::new(Job {
            format: Format::Pdf,
            source: None,
            source_identity: None,
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            state: Mutex::new(JobState::Running),
        });
        let html="<!doctype html><meta charset=utf-8><style>body{font-family:sans-serif} .page{break-before:page}</style><h1>真实输出 中文 PDF</h1><table><tr><td>表格</td><td>123</td></tr></table><pre>const value = 42;</pre><h2 class=page>第二页</h2>".to_string();
        let result = render_with_executable(
            &job,
            html,
            PageSize::A4,
            false,
            std::env::current_exe().unwrap(),
            true,
            None,
        )
        .unwrap();
        let NativeResult::Pdf(bytes, None) = result else {
            panic!("expected PDF")
        };
        let destination =
            std::env::var_os("MILKUP_OUTPUT_TEST_PDF").expect("explicit evidence PDF destination");
        fs::write(destination, &bytes).unwrap();
        eprintln!("NATIVE_OUTPUT_PDF bytes={}", bytes.len());
    }
}

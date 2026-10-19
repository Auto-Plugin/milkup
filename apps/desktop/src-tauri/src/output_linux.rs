//! Static document printing in a separate, sandboxed WebKit process. The
//! existing native guardian owns every descendant and observes parent EOF.
use super::*;
use glib::translate::{from_glib_full, from_glib_none, ToGlibPtr};
use gtk::prelude::DialogExt as GtkDialogExt;
use gtk::{gio, glib, prelude::*};
use std::{
    cell::{Cell, RefCell},
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
use webkit2gtk::{
    DownloadExt, FileChooserRequestExt, PermissionRequestExt, PolicyDecisionExt, PrintOperationExt,
    SettingsExt, URISchemeRequestExt, URISchemeResponseExt, UserMessageExt, WebContextExt,
    WebViewExt,
};

const URL: &str = "milkup-output://job/index.html";
const CSP: &str = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const GUARD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libmilkup_output_guard.so"));
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
    Cancelled,
    Chosen,
    Failed { error: String },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SelectionAck {
    overwrite: bool,
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
        let mut guard = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(private.0.join("libmilkup_output_guard.so"))
            .map_err(error)?;
        guard.write_all(GUARD).map_err(error)?;
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
    let result = (|| loop {
        job.active()?;
        if Instant::now() >= deadline {
            return Err("Native output exceeded its deadline".into());
        }
        match receive.recv_timeout(Duration::from_millis(25)) {
            Ok(Ok(Event::Dialog)) => {
                if job.format != Format::Print && !choosing {
                    return Err("Unexpected output dialog".into());
                }
                deadline = Instant::now() + LEASE;
            }
            Ok(Ok(Event::Selection { path })) => {
                if (job.format != Format::Print && !choosing) || target.is_some() {
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
                deadline = Instant::now() + Duration::from_secs(60);
            }
            Ok(Ok(Event::Pdf)) => {
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
            Ok(Ok(Event::Printed)) => return Ok(NativeResult::Printed),
            Ok(Ok(Event::Chosen)) => {
                let chosen = target.take().ok_or("Output selection missing")?;
                chosen.verify(job.source.as_deref())?;
                return Ok(NativeResult::Chosen(chosen));
            }
            Ok(Ok(Event::Cancelled)) => return Ok(NativeResult::Cancelled),
            Ok(Ok(Event::Failed { error })) => return Err(error),
            Ok(Err(e)) => return Err(e),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => return Err(error(e)),
        }
    })();
    drop(stop_writer);
    drop(helper_input);
    // Never kill the guardian ahead of its owned-descendant cleanup.
    let cleanup_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() && result.is_ok() {
                    return Err("Output guardian reported incomplete cleanup".into());
                }
                break;
            }
            Err(e) => return Err(error(e)),
            _ => {}
        }
        if Instant::now() >= cleanup_deadline {
            std::mem::forget(private);
            return Err("Output cleanup is still pending; private files retained".into());
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
    // Neither snapshot/result descriptors are inherited by the WebProcess.
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
    gtk::init().map_err(error)?;
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("Document output");
    window.set_default_size(1024, 768);
    if let Some(name) = snapshot.choose {
        return choose_dialog(&window, &name, &mut input, &output);
    }
    validate_html(&snapshot.html)?;
    let context = webkit2gtk::WebContext::new_ephemeral();
    context.set_sandbox_enabled(true);
    if !context.is_sandbox_enabled() {
        return Err("Output WebKit sandbox unavailable".into());
    }
    context.set_web_extensions_directory(
        snapshot
            .directory
            .to_str()
            .ok_or("Invalid output private directory")?,
    );
    context.set_automation_allowed(false);
    let body = snapshot.html.into_bytes();
    context.register_uri_scheme("milkup-output", move |request| {
        if request.uri().as_deref() != Some(URL) || request.http_method().as_deref() != Some("GET")
        {
            request.finish_error(&mut glib::Error::new(
                gio::IOErrorEnum::PermissionDenied,
                "Output resource denied",
            ));
            return;
        }
        let stream = gio::MemoryInputStream::from_bytes(&glib::Bytes::from(&body));
        let response = webkit2gtk::URISchemeResponse::new(&stream, body.len() as i64);
        response.set_status(200, None);
        response.set_content_type("text/html; charset=utf-8");
        let headers = soup::MessageHeaders::new(soup::MessageHeadersType::Response);
        headers.append("Content-Security-Policy", CSP);
        headers.append("X-Content-Type-Options", "nosniff");
        headers.append("Cache-Control", "no-store");
        response.set_http_headers(headers);
        request.finish_with_response(&response);
    });
    context.connect_download_started(|_, download| download.cancel());
    let guard_ready = Rc::new(Cell::new(false));
    let guard_observed = guard_ready.clone();
    context.connect_user_message_received(move |_, message| {
        if message.name().as_deref() == Some("milkup-output-guard-ready") {
            guard_observed.set(true);
            true
        } else {
            false
        }
    });
    let view = webkit2gtk::WebView::with_context(&context);
    if !view.is_ephemeral() {
        return Err("Output WebKit must be ephemeral".into());
    }
    let settings = WebViewExt::settings(&view).ok_or("Output WebKit settings unavailable")?;
    settings.set_enable_javascript(false);
    settings.set_allow_file_access_from_file_urls(false);
    settings.set_allow_universal_access_from_file_urls(false);
    settings.set_enable_webrtc(false);
    settings.set_enable_media_stream(false);
    settings.set_enable_webgl(false);
    settings.set_enable_html5_database(false);
    settings.set_enable_html5_local_storage(false);
    settings.set_enable_dns_prefetching(false);
    settings.set_enable_developer_extras(false);
    settings.set_print_backgrounds(true);
    view.connect_permission_request(|_, request| {
        request.deny();
        true
    });
    view.connect_run_file_chooser(|_, request| {
        request.cancel();
        true
    });
    view.connect_script_dialog(|_, dialog| {
        dialog.close();
        true
    });
    let navigated = Rc::new(Cell::new(false));
    view.connect_decide_policy(move |_, decision, kind| {
        if kind == webkit2gtk::PolicyDecisionType::NavigationAction {
            use webkit2gtk::{NavigationPolicyDecisionExt, URIRequestExt};
            let allowed = decision
                .downcast_ref::<webkit2gtk::NavigationPolicyDecision>()
                .and_then(|d| d.navigation_action())
                .and_then(|a| a.request())
                .and_then(|r| r.uri())
                .is_some_and(|u| u == URL && !navigated.replace(true));
            if allowed {
                decision.use_();
            } else {
                decision.ignore();
            }
            true
        } else if kind == webkit2gtk::PolicyDecisionType::NewWindowAction {
            decision.ignore();
            true
        } else {
            false
        }
    });
    let loaded = Rc::new(Cell::new(false));
    let observed = loaded.clone();
    view.connect_load_changed(move |_, event| {
        if event == webkit2gtk::LoadEvent::Finished {
            observed.set(true);
        }
    });
    let output_failed = output.clone();
    view.connect_load_failed(move |_, _, _, e| {
        let _ = frame_write(
            &mut *output_failed.borrow_mut(),
            &Event::Failed {
                error: e.to_string(),
            },
        );
        gtk::main_quit();
        true
    });
    window.add(&view);
    window.realize();
    view.set_size_request(1024, 768);
    view.show();
    let started = Rc::new(Cell::new(false));
    let print = snapshot.print;
    let directory = snapshot.directory;
    let print_view = view.clone();
    glib::timeout_add_local(Duration::from_millis(10), move || {
        if !loaded.get() || !guard_ready.get() || started.replace(true) {
            return glib::ControlFlow::Continue;
        }
        let result = start_print(
            &print_view,
            &window,
            print,
            snapshot.page_size,
            snapshot.landscape,
            &directory,
            &mut input,
            output.clone(),
        );
        if let Err(e) = result {
            let _ = frame_write(&mut *output.borrow_mut(), &Event::Failed { error: e });
            gtk::main_quit();
        }
        glib::ControlFlow::Break
    });
    view.load_uri(URL);
    gtk::main();
    Ok(())
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
    fn gtk_printer_get_name(printer: *mut libc::c_void) -> *const libc::c_char;
    fn gtk_enumerate_printers(
        callback: Option<unsafe extern "C" fn(*mut libc::c_void, *mut libc::c_void) -> libc::c_int>,
        data: *mut libc::c_void,
        destroy: Option<unsafe extern "C" fn(*mut libc::c_void)>,
        wait: libc::c_int,
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
fn file_printer_name() -> Result<String> {
    unsafe extern "C" fn found(printer: *mut libc::c_void, data: *mut libc::c_void) -> libc::c_int {
        if !is_file_printer(printer) {
            return 0;
        }
        let name = gtk_printer_get_name(printer);
        if name.is_null() {
            return 0;
        }
        *(data as *mut Option<String>) = Some(
            std::ffi::CStr::from_ptr(name)
                .to_string_lossy()
                .into_owned(),
        );
        1
    }
    let mut name: Option<String> = None;
    unsafe {
        gtk_enumerate_printers(
            Some(found),
            (&mut name as *mut Option<String>).cast(),
            None,
            1,
        );
    }
    name.ok_or("GTK Print-to-File backend is unavailable".into())
}
fn start_print(
    view: &webkit2gtk::WebView,
    window: &gtk::Window,
    print: bool,
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
    for set in [
        gtk::PageSetup::set_top_margin,
        gtk::PageSetup::set_bottom_margin,
        gtk::PageSetup::set_left_margin,
        gtk::PageSetup::set_right_margin,
    ] {
        set(&setup, 12.0, gtk::Unit::Mm);
    }
    let mut file_output = true;
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
            frame_write(&mut *output.borrow_mut(), &Event::Cancelled)?;
            gtk::main_quit();
            return Ok(());
        }
        let printer = unsafe { gtk_print_unix_dialog_get_selected_printer(pointer) };
        if printer.is_null() {
            unsafe {
                dialog.destroy();
            }
            return Err("No printer selected".into());
        }
        file_output = is_file_printer(printer);
        if !file_output && unsafe { gtk_printer_is_virtual(printer) != 0 } {
            unsafe {
                dialog.destroy();
            }
            return Err("Unsupported virtual print destination".into());
        }
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
                frame_write(&mut *output.borrow_mut(), &Event::Cancelled)?;
                gtk::main_quit();
                return Ok(());
            }
        }
    }
    if file_output {
        if !print {
            settings.set_printer(&file_printer_name()?);
        }
        settings.set("output-file-format", Some("pdf"));
        let uri = gio::File::for_path(directory.join("document.pdf")).uri();
        settings.set("output-uri", Some(&uri));
    }
    let operation = webkit2gtk::PrintOperation::new(view);
    operation.set_print_settings(&settings);
    operation.set_page_setup(&setup);
    let failed = Rc::new(Cell::new(false));
    let failure = failed.clone();
    let failure_output = output.clone();
    operation.connect_failed(move |_, e| {
        failure.set(true);
        let _ = frame_write(
            &mut *failure_output.borrow_mut(),
            &Event::Failed {
                error: e.to_string(),
            },
        );
    });
    let done_output = output.clone();
    operation.connect_finished(move |_| {
        if !failed.get() {
            let _ = frame_write(
                &mut *done_output.borrow_mut(),
                if file_output {
                    &Event::Pdf
                } else {
                    &Event::Printed
                },
            );
        }
        gtk::main_quit();
    });
    frame_write(&mut *output.borrow_mut(), &Event::Rendering)?;
    operation.print();
    // WebKit retains the asynchronous operation until finished.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
    #[ignore = "requires the sandbox-enabled native display and WebKit runtime"]
    fn real_webkit_pdf_output() {
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

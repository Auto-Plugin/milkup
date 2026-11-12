//! Static HTML -> PDF using the already installed Evergreen WebView2.
//! The helper never receives an output path. Only the host's lease can publish
//! returned bytes. No shell, external browser, JavaScript, or download fallback.
use super::Result;
use super::*;
use crate::windows_process::ProcessJob;
use ::windows::{
    core::{w, Interface, PCWSTR, PWSTR},
    Win32::{
        Foundation::{E_FAIL, RECT},
        System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED},
        UI::{Shell::SHCreateMemStream, WindowsAndMessaging::*},
    },
};
use std::{
    io::BufReader,
    os::windows::process::CommandExt,
    process::{Command, Stdio},
    sync::mpsc,
};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};

const URL: &str = "milkup-output://job/document";
const CSP: &str = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
#[path = "output_windows_printer.rs"]
mod printer;

enum Rendered {
    Pdf(Vec<u8>),
    PdfPrint(Vec<u8>),
    Printed,
    Cancelled,
}

const RENDER_TIME: Duration = Duration::from_secs(90);
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    print: bool,
    html: String,
    page_size: PageSize,
    landscape: bool,
    directory: PathBuf,
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn frame_write(writer: &mut impl Write, bytes: &[u8]) -> Result<()> {
    writer
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(bytes))
        .and_then(|_| writer.flush())
        .map_err(error)
}
fn frame_read(reader: &mut impl Read, limit: usize) -> Result<Vec<u8>> {
    let mut size = [0; 4];
    reader.read_exact(&mut size).map_err(error)?;
    let size = u32::from_le_bytes(size) as usize;
    if size == 0 || size > limit {
        return Err("Output frame exceeds budget or is empty".into());
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes).map_err(error)?;
    Ok(bytes)
}

struct Private(PathBuf);
impl Private {
    fn new() -> Result<Self> {
        use windows_sys::Win32::{
            Security::{Authorization::*, SECURITY_ATTRIBUTES},
            Storage::FileSystem::CreateDirectoryW,
        };
        let path = std::env::temp_dir().join(crate::workspace::id("milkup-pdf")?);
        let path_wide = wide(path.to_str().ok_or("Non-Unicode temporary path")?);
        // Protected, inheritable owner-only ACL is applied at creation, before
        // any document data or WebView profile is written. Never alter ancestors.
        let descriptor_text = wide("D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)");
        let mut descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor_text.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(error(std::io::Error::last_os_error()));
        }
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let created = unsafe { CreateDirectoryW(path_wide.as_ptr(), &attributes) };
        let failure = std::io::Error::last_os_error();
        unsafe {
            LocalFree(descriptor);
        }
        if created == 0 {
            return Err(error(failure));
        }
        Ok(Self(path))
    }
    fn clean(self) -> Result<()> {
        fs::remove_dir_all(&self.0).map_err(|e| format!("Cannot clean private PDF profile: {e}"))
    }
}
impl Drop for Private {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(in crate::output) fn render(
    job: &Arc<Job>,
    html: String,
    page_size: PageSize,
    landscape: bool,
) -> Result<NativeResult> {
    let mut command = Command::new(std::env::current_exe().map_err(error)?);
    command.arg("--milkup-internal-pdf-helper");
    render_with_command(job, html, page_size, landscape, command)
}
fn render_with_command(
    job: &Arc<Job>,
    html: String,
    page_size: PageSize,
    landscape: bool,
    mut command: Command,
) -> Result<NativeResult> {
    job.active()?;
    let private = Private::new()?;
    let printing = job.format == Format::Print;
    let input = serde_json::to_vec(&Input {
        print: printing,
        html,
        page_size,
        landscape,
        directory: private.0.clone(),
    })
    .map_err(error)?;
    let owner = ProcessJob::new()?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000);
    // Inherited debug flags, an alternative runtime and a shared profile must
    // not defeat this helper's owned ephemeral profile or its browser sandbox.
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("WEBVIEW2_")
        {
            command.env_remove(key);
        }
    }
    #[cfg(test)]
    command.stderr(Stdio::piped());
    let mut child = command.spawn().map_err(error)?;
    owner.assign(&mut child)?;
    let mut stdin = child.stdin.take().ok_or("Missing PDF input pipe")?;
    #[cfg(not(test))]
    let stdout = child.stdout.take().ok_or("Missing PDF result pipe")?;
    #[cfg(test)]
    let stdout = child.stderr.take().ok_or("Missing PDF fixture pipe")?;
    // Both large pipe transfers stay off the polling thread so cancellation
    // remains effective even if a helper stops consuming input or emits a prefix.
    let writer = std::thread::spawn(move || frame_write(&mut stdin, &input));
    let (tx, rx) = mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut status = [0];
        let result = reader.read_exact(&mut status).map_err(error).and_then(|_| {
            let bytes = frame_read(
                &mut reader,
                if status[0] == 0 || status[0] == 4 {
                    MAX_PDF
                } else {
                    4096
                },
            )?;
            match status[0] {
                0 if bytes.starts_with(b"%PDF-") => Ok(Rendered::Pdf(bytes)),
                2 if bytes == b"printed" => Ok(Rendered::Printed),
                3 if bytes == b"cancelled" => Ok(Rendered::Cancelled),
                4 if bytes.starts_with(b"%PDF-") => Ok(Rendered::PdfPrint(bytes)),
                1 => Err(String::from_utf8_lossy(&bytes).into_owned()),
                _ => Err("Invalid native PDF response".into()),
            }
        });
        let _ = tx.send(result);
        // The owner terminates the helper after receiving the frame. Require
        // exact protocol EOF before publication; a valid prefix is insufficient.
        let mut trailing = [0u8; 1];
        match reader.read(&mut trailing) {
            Ok(0) => Ok(()),
            Ok(_) => Err("Trailing bytes after native PDF response".to_owned()),
            Err(e) => Err(error(e)),
        }
    });
    let deadline = Instant::now() + RENDER_TIME;
    let result = (|| loop {
        job.active()?;
        if Instant::now() >= deadline {
            return Err("Native PDF renderer deadline reached".into());
        }
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(result) => {
                job.active()?;
                return result;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => return Err("PDF helper closed without a result".into()),
        }
    })();
    // Completion is not exposed until the owned process tree is empty.
    owner.stop()?;
    let cleanup_deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if child.try_wait().map_err(error)?.is_some()
            && writer.is_finished()
            && reader.is_finished()
        {
            break;
        }
        if Instant::now() >= cleanup_deadline {
            return Err("Native PDF process or pipe cleanup not confirmed".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let written = writer.join().map_err(|_| "PDF writer failed".to_owned());
    let read = reader.join().map_err(|_| "PDF reader failed".to_owned());
    read??;
    private.clean()?;
    let result = result?;
    written??;
    match result {
        Rendered::Pdf(bytes) if !printing => Ok(NativeResult::Pdf(bytes, None)),
        Rendered::Printed if printing => Ok(NativeResult::Printed),
        Rendered::Cancelled if printing => Ok(NativeResult::Cancelled),
        Rendered::PdfPrint(bytes) if printing => {
            // The known PDF printer is treated as a guarded file destination,
            // never passed to a driver that could overwrite an arbitrary file.
            match super::picker::choose_pdf_target(job, "document".into())? {
                Some(target) => Ok(NativeResult::Pdf(bytes, Some(target))),
                None => Ok(NativeResult::Cancelled),
            }
        }
        _ => Err("Output helper returned a mismatched operation".into()),
    }
}

fn pump<T>(rx: &mpsc::Receiver<T>, deadline: Instant) -> Result<T> {
    loop {
        match rx.try_recv() {
            Ok(value) => return Ok(value),
            Err(mpsc::TryRecvError::Disconnected) => {
                return Err("PDF callback channel closed".into())
            }
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err("Native PDF renderer deadline reached".into());
        }
        unsafe {
            let mut message = MSG::default();
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}
unsafe fn string(ptr: PWSTR) -> ::windows::core::Result<String> {
    if ptr.is_null() {
        return Err(E_FAIL.into());
    }
    let result = (0..=4096)
        .find(|i| *ptr.0.add(*i) == 0)
        .and_then(|n| String::from_utf16(std::slice::from_raw_parts(ptr.0, n)).ok());
    CoTaskMemFree(Some(ptr.0.cast()));
    result.ok_or_else(|| E_FAIL.into())
}
// Callback guards fail closed even when the COM setter itself fails. The host
// observes EOF and does not publish anything from this terminated helper.
fn fatal() -> ! {
    std::process::exit(2)
}

fn pdf(input: Input) -> Result<Rendered> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(error)?;
    }
    let deadline = Instant::now() + if input.print { LEASE } else { RENDER_TIME };
    let directory = wide(
        input
            .directory
            .join("profile")
            .to_str()
            .ok_or("Non-Unicode profile path")?,
    );
    let options = CoreWebView2EnvironmentOptions::default();
    let scheme = CoreWebView2CustomSchemeRegistration::new("milkup-output".into());
    unsafe {
        scheme.set_has_authority_component(true);
        scheme.set_treat_as_secure(false);
        scheme.set_allowed_origins(Vec::new());
        options.set_scheme_registrations(vec![Some(scheme.into())]);
        options.set_exclusive_user_data_folder_access(true);
        options.set_allow_single_sign_on_using_os_primary_account(false);
        options.set_are_browser_extensions_enabled(false);
    }
    let options: ICoreWebView2EnvironmentOptions = options.into();
    let (tx, rx) = mpsc::channel();
    let callback =
        CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |hr, env| {
            let _ = tx.send(hr.and_then(|_| env.ok_or_else(|| E_FAIL.into())));
            Ok(())
        }));
    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR::null(),
            PCWSTR(directory.as_ptr()),
            &options,
            &callback,
        )
        .map_err(error)?;
    }
    let environment = pump(&rx, deadline)?.map_err(error)?;
    let window = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("STATIC"),
            w!("Milkup PDF"),
            WS_POPUP,
            0,
            0,
            1280,
            720,
            None,
            None,
            None,
            None,
        )
        .map_err(error)?
    };
    let (tx, rx) = mpsc::channel();
    let callback =
        CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |hr, controller| {
            let _ = tx.send(hr.and_then(|_| controller.ok_or_else(|| E_FAIL.into())));
            Ok(())
        }));
    unsafe {
        environment
            .CreateCoreWebView2Controller(window, &callback)
            .map_err(error)?;
    }
    let controller = pump(&rx, deadline)?.map_err(error)?;
    let result = (|| -> ::windows::core::Result<Rendered> {
        unsafe {
            controller.SetBounds(RECT {
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            })?;
            controller.SetIsVisible(true)?;
            let view = controller.CoreWebView2()?;
            let settings = view.Settings()?;
            settings.SetIsScriptEnabled(false)?;
            settings.SetAreHostObjectsAllowed(false)?;
            settings.SetIsWebMessageEnabled(false)?;
            settings.SetAreDefaultScriptDialogsEnabled(false)?;
            settings.SetAreDefaultContextMenusEnabled(false)?;
            settings.SetAreDevToolsEnabled(false)?;
            settings.SetIsStatusBarEnabled(false)?;
            settings.SetIsZoomControlEnabled(false)?;
            let settings = settings.cast::<ICoreWebView2Settings4>()?;
            settings.SetIsPasswordAutosaveEnabled(false)?;
            settings.SetIsGeneralAutofillEnabled(false)?;
            settings.SetAreBrowserAcceleratorKeysEnabled(false)?;
            let env = environment.clone();
            let html = input.html;
            let callback = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let args = args.unwrap_or_else(|| fatal());
                let deny_stream = SHCreateMemStream(Some(b"Blocked")).unwrap_or_else(|| fatal());
                let deny = env
                    .CreateWebResourceResponse(
                        &deny_stream,
                        403,
                        w!("Forbidden"),
                        w!("Content-Type: text/plain\r\n"),
                    )
                    .unwrap_or_else(|_| fatal());
                args.SetResponse(&deny).unwrap_or_else(|_| fatal());
                let request = args.Request()?;
                let mut uri = PWSTR::null();
                request.Uri(&mut uri)?;
                let uri = string(uri)?;
                let mut method = PWSTR::null();
                request.Method(&mut method)?;
                if uri == URL && string(method)? == "GET" {
                    let stream = SHCreateMemStream(Some(html.as_bytes()))
                        .ok_or_else(|| ::windows::core::Error::from(E_FAIL))?;
                    let headers = wide(&format!("Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-DNS-Prefetch-Control: off\r\nContent-Security-Policy: {CSP}\r\n"));
                    let response = env.CreateWebResourceResponse(
                        &stream,
                        200,
                        w!("OK"),
                        PCWSTR(headers.as_ptr()),
                    )?;
                    args.SetResponse(&response).unwrap_or_else(|_| fatal());
                }
                Ok(())
            }));
            let mut token = 0;
            view.add_WebResourceRequested(&callback, &mut token)?;
            view.cast::<ICoreWebView2_22>()?
                .AddWebResourceRequestedFilterWithRequestSourceKinds(
                    w!("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                )?;
            let mut initial = true;
            view.add_NavigationStarting(
                &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                    let args = args.unwrap_or_else(|| fatal());
                    args.SetCancel(true).unwrap_or_else(|_| fatal());
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    if string(uri)? == URL && initial {
                        initial = false;
                        args.SetCancel(false).unwrap_or_else(|_| fatal());
                    }
                    Ok(())
                })),
                &mut token,
            )?;
            view.add_FrameNavigationStarting(
                &NavigationStartingEventHandler::create(Box::new(|_, args| {
                    args.unwrap_or_else(|| fatal())
                        .SetCancel(true)
                        .unwrap_or_else(|_| fatal());
                    Ok(())
                })),
                &mut token,
            )?;
            view.cast::<ICoreWebView2_18>()?
                .add_LaunchingExternalUriScheme(
                    &LaunchingExternalUriSchemeEventHandler::create(Box::new(|_, args| {
                        args.unwrap_or_else(|| fatal())
                            .SetCancel(true)
                            .unwrap_or_else(|_| fatal());
                        Ok(())
                    })),
                    &mut token,
                )?;
            view.add_NewWindowRequested(
                &NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                    args.unwrap_or_else(|| fatal())
                        .SetHandled(true)
                        .unwrap_or_else(|_| fatal());
                    Ok(())
                })),
                &mut token,
            )?;
            view.add_PermissionRequested(
                &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                    args.unwrap_or_else(|| fatal())
                        .SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)
                        .unwrap_or_else(|_| fatal());
                    Ok(())
                })),
                &mut token,
            )?;
            view.cast::<ICoreWebView2_4>()?.add_DownloadStarting(
                &DownloadStartingEventHandler::create(Box::new(|_, args| {
                    args.unwrap_or_else(|| fatal())
                        .SetCancel(true)
                        .unwrap_or_else(|_| fatal());
                    Ok(())
                })),
                &mut token,
            )?;
            let (tx, rx) = mpsc::channel();
            view.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                    let mut source = PWSTR::null();
                    sender
                        .ok_or_else(|| ::windows::core::Error::from(E_FAIL))?
                        .Source(&mut source)?;
                    if string(source)? != URL {
                        return Ok(());
                    }
                    let mut success = false.into();
                    let result = args
                        .ok_or_else(|| ::windows::core::Error::from(E_FAIL))?
                        .IsSuccess(&mut success)
                        .and_then(|_| {
                            if success.as_bool() {
                                Ok(())
                            } else {
                                Err(E_FAIL.into())
                            }
                        });
                    let _ = tx.send(result);
                    Ok(())
                })),
                &mut token,
            )?;
            view.Navigate(PCWSTR(wide(URL).as_ptr()))?;
            pump(&rx, deadline).map_err(|_| ::windows::core::Error::from(E_FAIL))??;
            // NavigationCompleted waits for the static document's data images and
            // layout. Scripts and external fonts are disabled; there is no async
            // diagram work in this renderer, only the frozen export snapshot.
            let settings = environment
                .cast::<ICoreWebView2Environment6>()?
                .CreatePrintSettings()?;
            let (width, height) = match input.page_size {
                PageSize::A4 => (210.0 / 25.4, 297.0 / 25.4),
                PageSize::Letter => (8.5, 11.0),
            };
            settings.SetPageWidth(width)?;
            settings.SetPageHeight(height)?;
            settings.SetOrientation(if input.landscape {
                COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
            } else {
                COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
            })?;
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            settings.SetMarginTop(0.0)?;
            settings.SetMarginBottom(0.0)?;
            settings.SetMarginLeft(0.0)?;
            settings.SetMarginRight(0.0)?;
            let selection = if input.print {
                printer::choose(&settings, window, input.page_size, input.landscape)?
            } else {
                printer::Selection::Pdf
            };
            if selection == printer::Selection::Cancelled {
                return Ok(Rendered::Cancelled);
            }
            if selection == printer::Selection::Printer {
                let (tx, rx) = mpsc::channel();
                view.cast::<ICoreWebView2_16>()?.Print(
                    &settings,
                    &PrintCompletedHandler::create(Box::new(move |hr, status| {
                        let _ = tx.send(hr.map(|_| status));
                        Ok(())
                    })),
                )?;
                let status =
                    pump(&rx, deadline).map_err(|_| ::windows::core::Error::from(E_FAIL))??;
                return if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
                    Ok(Rendered::Printed)
                } else {
                    Err(::windows::core::Error::new(
                        E_FAIL,
                        format!("Printer did not accept document (status {})", status.0),
                    ))
                };
            }
            let (tx, rx) = mpsc::channel();
            view.cast::<ICoreWebView2_16>()?.PrintToPdfStream(
                &settings,
                &PrintToPdfStreamCompletedHandler::create(Box::new(move |hr, stream| {
                    let _ = tx.send(hr.and_then(|_| stream.ok_or_else(|| E_FAIL.into())));
                    Ok(())
                })),
            )?;
            let stream =
                pump(&rx, deadline).map_err(|_| ::windows::core::Error::from(E_FAIL))??;
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0u8; 16384];
                let mut count = 0;
                stream
                    .Read(
                        chunk.as_mut_ptr().cast(),
                        chunk.len() as u32,
                        Some(&mut count),
                    )
                    .ok()?;
                if bytes.len() + count as usize > MAX_PDF {
                    return Err(E_FAIL.into());
                }
                bytes.extend_from_slice(&chunk[..count as usize]);
                if count == 0 {
                    break;
                }
            }
            Ok(if input.print {
                Rendered::PdfPrint(bytes)
            } else {
                Rendered::Pdf(bytes)
            })
        }
    })();
    unsafe {
        let _ = controller.Close();
        let _ = DestroyWindow(window);
    }
    result.map_err(error)
}

pub(in crate::output) fn run_pdf_helper() {
    let result = (|| {
        // No COM initialization or browser launch until the host has assigned
        // its kill-on-close Job and provided a bounded input frame.
        let bytes = frame_read(&mut std::io::stdin().lock(), MAX_HTML * 6 + 65536)?;
        let input: Input = serde_json::from_slice(&bytes).map_err(error)?;
        validate_html(&input.html)?;
        pdf(input)
    })();
    #[cfg(not(test))]
    let mut output = std::io::stdout().lock();
    #[cfg(test)]
    let mut output = std::io::stderr().lock();
    match result {
        Ok(result) => {
            let (status, bytes) = match result {
                Rendered::Pdf(bytes) => (0, bytes),
                Rendered::PdfPrint(bytes) => (4, bytes),
                Rendered::Printed => (2, b"printed".to_vec()),
                Rendered::Cancelled => (3, b"cancelled".to_vec()),
            };
            let _ = output.write_all(&[status]);
            let _ = frame_write(&mut output, &bytes);
        }
        Err(failure) => {
            let _ = output.write_all(&[1]);
            let bytes = failure.as_bytes();
            let _ = frame_write(&mut output, &bytes[..bytes.len().min(4096)]);
        }
    }
    // Stay alive until the owner has observed the complete frame and empties
    // the Job. This avoids orphaning a browser process on normal completion.
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_frame_rejects_empty_oversized_and_truncated_messages() {
        for bytes in [vec![0, 0, 0, 0], vec![5, 0, 0, 0], vec![3, 0, 0, 0, 1]] {
            assert!(frame_read(&mut bytes.as_slice(), 4).is_err());
        }
        assert_eq!(
            frame_read(&mut [3, 0, 0, 0, 1, 2, 3].as_slice(), 4).unwrap(),
            vec![1, 2, 3]
        );
    }
    fn lease() -> Arc<Job> {
        Arc::new(Job {
            format: Format::Pdf,
            source: None,
            source_identity: None,
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            state: Mutex::new(JobState::Running),
        })
    }
    fn fixture_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "output::windows::pdf::tests::helper_fixture",
                "--exact",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("MILKUP_PDF_FIXTURE", mode);
        command
    }
    #[test]
    #[ignore = "owned subprocess fixture, called by Windows output contract tests"]
    fn helper_fixture() {
        let Ok(mode) = std::env::var("MILKUP_PDF_FIXTURE") else {
            return;
        };
        if mode == "native" {
            run_pdf_helper();
        }
        let _ = frame_read(&mut std::io::stdin().lock(), MAX_HTML * 6 + 65536).unwrap();
        match mode.as_str() {
            "partial" => {
                std::io::stderr()
                    .write_all(&[0, 10, 0, 0, 0, b'%'])
                    .unwrap();
                std::process::exit(0);
            }
            "oversized" => {
                std::io::stderr().write_all(&[0]).unwrap();
                std::io::stderr()
                    .write_all(&((MAX_PDF + 1) as u32).to_le_bytes())
                    .unwrap();
            }
            "invalid" => {
                std::io::stderr().write_all(&[0]).unwrap();
                frame_write(&mut std::io::stderr(), b"not a PDF").unwrap();
            }
            "trailing" => {
                // One write includes the entire frame and forbidden trailer,
                // ensuring the counterexample cannot race helper termination.
                std::io::stderr()
                    .write_all(&[0, 5, 0, 0, 0, b'%', b'P', b'D', b'F', b'-', 42])
                    .unwrap();
            }
            "printed" | "cancelled" => {
                std::io::stderr()
                    .write_all(&[if mode == "printed" { 2 } else { 3 }])
                    .unwrap();
                frame_write(&mut std::io::stderr(), mode.as_bytes()).unwrap();
            }
            "hang" => {}
            _ => panic!("Unknown fixture"),
        }
        loop {
            std::thread::sleep(Duration::from_secs(1));
        }
    }
    #[test]
    fn owned_helper_rejects_truncated_oversized_and_non_pdf_results() {
        for mode in ["partial", "oversized", "invalid", "trailing"] {
            assert!(render_with_command(
                &lease(),
                "<p>test</p>".into(),
                PageSize::A4,
                false,
                fixture_command(mode)
            )
            .is_err());
        }
    }
    #[test]
    fn print_protocol_distinguishes_submission_cancel_and_mismatched_pdf_leases() {
        let mut job = lease();
        Arc::get_mut(&mut job).unwrap().format = Format::Print;
        assert!(matches!(
            render_with_command(
                &job,
                "<p>test</p>".into(),
                PageSize::A4,
                false,
                fixture_command("printed")
            )
            .unwrap(),
            NativeResult::Printed
        ));
        assert!(matches!(
            render_with_command(
                &job,
                "<p>test</p>".into(),
                PageSize::A4,
                false,
                fixture_command("cancelled")
            )
            .unwrap(),
            NativeResult::Cancelled
        ));
        assert!(render_with_command(
            &lease(),
            "<p>test</p>".into(),
            PageSize::A4,
            false,
            fixture_command("printed")
        )
        .is_err());
        // Protocol fixtures do not submit a printer job or prove a native dialog.
    }
    #[test]
    fn cancellation_terminates_helper_without_publishing() {
        let job = lease();
        let cancel = job.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            cancel.cancelled.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let result = render_with_command(
            &job,
            "<p>test</p>".into(),
            PageSize::A4,
            false,
            fixture_command("hang"),
        );
        canceller.join().unwrap();
        assert!(matches!(result, Err(e) if e.contains("cancelled")));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
    #[test]
    #[ignore = "requires installed Evergreen WebView2; run explicitly on Windows native acceptance"]
    fn installed_webview2_renders_static_pdf_without_document_network_access() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let html = format!(
            r#"<!doctype html><meta charset=utf-8><style>@page{{size:A4;margin:18mm}}body{{font-family:Arial,sans-serif}}p{{break-inside:auto}}</style><h1>Milkup PDF 中文 😀</h1><p>Copy/search: “quotes”, fi, é, 原始文字</p><svg width='100' height='40' xmlns='http://www.w3.org/2000/svg'><text x='1' y='24'>diagram</text></svg><img src='http://{address}/blocked'><script>fetch('http://{address}/script')</script><iframe src='http://{address}/frame'></iframe>"#
        );
        for (size, landscape) in [(PageSize::A4, false), (PageSize::Letter, true)] {
            let result = render_with_command(
                &lease(),
                html.clone(),
                size,
                landscape,
                fixture_command("native"),
            )
            .unwrap();
            let NativeResult::Pdf(bytes, None) = result else {
                panic!("Unexpected renderer result");
            };
            assert!(bytes.starts_with(b"%PDF-"));
            assert!(bytes.len() > 1000);
            // Optional artifact destination is test-owned, never a plugin path.
            if let Some(root) = std::env::var_os("MILKUP_PDF_EVIDENCE_DIR") {
                let name = if landscape {
                    "letter-landscape.pdf"
                } else {
                    "a4.pdf"
                };
                fs::write(PathBuf::from(root).join(name), bytes).unwrap();
            }
        }
        assert!(matches!(listener.accept(), Err(e) if e.kind() == std::io::ErrorKind::WouldBlock));
        // Header/bytes and network denial are NOT text, pixel, pagination or GUI acceptance.
    }
}

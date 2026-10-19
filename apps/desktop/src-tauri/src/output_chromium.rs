//! A private, bounded CDP transport for static PDF output. This runs only in
//! the existing output guardian's renderer child; the guardian owns all of
//! Chromium's descendants even when the editor or renderer exits abruptly.
use super::{error, PageSize, Result, MAX_HTML, MAX_PDF};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
            process::CommandExt,
        },
    },
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

const EXECUTABLE: &str = "/usr/bin/chromium";
const URL: &str = "https://milkup-output.invalid/document";
const CSP: &str = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const MAX_FRAME: usize = 1024 * 1024;
const CHUNK: usize = 64 * 1024;
const RENDER_TIMEOUT: Duration = Duration::from_secs(50);

/// Write one complete private PDF, never a plugin-selected path. The caller
/// publishes or submits it only after this returns and its lease is rechecked.
pub(super) fn render(
    html: &str,
    directory: &Path,
    page_size: PageSize,
    landscape: bool,
) -> Result<()> {
    if html.is_empty() || html.len() > MAX_HTML {
        return Err("Output HTML exceeds its 32 MiB budget or is empty".into());
    }
    let (width, height) = paper_dimensions(page_size, landscape);
    // The native print dialog is authoritative over the captured paper option.
    // This trusted final rule changes size alone, preserving serializer margins.
    let document = format!("{html}<style>@page{{size:{width}mm {height}mm!important}}</style>");
    if document.len() > MAX_HTML {
        return Err("Output HTML including paper settings exceeds its 32 MiB budget".into());
    }
    trusted_executable(Path::new(EXECUTABLE))?;
    let profile = directory.join("chromium-profile");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&profile)
        .map_err(error)?;
    let path = directory.join("document.pdf");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&path)
        .map_err(error)?;
    let result = (|| {
        let mut cdp = Cdp::launch(&profile, document)?;
        let result = cdp.render_pdf(&mut file, width, height);
        let closing = cdp.close();
        result?;
        closing?;
        file.sync_all().map_err(error)
    })();
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    let _ = fs::remove_dir_all(&profile);
    result
}

fn paper_dimensions(size: PageSize, landscape: bool) -> (f64, f64) {
    let (w, h) = match size {
        PageSize::A4 => (210.0, 297.0),
        PageSize::Letter => (215.9, 279.4),
    };
    if landscape {
        (h, w)
    } else {
        (w, h)
    }
}

fn trusted_executable(path: &Path) -> Result<()> {
    let canonical = fs::canonicalize(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "[output:unsupported] System Chromium is required for PDF and printing; install it using the operating system package manager".to_string()
        } else { error(e) }
    })?;
    if !canonical.starts_with("/usr/") {
        return Err("System Chromium resolves outside its trusted system directory".into());
    }
    // Imported root-owned system files can appear as overflowuid in a user
    // namespace. Test actual writability as well as group/other write bits;
    // do not relax the sandbox or change system ownership to accommodate that.
    for candidate in path.ancestors().chain(canonical.ancestors()) {
        let metadata = fs::metadata(candidate).map_err(error)?;
        let name =
            std::ffi::CString::new(candidate.as_os_str().as_encoded_bytes()).map_err(error)?;
        if metadata.mode() & 0o022 != 0
            || unsafe {
                libc::faccessat(libc::AT_FDCWD, name.as_ptr(), libc::W_OK, libc::AT_EACCESS)
            } == 0
        {
            return Err(
                "System Chromium and its directories must not be writable by the application"
                    .into(),
            );
        }
    }
    let metadata = fs::metadata(canonical).map_err(error)?;
    if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
        return Err("System Chromium is not an executable regular file".into());
    }
    Ok(())
}

fn pipe() -> Result<(File, File)> {
    let mut fds = [-1; 2];
    if unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    Ok(unsafe { (File::from_raw_fd(fds[0]), File::from_raw_fd(fds[1])) })
}

fn nonblocking(file: &File) -> Result<()> {
    let fd = file.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    Ok(())
}

struct Cdp {
    child: Child,
    reader: File,
    writer: File,
    buffered: Vec<u8>,
    next_id: u64,
    session: Option<String>,
    document: Option<String>,
    deadline: Instant,
    loaded: Vec<String>,
}

impl Cdp {
    fn launch(profile: &Path, document: String) -> Result<Self> {
        let (input, writer) = pipe()?;
        let (reader, output) = pipe()?;
        nonblocking(&writer)?;
        nonblocking(&reader)?;
        let input_fd = input.as_raw_fd();
        let output_fd = output.as_raw_fd();
        let mut command = Command::new(EXECUTABLE);
        // No flags disabling Chromium sandboxing, web security or IPC limits.
        // The browser is a separate process with an empty private profile.
        command
            .args([
                "--headless",
                "--remote-debugging-pipe",
                "--no-startup-window",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-sync",
                "--disable-default-apps",
                "--disable-extensions",
                "--disable-breakpad",
                "--disable-domain-reliability",
                "--metrics-recording-only",
                "--password-store=basic",
            ])
            .arg(format!("--user-data-dir={}", profile.display()))
            .env("XDG_CONFIG_HOME", profile)
            .env("XDG_CACHE_HOME", profile)
            .env("PATH", "/usr/bin:/bin")
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("CHROMIUM_FLAGS")
            .env_remove("CHROME_FLAGS")
            .env_remove("CHROME_DEVEL_SANDBOX")
            .env_remove("CHROME_WRAPPER")
            .env_remove("CHROME_LOG_FILE")
            .env_remove("LD_LIBRARY_PATH")
            .env_remove("LD_PRELOAD")
            .env_remove("LD_AUDIT")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        unsafe {
            command.pre_exec(move || {
                // FD3 already belongs to the output helper. Duplicate above all
                // reserved descriptors before replacing either CDP endpoint.
                let r = libc::fcntl(input_fd, libc::F_DUPFD_CLOEXEC, 5);
                let w = libc::fcntl(output_fd, libc::F_DUPFD_CLOEXEC, 5);
                if r < 0 || w < 0 || libc::dup2(r, 3) < 0 || libc::dup2(w, 4) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                libc::close(r);
                libc::close(w);
                Ok(())
            });
        }
        let child = command.spawn().map_err(error)?;
        drop(input);
        drop(output);
        Ok(Self {
            child,
            reader,
            writer,
            buffered: Vec::new(),
            next_id: 0,
            session: None,
            document: Some(document),
            deadline: Instant::now() + RENDER_TIMEOUT,
            loaded: Vec::new(),
        })
    }

    fn poll(&self, fd: i32, events: i16) -> Result<()> {
        loop {
            let remaining = self
                .deadline
                .checked_duration_since(Instant::now())
                .ok_or("System Chromium output exceeded its time budget")?;
            let mut p = libc::pollfd {
                fd,
                events,
                revents: 0,
            };
            let result = unsafe { libc::poll(&mut p, 1, remaining.as_millis().min(100) as i32) };
            if result > 0 {
                if p.revents & (events | libc::POLLHUP) != 0 {
                    return Ok(());
                }
                return Err("System Chromium output pipe closed unexpectedly".into());
            }
            if result < 0
                && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted
            {
                return Err(error(std::io::Error::last_os_error()));
            }
        }
    }

    fn send(&mut self, method: &str, params: Value, session: bool) -> Result<u64> {
        self.next_id += 1;
        let id = self.next_id;
        let mut value = json!({ "id": id, "method": method, "params": params });
        if session {
            value["sessionId"] = json!(self.session.as_ref().ok_or("Missing output session")?);
        }
        let mut bytes = serde_json::to_vec(&value).map_err(error)?;
        if bytes.len() > MAX_HTML * 2 + MAX_FRAME {
            return Err("Output protocol command exceeds its budget".into());
        }
        bytes.push(0);
        let mut offset = 0;
        while offset < bytes.len() {
            self.poll(self.writer.as_raw_fd(), libc::POLLOUT)?;
            match self.writer.write(&bytes[offset..]) {
                Ok(0) => return Err("System Chromium output input closed".into()),
                Ok(n) => offset += n,
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(e) => return Err(error(e)),
            }
        }
        Ok(id)
    }

    fn receive(&mut self) -> Result<Value> {
        loop {
            if let Some(value) = take_frame(&mut self.buffered)? {
                return Ok(value);
            }
            self.poll(self.reader.as_raw_fd(), libc::POLLIN)?;
            let mut chunk = [0; 8192];
            let capacity = chunk.len().min(MAX_FRAME - self.buffered.len());
            match self.reader.read(&mut chunk[..capacity]) {
                Ok(0) => return Err("System Chromium could not complete sandboxed output; verify the installed browser and operating system sandbox support".into()),
                Ok(n) => self.buffered.extend_from_slice(&chunk[..n]),
                Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted) => {},
                Err(e) => return Err(error(e)),
            }
        }
    }

    fn event(&mut self, value: &Value) -> Result<()> {
        // Includes replies to asynchronous interception commands: a failed
        // deny/fulfill must never be silently ignored while another call waits.
        if value.get("error").is_some() {
            return Err("System Chromium rejected a controlled output operation".into());
        }
        if value.get("sessionId").and_then(Value::as_str) != self.session.as_deref() {
            return Ok(());
        }
        match value.get("method").and_then(Value::as_str) {
            Some("Fetch.requestPaused") => {
                let p = &value["params"];
                let id = p["requestId"]
                    .as_str()
                    .ok_or("Missing intercepted request identity")?;
                if p["request"]["url"].as_str() == Some(URL)
                    && p["request"]["method"].as_str() == Some("GET")
                    && p["resourceType"].as_str() == Some("Document")
                    && self.document.is_some()
                {
                    let html = self.document.take().unwrap();
                    self.send("Fetch.fulfillRequest", json!({"requestId":id,"responseCode":200,
                        "responseHeaders":[{"name":"Content-Type","value":"text/html; charset=utf-8"},
                            {"name":"Content-Security-Policy","value":CSP},
                            {"name":"Cache-Control","value":"no-store"},
                            {"name":"X-Content-Type-Options","value":"nosniff"}],
                        "body":STANDARD.encode(html.as_bytes())}), true)?;
                } else {
                    self.send(
                        "Fetch.failRequest",
                        json!({"requestId":id,"errorReason":"BlockedByClient"}),
                        true,
                    )?;
                }
            }
            Some("Page.lifecycleEvent") if value["params"]["name"].as_str() == Some("load") => {
                let loader = value["params"]["loaderId"]
                    .as_str()
                    .ok_or("Missing output lifecycle identity")?;
                if loader.len() > 128 || self.loaded.len() >= 16 {
                    return Err("Unexpected output navigation lifecycle".into());
                }
                self.loaded.push(loader.to_owned());
            }
            Some("Page.javascriptDialogOpening") => {
                self.send("Page.handleJavaScriptDialog", json!({"accept":false}), true)?;
            }
            Some("Inspector.targetCrashed") => {
                return Err("System Chromium output renderer crashed".into())
            }
            _ => {}
        }
        Ok(())
    }

    fn call(&mut self, method: &str, params: Value, session: bool) -> Result<Value> {
        let id = self.send(method, params, session)?;
        loop {
            let value = self.receive()?;
            self.event(&value)?;
            if value["id"].as_u64() == Some(id) {
                if value.get("error").is_some() {
                    return Err(format!(
                        "System Chromium rejected output operation {method}"
                    ));
                }
                return value
                    .get("result")
                    .cloned()
                    .ok_or("Missing output protocol result".into());
            }
        }
    }

    fn render_pdf(&mut self, file: &mut File, width: f64, height: f64) -> Result<()> {
        self.call("Browser.getVersion", json!({}), false)?;
        let context = self.call(
            "Target.createBrowserContext",
            json!({"disposeOnDetach":true}),
            false,
        )?;
        let context_id = context["browserContextId"]
            .as_str()
            .ok_or("Missing private output context")?;
        self.call(
            "Browser.setDownloadBehavior",
            json!({"behavior":"deny","browserContextId":context_id}),
            false,
        )?;
        let target = self.call(
            "Target.createTarget",
            json!({"url":"about:blank","browserContextId":context_id}),
            false,
        )?;
        let target_id = target["targetId"].as_str().ok_or("Missing output page")?;
        let session = self.call(
            "Target.attachToTarget",
            json!({"targetId":target_id,"flatten":true}),
            false,
        )?;
        self.session = Some(
            session["sessionId"]
                .as_str()
                .ok_or("Missing output session")?
                .to_owned(),
        );
        self.call("Page.enable", json!({}), true)?;
        self.call(
            "Page.setLifecycleEventsEnabled",
            json!({"enabled":true}),
            true,
        )?;
        self.call(
            "Emulation.setScriptExecutionDisabled",
            json!({"value":true}),
            true,
        )?;
        self.call("Network.enable", json!({}), true)?;
        self.call(
            "Network.setCacheDisabled",
            json!({"cacheDisabled":true}),
            true,
        )?;
        self.call(
            "Network.setBypassServiceWorker",
            json!({"bypass":true}),
            true,
        )?;
        self.call(
            "Fetch.enable",
            json!({"patterns":[{"urlPattern":"*","requestStage":"Request"}]}),
            true,
        )?;
        self.call("Emulation.setEmulatedMedia", json!({"media":"print"}), true)?;
        self.loaded.clear();
        let navigation = self.call("Page.navigate", json!({"url":URL}), true)?;
        if navigation.get("errorText").is_some() {
            return Err("Static output document could not be loaded".into());
        }
        let loader = navigation["loaderId"]
            .as_str()
            .ok_or("Missing static output navigation identity")?;
        while !self.loaded.iter().any(|loaded| loaded == loader) {
            let event = self.receive()?;
            self.event(&event)?;
        }
        let result = self.call(
            "Page.printToPDF",
            json!({"printBackground":true,
            "displayHeaderFooter":false,"preferCSSPageSize":true,"paperWidth":width/25.4,
            "paperHeight":height/25.4,"generateTaggedPDF":true,"transferMode":"ReturnAsStream"}),
            true,
        )?;
        let stream = result["stream"]
            .as_str()
            .ok_or("System Chromium does not support bounded PDF streaming")?;
        let mut total = 0usize;
        let mut signature = Vec::new();
        let mut tail = Vec::with_capacity(1024);
        loop {
            let reply = self.call("IO.read", json!({"handle":stream,"size":CHUNK}), true)?;
            let data = decode_chunk(&reply)?;
            total = total
                .checked_add(data.len())
                .ok_or("Output PDF size overflow")?;
            if total > MAX_PDF {
                return Err("Output PDF exceeds its 64 MiB budget".into());
            }
            signature
                .extend_from_slice(&data[..data.len().min(5usize.saturating_sub(signature.len()))]);
            keep_pdf_tail(&mut tail, &data);
            file.write_all(&data).map_err(error)?;
            if reply["eof"].as_bool() == Some(true) {
                break;
            }
            if data.is_empty() {
                return Err("System Chromium returned an empty PDF stream chunk".into());
            }
        }
        self.call("IO.close", json!({"handle":stream}), true)?;
        if signature != b"%PDF-" || total < 8 || !has_pdf_eof(&tail) {
            return Err("System Chromium did not produce a complete PDF".into());
        }
        Ok(())
    }

    fn close(&mut self) -> Result<()> {
        self.deadline = Instant::now() + Duration::from_secs(3);
        let _ = self.send("Browser.close", json!({}), false);
        loop {
            if let Some(status) = self.child.try_wait().map_err(error)? {
                return if status.success() {
                    Ok(())
                } else {
                    Err("System Chromium output process failed".into())
                };
            }
            if Instant::now() >= self.deadline {
                return Err("System Chromium output cleanup exceeded its time budget".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Cdp {
    fn drop(&mut self) {
        // The separate guardian subsequently reaps all adopted descendants.
        // Never kill it before its ownership-based cleanup has completed.
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let end = Instant::now() + Duration::from_secs(1);
            while Instant::now() < end {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

fn keep_pdf_tail(tail: &mut Vec<u8>, chunk: &[u8]) {
    if chunk.len() >= 1024 {
        tail.clear();
        tail.extend_from_slice(&chunk[chunk.len() - 1024..]);
    } else {
        let remove = (tail.len() + chunk.len()).saturating_sub(1024);
        tail.drain(..remove);
        tail.extend_from_slice(chunk);
    }
}

fn has_pdf_eof(tail: &[u8]) -> bool {
    let end = tail
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map_or(0, |n| n + 1);
    end >= 5 && &tail[end - 5..end] == b"%%EOF"
}

fn take_frame(buffered: &mut Vec<u8>) -> Result<Option<Value>> {
    if let Some(end) = buffered.iter().position(|&b| b == 0) {
        if end >= MAX_FRAME {
            return Err("Output protocol response exceeds its budget".into());
        }
        let value = serde_json::from_slice(&buffered[..end]).map_err(error)?;
        buffered.drain(..=end);
        Ok(Some(value))
    } else if buffered.len() >= MAX_FRAME {
        Err("Output protocol response exceeds its budget".into())
    } else {
        Ok(None)
    }
}

fn decode_chunk(reply: &Value) -> Result<Vec<u8>> {
    let text = reply["data"].as_str().ok_or("Missing PDF stream data")?;
    let encoded = reply["base64Encoded"].as_bool().unwrap_or(false);
    if text.len()
        > if encoded {
            CHUNK.div_ceil(3) * 4
        } else {
            CHUNK
        }
    {
        return Err("Output PDF stream chunk exceeds its budget".into());
    }
    let bytes = if encoded {
        STANDARD.decode(text).map_err(error)?
    } else {
        text.as_bytes().to_vec()
    };
    if bytes.len() > CHUNK {
        return Err("Output PDF stream chunk exceeds its budget".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_completion_requires_a_terminal_marker_across_stream_boundaries() {
        let mut tail = Vec::new();
        keep_pdf_tail(&mut tail, &vec![b'x'; CHUNK]);
        keep_pdf_tail(&mut tail, b"\n%%E");
        assert!(!has_pdf_eof(&tail));
        keep_pdf_tail(&mut tail, b"OF\r\n");
        assert!(has_pdf_eof(&tail));
        assert_eq!(tail.len(), 1024);
        keep_pdf_tail(&mut tail, b"trailing-garbage");
        assert!(!has_pdf_eof(&tail));
        assert!(!has_pdf_eof(b"%PDF-1.4\ntruncated"));
    }

    #[test]
    fn protocol_frames_reject_malformed_and_unterminated_oversized_messages() {
        assert!(take_frame(&mut b"not json\0".to_vec()).is_err());
        assert!(take_frame(&mut vec![b'x'; MAX_FRAME]).is_err());
        let mut coalesced = b"{\"id\":1}\0{\"id\":2}\0".to_vec();
        assert_eq!(take_frame(&mut coalesced).unwrap().unwrap()["id"], 1);
        assert_eq!(take_frame(&mut coalesced).unwrap().unwrap()["id"], 2);
        assert!(take_frame(&mut coalesced).unwrap().is_none());
        assert!(take_frame(&mut b"{\"id\":".to_vec()).unwrap().is_none());
    }

    #[test]
    fn stream_chunks_enforce_encoded_and_decoded_bounds() {
        assert_eq!(
            decode_chunk(&json!({"data":"JVBERi0=","base64Encoded":true})).unwrap(),
            b"%PDF-"
        );
        assert!(decode_chunk(&json!({"data":"!!!!","base64Encoded":true})).is_err());
        assert!(decode_chunk(&json!({"data":"x".repeat(CHUNK + 1)})).is_err());
        assert!(decode_chunk(
            &json!({"data":STANDARD.encode(vec![0; CHUNK + 1]),"base64Encoded":true})
        )
        .is_err());
        assert_eq!(
            decode_chunk(&json!({"data":STANDARD.encode(vec![0; CHUNK]),"base64Encoded":true}))
                .unwrap()
                .len(),
            CHUNK
        );
    }

    #[test]
    fn output_options_determine_paper_dimensions() {
        assert_eq!(paper_dimensions(PageSize::A4, false), (210.0, 297.0));
        assert_eq!(paper_dimensions(PageSize::Letter, true), (279.4, 215.9));
    }

    #[test]
    fn html_budget_is_rejected_before_browser_or_filesystem_work() {
        assert!(render("", Path::new("/not-created"), PageSize::A4, false).is_err());
        assert!(render(
            &"x".repeat(MAX_HTML + 1),
            Path::new("/not-created"),
            PageSize::A4,
            false
        )
        .is_err());
    }
}

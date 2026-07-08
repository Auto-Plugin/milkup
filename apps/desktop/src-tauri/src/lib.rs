use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, Window};

const FILE_WATCH_EVENT_NAME: &str = "milkup-file-watch-event";
const PLUGIN_SIDECAR_EVENT_NAME: &str = "milkup-plugin-sidecar-message";
#[cfg(windows)]
const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
#[cfg(windows)]
const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn MoveFileExW(
        lp_existing_file_name: *const u16,
        lp_new_file_name: *const u16,
        dw_flags: u32,
    ) -> i32;
}

struct WatchRegistry(Mutex<HashMap<String, WatchRegistration>>);
struct SidecarRegistry(Mutex<HashMap<String, SidecarProcessRegistration>>);
struct LargeFileRegistry(Mutex<HashMap<String, LargeFileRegistration>>);

struct WatchRegistration {
    stop: Arc<AtomicBool>,
}

struct SidecarProcessRegistration {
    child: Child,
    stdin: ChildStdin,
}

struct LargeFileRegistration {
    path: String,
    text: String,
    line_starts: Vec<usize>,
    line_utf16_starts: Vec<usize>,
    version: usize,
}

#[tauri::command]
fn bridge_status() -> &'static str {
    "ok"
}

#[tauri::command]
fn window_control(window: Window, action: String) -> Result<bool, String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|error| error.to_string())?,
        "maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())?;
            } else {
                window.maximize().map_err(|error| error.to_string())?;
            }
        }
        "close" => window.close().map_err(|error| error.to_string())?,
        _ => return Err(format!("Unknown window control action: {action}")),
    }

    Ok(true)
}

#[tauri::command]
fn initial_open_file_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| is_supported_markdown_path(path))
        .map(path_to_string)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentFileIdentity {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileResult {
    document_id: String,
    file: DocumentFileIdentity,
    text: String,
    disk_snapshot_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileResult {
    document_id: String,
    file: DocumentFileIdentity,
    disk_snapshot_hash: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileWatchEvent {
    kind: FileWatchEventKind,
    document_id: String,
    file: DocumentFileIdentity,
    disk_snapshot_hash: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum FileWatchEventKind {
    Modified,
    Deleted,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginSidecarMessageEvent {
    plugin_id: String,
    message: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileOpenResult {
    document_id: String,
    path: String,
    version: usize,
    size_bytes: usize,
    line_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileChunkResult {
    document_id: String,
    from_byte: usize,
    to_byte: usize,
    from_utf16: usize,
    to_utf16: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileLine {
    number: usize,
    from_byte: usize,
    to_byte: usize,
    from_utf16: usize,
    to_utf16: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileLineWindowResult {
    document_id: String,
    from_line: usize,
    to_line: usize,
    from_byte: usize,
    to_byte: usize,
    from_utf16: usize,
    to_utf16: usize,
    text: String,
    lines: Vec<LargeFileLine>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileTextChange {
    from_utf16: usize,
    to_utf16: usize,
    insert: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileSnapshotResult {
    document_id: String,
    path: String,
    version: usize,
    size_bytes: usize,
    line_count: usize,
}

#[tauri::command]
fn open_markdown_file(path: String) -> Result<OpenFileResult, String> {
    read_markdown_file(format!("file:{}", path), path)
}

#[tauri::command]
fn reload_markdown_file(document_id: String, path: String) -> Result<OpenFileResult, String> {
    read_markdown_file(document_id, path)
}

#[tauri::command]
fn save_markdown_file(
    document_id: String,
    path: String,
    text: String,
) -> Result<SaveFileResult, String> {
    fs::write(&path, &text).map_err(|error| error.to_string())?;

    Ok(SaveFileResult {
        document_id,
        file: DocumentFileIdentity { path },
        disk_snapshot_hash: snapshot_hash(&text),
    })
}

#[tauri::command]
fn ensure_asset_directory(path: String) -> Result<bool, String> {
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn asset_file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
fn write_asset_file(path: String, data: Vec<u8>) -> Result<bool, String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, data).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn resolve_plugin_file_path(path: String) -> Result<String, String> {
    resolve_plugin_path(&path).map(path_to_string)
}

#[tauri::command]
fn read_plugin_text_file(path: String) -> Result<String, String> {
    let resolved = resolve_plugin_path(&path)?;
    fs::read_to_string(resolved).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_plugin_text_file(path: String, text: String) -> Result<bool, String> {
    let resolved = resolve_plugin_path(&path)?;

    fs::write(resolved, text).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn delete_plugin_file(path: String) -> Result<bool, String> {
    let resolved = resolve_plugin_path(&path)?;

    fs::remove_file(resolved).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn open_large_text_file(
    registry: State<LargeFileRegistry>,
    document_id: String,
    path: String,
) -> Result<LargeFileOpenResult, String> {
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let line_starts = build_line_starts(&text);
    let line_utf16_starts = build_line_utf16_starts(&text);
    let size_bytes = text.len();
    let line_count = line_starts.len();

    {
        let mut stores = registry.0.lock().map_err(|error| error.to_string())?;
        stores.insert(
            document_id.clone(),
            LargeFileRegistration {
                path: path.clone(),
                text,
                line_starts,
                line_utf16_starts,
                version: 0,
            },
        );
    }

    Ok(LargeFileOpenResult {
        document_id,
        path,
        version: 0,
        size_bytes,
        line_count,
    })
}

#[tauri::command]
fn read_large_text_file_chunk(
    registry: State<LargeFileRegistry>,
    document_id: String,
    from_byte: usize,
    to_byte: usize,
) -> Result<LargeFileChunkResult, String> {
    let stores = registry.0.lock().map_err(|error| error.to_string())?;
    let store = require_large_file(&stores, &document_id)?;

    validate_byte_range(&store.text, from_byte, to_byte)?;

    Ok(LargeFileChunkResult {
        document_id,
        from_byte,
        to_byte,
        from_utf16: byte_to_utf16_offset(&store.text, from_byte)?,
        to_utf16: byte_to_utf16_offset(&store.text, to_byte)?,
        text: store.text[from_byte..to_byte].to_string(),
    })
}

#[tauri::command]
fn read_large_text_file_line_window(
    registry: State<LargeFileRegistry>,
    document_id: String,
    from_line: usize,
    to_line: usize,
) -> Result<LargeFileLineWindowResult, String> {
    let stores = registry.0.lock().map_err(|error| error.to_string())?;
    let store = require_large_file(&stores, &document_id)?;
    let (from_byte, to_byte, lines) = read_large_line_window(store, from_line, to_line)?;
    let from_utf16 = lines
        .first()
        .map(|line| line.from_utf16)
        .unwrap_or_default();
    let to_utf16 = lines.last().map(|line| line.to_utf16).unwrap_or(from_utf16);

    Ok(LargeFileLineWindowResult {
        document_id,
        from_line,
        to_line,
        from_byte,
        to_byte,
        from_utf16,
        to_utf16,
        text: store.text[from_byte..to_byte].to_string(),
        lines,
    })
}

#[tauri::command]
fn apply_large_text_file_changes(
    registry: State<LargeFileRegistry>,
    document_id: String,
    expected_version: usize,
    changes: Vec<LargeFileTextChange>,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = registry.0.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    if store.version != expected_version {
        return Err(format!(
            "Large text file version mismatch: expected {expected_version}, current {}",
            store.version
        ));
    }

    if !changes.is_empty() {
        store.text = apply_large_text_changes(&store.text, &changes)?;
        store.line_starts = build_line_starts(&store.text);
        store.line_utf16_starts = build_line_utf16_starts(&store.text);
        store.version += 1;
    }

    Ok(large_file_snapshot(&document_id, store))
}

#[tauri::command]
fn flush_large_text_file(
    registry: State<LargeFileRegistry>,
    document_id: String,
    expected_version: usize,
) -> Result<LargeFileSnapshotResult, String> {
    let stores = registry.0.lock().map_err(|error| error.to_string())?;
    let store = require_large_file(&stores, &document_id)?;

    if store.version != expected_version {
        return Err(format!(
            "Large text file version mismatch: expected {expected_version}, current {}",
            store.version
        ));
    }

    write_large_file_atomically(Path::new(&store.path), &store.text)?;

    Ok(large_file_snapshot(&document_id, store))
}

#[tauri::command]
fn close_large_text_file(
    registry: State<LargeFileRegistry>,
    document_id: String,
) -> Result<bool, String> {
    let mut stores = registry.0.lock().map_err(|error| error.to_string())?;

    stores.remove(&document_id);
    Ok(true)
}

#[tauri::command]
fn start_plugin_sidecar_process(
    app: AppHandle,
    registry: State<SidecarRegistry>,
    plugin_id: String,
    executable: String,
    args: Vec<String>,
    module_specifier: Option<String>,
) -> Result<bool, String> {
    let executable_path = validate_sidecar_executable(&executable)?;
    let mut command = Command::new(executable_path);

    command
        .args(args)
        .env("MILKUP_PLUGIN_ID", &plugin_id)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    if let Some(module_specifier) = module_specifier {
        command.env("MILKUP_PLUGIN_MODULE_SPECIFIER", module_specifier);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Plugin sidecar stdin was not available".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Plugin sidecar stdout was not available".to_string())?;
    let previous = {
        let mut sidecars = registry.0.lock().map_err(|error| error.to_string())?;
        sidecars.insert(
            plugin_id.clone(),
            SidecarProcessRegistration { child, stdin },
        )
    };

    if let Some(previous) = previous {
        stop_sidecar_registration(previous);
    }

    thread::spawn(move || {
        forward_sidecar_stdout(app, plugin_id, stdout);
    });

    Ok(true)
}

#[tauri::command]
fn send_plugin_sidecar_message(
    registry: State<SidecarRegistry>,
    plugin_id: String,
    message: serde_json::Value,
) -> Result<bool, String> {
    let mut sidecars = registry.0.lock().map_err(|error| error.to_string())?;
    let sidecar = sidecars
        .get_mut(&plugin_id)
        .ok_or_else(|| format!("Unknown plugin sidecar: {plugin_id}"))?;

    serde_json::to_writer(&mut sidecar.stdin, &message).map_err(|error| error.to_string())?;
    sidecar
        .stdin
        .write_all(b"\n")
        .map_err(|error| error.to_string())?;
    sidecar.stdin.flush().map_err(|error| error.to_string())?;

    Ok(true)
}

#[tauri::command]
fn stop_plugin_sidecar_process(
    registry: State<SidecarRegistry>,
    plugin_id: String,
) -> Result<bool, String> {
    let previous = {
        let mut sidecars = registry.0.lock().map_err(|error| error.to_string())?;
        sidecars.remove(&plugin_id)
    };

    if let Some(previous) = previous {
        stop_sidecar_registration(previous);
    }

    Ok(true)
}

#[tauri::command]
fn reveal_in_folder(_document_id: String, path: String) -> Result<bool, String> {
    let target = Path::new(&path)
        .parent()
        .ok_or_else(|| "Cannot reveal a path without a parent directory".to_string())?;

    if std::env::var_os("MILKUP_DESKTOP_TEST_SKIP_REVEAL").is_some() {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(true)
}

#[tauri::command]
fn watch_markdown_file(
    app: AppHandle,
    registry: State<WatchRegistry>,
    document_id: String,
    path: String,
    disk_snapshot_hash: Option<String>,
) -> Result<bool, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let previous = {
        let mut watchers = registry.0.lock().map_err(|error| error.to_string())?;
        watchers.insert(
            document_id.clone(),
            WatchRegistration { stop: stop.clone() },
        )
    };

    if let Some(previous) = previous {
        previous.stop.store(true, Ordering::Relaxed);
    }

    let watched_document_id = document_id.clone();
    let watched_path = path.clone();

    thread::spawn(move || {
        poll_watched_file(
            app,
            watched_document_id,
            watched_path,
            disk_snapshot_hash,
            stop,
        );
    });

    Ok(true)
}

#[tauri::command]
fn unwatch_markdown_file(
    registry: State<WatchRegistry>,
    document_id: String,
) -> Result<bool, String> {
    let previous = {
        let mut watchers = registry.0.lock().map_err(|error| error.to_string())?;
        watchers.remove(&document_id)
    };

    if let Some(previous) = previous {
        previous.stop.store(true, Ordering::Relaxed);
    }

    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .manage(WatchRegistry(Mutex::new(HashMap::new())))
        .manage(SidecarRegistry(Mutex::new(HashMap::new())))
        .manage(LargeFileRegistry(Mutex::new(HashMap::new())))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            bridge_status,
            window_control,
            initial_open_file_path,
            open_markdown_file,
            reload_markdown_file,
            save_markdown_file,
            ensure_asset_directory,
            asset_file_exists,
            write_asset_file,
            resolve_plugin_file_path,
            read_plugin_text_file,
            write_plugin_text_file,
            delete_plugin_file,
            open_large_text_file,
            read_large_text_file_chunk,
            read_large_text_file_line_window,
            apply_large_text_file_changes,
            flush_large_text_file,
            close_large_text_file,
            start_plugin_sidecar_process,
            send_plugin_sidecar_message,
            stop_plugin_sidecar_process,
            reveal_in_folder,
            watch_markdown_file,
            unwatch_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("failed to run milkup desktop app");
}

fn snapshot_hash(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn read_markdown_file(document_id: String, path: String) -> Result<OpenFileResult, String> {
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;

    Ok(OpenFileResult {
        document_id,
        file: DocumentFileIdentity { path },
        disk_snapshot_hash: snapshot_hash(&text),
        text,
    })
}

fn is_supported_markdown_path(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };

    matches!(
        extension.to_ascii_lowercase().as_str(),
        "md" | "markdown" | "mdown" | "mkd"
    )
}

fn poll_watched_file(
    app: AppHandle,
    document_id: String,
    path: String,
    disk_snapshot_hash: Option<String>,
    stop: Arc<AtomicBool>,
) {
    let mut last_snapshot_hash = disk_snapshot_hash.or_else(|| read_snapshot_hash(&path).ok());
    let mut was_deleted = !Path::new(&path).exists();

    while !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(1000));

        if stop.load(Ordering::Relaxed) {
            break;
        }

        let exists = Path::new(&path).exists();

        if !exists {
            if !was_deleted {
                was_deleted = true;
                emit_file_watch_event(
                    &app,
                    FileWatchEvent {
                        kind: FileWatchEventKind::Deleted,
                        document_id: document_id.clone(),
                        file: DocumentFileIdentity { path: path.clone() },
                        disk_snapshot_hash: None,
                    },
                );
            }

            continue;
        }

        was_deleted = false;

        let next_snapshot_hash = match read_snapshot_hash(&path) {
            Ok(hash) => hash,
            Err(_) => continue,
        };

        if last_snapshot_hash.as_deref() != Some(next_snapshot_hash.as_str()) {
            last_snapshot_hash = Some(next_snapshot_hash.clone());
            emit_file_watch_event(
                &app,
                FileWatchEvent {
                    kind: FileWatchEventKind::Modified,
                    document_id: document_id.clone(),
                    file: DocumentFileIdentity { path: path.clone() },
                    disk_snapshot_hash: Some(next_snapshot_hash),
                },
            );
        }
    }
}

fn read_snapshot_hash(path: &str) -> Result<String, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(snapshot_hash(&text))
}

fn resolve_plugin_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);

    if candidate.exists() {
        return candidate.canonicalize().map_err(|error| error.to_string());
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "Plugin file path must have a parent directory".to_string())?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "Plugin file path must have a file name".to_string())?;
    let resolved_parent = parent.canonicalize().map_err(|error| error.to_string())?;

    Ok(resolved_parent.join(file_name))
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('\\', "/")
}

fn emit_file_watch_event(app: &AppHandle, event: FileWatchEvent) {
    let _ = app.emit(FILE_WATCH_EVENT_NAME, event);
}

fn validate_sidecar_executable(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Plugin sidecar executable path must be non-empty".to_string());
    }

    let executable = PathBuf::from(path);

    if !executable.is_absolute() {
        return Err("Plugin sidecar executable path must be absolute".to_string());
    }

    Ok(executable)
}

fn forward_sidecar_stdout(app: AppHandle, plugin_id: String, stdout: impl std::io::Read) {
    let reader = BufReader::new(stdout);

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        let _ = app.emit(
            PLUGIN_SIDECAR_EVENT_NAME,
            PluginSidecarMessageEvent {
                plugin_id: plugin_id.clone(),
                message,
            },
        );
    }
}

fn stop_sidecar_registration(mut registration: SidecarProcessRegistration) {
    let _ = registration.child.kill();
    let _ = registration.child.wait();
}

fn build_line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];

    for (index, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(index + 1);
        }
    }

    starts
}

fn build_line_utf16_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];
    let mut utf16_offset = 0;

    for character in text.chars() {
        utf16_offset += character.len_utf16();

        if character == '\n' {
            starts.push(utf16_offset);
        }
    }

    starts
}

fn require_large_file<'a>(
    stores: &'a HashMap<String, LargeFileRegistration>,
    document_id: &str,
) -> Result<&'a LargeFileRegistration, String> {
    stores
        .get(document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))
}

fn validate_byte_range(text: &str, from_byte: usize, to_byte: usize) -> Result<(), String> {
    if from_byte > to_byte || to_byte > text.len() {
        return Err(format!(
            "Invalid byte range: {from_byte}-{to_byte} for {} bytes",
            text.len()
        ));
    }

    if !text.is_char_boundary(from_byte) || !text.is_char_boundary(to_byte) {
        return Err(format!(
            "Byte range must align to UTF-8 character boundaries: {from_byte}-{to_byte}"
        ));
    }

    Ok(())
}

fn byte_to_utf16_offset(text: &str, byte_offset: usize) -> Result<usize, String> {
    validate_byte_range(text, byte_offset, byte_offset)?;

    Ok(text[..byte_offset].encode_utf16().count())
}

fn utf16_to_byte_offset(text: &str, utf16_offset: usize) -> Result<usize, String> {
    let mut current_utf16 = 0;

    for (byte_offset, character) in text.char_indices() {
        if current_utf16 == utf16_offset {
            return Ok(byte_offset);
        }

        let next_utf16 = current_utf16 + character.len_utf16();

        if utf16_offset < next_utf16 {
            return Err(format!(
                "UTF-16 offset {utf16_offset} does not align to a Unicode scalar boundary"
            ));
        }

        current_utf16 = next_utf16;
    }

    if current_utf16 == utf16_offset {
        Ok(text.len())
    } else {
        Err(format!(
            "UTF-16 offset {utf16_offset} exceeds document length {current_utf16}"
        ))
    }
}

fn apply_large_text_changes(text: &str, changes: &[LargeFileTextChange]) -> Result<String, String> {
    let mut resolved_changes = changes
        .iter()
        .map(|change| {
            if change.from_utf16 > change.to_utf16 {
                return Err(format!(
                    "Invalid UTF-16 change range: {}-{}",
                    change.from_utf16, change.to_utf16
                ));
            }

            Ok((
                utf16_to_byte_offset(text, change.from_utf16)?,
                utf16_to_byte_offset(text, change.to_utf16)?,
                change.insert.as_str(),
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;

    resolved_changes.sort_by_key(|(from_byte, to_byte, _insert)| (*from_byte, *to_byte));

    let mut next_text = String::with_capacity(text.len());
    let mut cursor = 0;

    for (from_byte, to_byte, insert) in resolved_changes {
        if from_byte < cursor {
            return Err("Large text file changes must not overlap".to_string());
        }

        next_text.push_str(&text[cursor..from_byte]);
        next_text.push_str(insert);
        cursor = to_byte;
    }

    next_text.push_str(&text[cursor..]);
    Ok(next_text)
}

fn large_file_snapshot(
    document_id: &str,
    store: &LargeFileRegistration,
) -> LargeFileSnapshotResult {
    LargeFileSnapshotResult {
        document_id: document_id.to_string(),
        path: store.path.clone(),
        version: store.version,
        size_bytes: store.text.len(),
        line_count: store.line_starts.len(),
    }
}

fn write_large_file_atomically(path: &Path, text: &str) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    {
        let mut temp_file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        temp_file
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        temp_file.sync_all().map_err(|error| error.to_string())?;
    }

    if let Err(error) = replace_file_atomically(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(())
}

#[cfg(windows)]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), String> {
    let from_wide = wide_path(from);
    let to_wide = wide_path(to);
    let result = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(not(windows))]
fn replace_file_atomically(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|error| error.to_string())
}

fn read_large_line_window(
    store: &LargeFileRegistration,
    from_line: usize,
    to_line: usize,
) -> Result<(usize, usize, Vec<LargeFileLine>), String> {
    if from_line == 0 || to_line < from_line || to_line > store.line_starts.len() {
        return Err(format!(
            "Invalid line window: {from_line}-{to_line} for {} lines",
            store.line_starts.len()
        ));
    }

    let from_byte = store.line_starts[from_line - 1];
    let to_byte = line_content_end_byte(store, to_line);
    let mut lines = Vec::with_capacity(to_line - from_line + 1);

    for number in from_line..=to_line {
        let line_from = store.line_starts[number - 1];
        let line_to = line_content_end_byte(store, number);

        lines.push(LargeFileLine {
            number,
            from_byte: line_from,
            to_byte: line_to,
            from_utf16: byte_to_utf16_offset_in_line(store, number, line_from)?,
            to_utf16: byte_to_utf16_offset_in_line(store, number, line_to)?,
            text: store.text[line_from..line_to].to_string(),
        });
    }

    Ok((from_byte, to_byte, lines))
}

fn line_content_end_byte(store: &LargeFileRegistration, line_number: usize) -> usize {
    let raw_end = if line_number < store.line_starts.len() {
        store.line_starts[line_number] - 1
    } else {
        store.text.len()
    };

    if raw_end > 0 && store.text.as_bytes().get(raw_end - 1) == Some(&b'\r') {
        raw_end - 1
    } else {
        raw_end
    }
}

fn byte_to_utf16_offset_in_line(
    store: &LargeFileRegistration,
    line_number: usize,
    byte_offset: usize,
) -> Result<usize, String> {
    let line_start = store.line_starts[line_number - 1];
    let line_utf16_start = store.line_utf16_starts[line_number - 1];

    if byte_offset < line_start || byte_offset > store.text.len() {
        return Err(format!(
            "Invalid line byte offset: {byte_offset} for line {line_number}"
        ));
    }

    if !store.text.is_char_boundary(byte_offset) {
        return Err(format!(
            "Byte offset {byte_offset} is not on a UTF-8 character boundary"
        ));
    }

    Ok(line_utf16_start + store.text[line_start..byte_offset].encode_utf16().count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn open_and_reload_markdown_files_preserve_document_identity() {
        let dir = create_test_dir("open-reload");
        let path = dir.join("note.md");

        fs::write(&path, "# Title\r\n\r\nbody\r\n").expect("write fixture");

        let opened =
            open_markdown_file(path_to_string(path.clone())).expect("open markdown fixture");
        assert_eq!(
            opened.document_id,
            format!("file:{}", path_to_string(path.clone()))
        );
        assert_eq!(opened.file.path, path_to_string(path.clone()));
        assert_eq!(opened.text, "# Title\r\n\r\nbody\r\n");

        fs::write(&path, "# Title\n\nupdated\n").expect("update fixture");

        let reloaded = reload_markdown_file("doc-1".to_string(), path_to_string(path.clone()))
            .expect("reload markdown fixture");
        assert_eq!(reloaded.document_id, "doc-1");
        assert_eq!(reloaded.file.path, path_to_string(path.clone()));
        assert_eq!(reloaded.text, "# Title\n\nupdated\n");

        remove_test_dir(dir);
    }

    #[test]
    fn save_markdown_file_writes_text_and_returns_matching_document_id() {
        let dir = create_test_dir("save");
        let path = dir.join("saved.md");
        let text = "alpha\r\nbeta\r\n".to_string();

        let result = save_markdown_file("doc-save".to_string(), path_to_string(path.clone()), text)
            .expect("save markdown file");

        assert_eq!(result.document_id, "doc-save");
        assert_eq!(result.file.path, path_to_string(path.clone()));
        assert_eq!(
            fs::read_to_string(&path).expect("read saved markdown"),
            "alpha\r\nbeta\r\n",
        );

        remove_test_dir(dir);
    }

    #[test]
    fn asset_commands_create_directories_write_files_and_check_existence() {
        let dir = create_test_dir("asset");
        let asset_dir = dir.join("assets");
        let asset_path = asset_dir.join("image.bin");

        assert!(ensure_asset_directory(path_to_string(asset_dir.clone())).expect("ensure dir"));
        assert!(
            !asset_file_exists(path_to_string(asset_path.clone())).expect("missing asset check")
        );
        assert!(
            write_asset_file(path_to_string(asset_path.clone()), vec![1, 2, 3])
                .expect("write asset")
        );
        assert!(asset_file_exists(path_to_string(asset_path.clone())).expect("asset exists"));
        assert_eq!(fs::read(&asset_path).expect("read asset"), vec![1, 2, 3]);

        remove_test_dir(dir);
    }

    #[test]
    fn plugin_file_commands_resolve_and_mutate_canonical_paths() {
        let dir = create_test_dir("plugin-file");
        let path = dir.join("plugin.md");

        fs::write(&path, "plugin").expect("write plugin fixture");

        let resolved =
            resolve_plugin_file_path(path_to_string(path.clone())).expect("resolve plugin path");
        assert_eq!(resolved, path_to_string(path.clone()));
        assert_eq!(
            read_plugin_text_file(path_to_string(path.clone())).expect("read plugin file"),
            "plugin",
        );
        assert!(
            write_plugin_text_file(path_to_string(path.clone()), "updated".to_string())
                .expect("write plugin file")
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read updated plugin file"),
            "updated"
        );
        assert!(delete_plugin_file(path_to_string(path.clone())).expect("delete plugin file"));
        assert!(!path.exists());

        remove_test_dir(dir);
    }

    #[test]
    fn plugin_sidecar_executable_must_be_absolute() {
        assert!(validate_sidecar_executable("").is_err());
        assert!(validate_sidecar_executable("relative-sidecar").is_err());

        let absolute = std::env::temp_dir().join("sidecar.exe");

        assert_eq!(
            validate_sidecar_executable(&path_to_string(absolute.clone()))
                .expect("absolute sidecar executable"),
            absolute
        );
    }

    #[test]
    fn plugin_sidecar_event_uses_camel_case_payload() {
        let event = PluginSidecarMessageEvent {
            plugin_id: "sidecar-tools".to_string(),
            message: serde_json::json!({ "type": "ready" }),
        };

        assert_eq!(
            serde_json::to_value(event).expect("serialize sidecar event"),
            serde_json::json!({
                "pluginId": "sidecar-tools",
                "message": {
                    "type": "ready"
                }
            })
        );
    }

    #[test]
    fn large_file_line_index_handles_lf_crlf_and_trailing_newline() {
        let store = LargeFileRegistration {
            path: "large.md".to_string(),
            text: "alpha\r\nbeta\n".to_string(),
            line_starts: build_line_starts("alpha\r\nbeta\n"),
            line_utf16_starts: build_line_utf16_starts("alpha\r\nbeta\n"),
            version: 0,
        };

        assert_eq!(store.line_starts, vec![0, 7, 12]);

        let (from_byte, to_byte, lines) =
            read_large_line_window(&store, 1, 3).expect("read line window");

        assert_eq!(from_byte, 0);
        assert_eq!(to_byte, 12);
        assert_eq!(
            store.text[from_byte..to_byte].to_string(),
            "alpha\r\nbeta\n"
        );
        assert_eq!(
            lines
                .iter()
                .map(|line| {
                    (
                        line.number,
                        line.from_byte,
                        line.to_byte,
                        line.from_utf16,
                        line.to_utf16,
                        line.text.as_str(),
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                (1, 0, 5, 0, 5, "alpha"),
                (2, 7, 11, 7, 11, "beta"),
                (3, 12, 12, 12, 12, "")
            ]
        );
    }

    #[test]
    fn large_file_maps_utf8_bytes_to_utf16_offsets() {
        let text = "a😀中\r\nb";
        let store = LargeFileRegistration {
            path: "large.md".to_string(),
            text: text.to_string(),
            line_starts: build_line_starts(text),
            line_utf16_starts: build_line_utf16_starts(text),
            version: 0,
        };

        assert_eq!(byte_to_utf16_offset(text, 0).expect("start offset"), 0);
        assert_eq!(byte_to_utf16_offset(text, 1).expect("ascii offset"), 1);
        assert_eq!(byte_to_utf16_offset(text, 5).expect("emoji offset"), 3);
        assert_eq!(byte_to_utf16_offset(text, 8).expect("cjk offset"), 4);
        assert!(byte_to_utf16_offset(text, 2).is_err());

        let (_from_byte, _to_byte, lines) =
            read_large_line_window(&store, 1, 2).expect("read unicode line window");

        assert_eq!(
            lines
                .iter()
                .map(|line| {
                    (
                        line.number,
                        line.from_byte,
                        line.to_byte,
                        line.from_utf16,
                        line.to_utf16,
                        line.text.as_str(),
                    )
                })
                .collect::<Vec<_>>(),
            vec![(1, 0, 8, 0, 4, "a😀中"), (2, 10, 11, 6, 7, "b")]
        );
    }

    #[test]
    fn large_file_chunk_ranges_must_align_to_utf8_boundaries() {
        let text = "a中b";

        assert!(validate_byte_range(text, 1, 4).is_ok());
        assert!(validate_byte_range(text, 2, 4).is_err());
        assert!(validate_byte_range(text, 0, text.len() + 1).is_err());
    }

    #[test]
    fn large_file_line_windows_validate_bounds() {
        let text = "one\ntwo";
        let store = LargeFileRegistration {
            path: "large.md".to_string(),
            text: text.to_string(),
            line_starts: build_line_starts(text),
            line_utf16_starts: build_line_utf16_starts(text),
            version: 0,
        };

        assert!(read_large_line_window(&store, 0, 1).is_err());
        assert!(read_large_line_window(&store, 2, 1).is_err());
        assert!(read_large_line_window(&store, 1, 3).is_err());
    }

    #[test]
    fn large_file_applies_non_overlapping_utf16_changes_safely() {
        let text = "a😀中\nlast";
        let changed = apply_large_text_changes(
            text,
            &[
                LargeFileTextChange {
                    from_utf16: 1,
                    to_utf16: 3,
                    insert: "emoji".to_string(),
                },
                LargeFileTextChange {
                    from_utf16: 4,
                    to_utf16: 4,
                    insert: "!".to_string(),
                },
            ],
        )
        .expect("apply utf16 changes");

        assert_eq!(changed, "aemoji中!\nlast");
        assert!(apply_large_text_changes(
            text,
            &[LargeFileTextChange {
                from_utf16: 2,
                to_utf16: 3,
                insert: "bad".to_string(),
            }]
        )
        .is_err());
        assert!(apply_large_text_changes(
            text,
            &[
                LargeFileTextChange {
                    from_utf16: 0,
                    to_utf16: 4,
                    insert: "first".to_string(),
                },
                LargeFileTextChange {
                    from_utf16: 3,
                    to_utf16: 5,
                    insert: "overlap".to_string(),
                },
            ]
        )
        .is_err());
    }

    #[test]
    fn large_file_flush_writes_atomically_to_disk() {
        let dir = create_test_dir("large-flush");
        let path = dir.join("large.md");

        fs::write(&path, "old").expect("write original file");
        write_large_file_atomically(&path, "new\ntext").expect("atomic write");

        assert_eq!(
            fs::read_to_string(&path).expect("read flushed file"),
            "new\ntext"
        );
        remove_test_dir(dir);
    }

    fn create_test_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "milkup-desktop-{name}-{}-{nonce}",
            std::process::id()
        ));

        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn remove_test_dir(path: PathBuf) {
        fs::remove_dir_all(path).expect("remove test directory");
    }
}

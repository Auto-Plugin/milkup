use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(test)]
use std::io::{Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Window};

mod piece_tree;
use piece_tree::PieceTree;

const FILE_WATCH_EVENT_NAME: &str = "milkup-file-watch-event";
const PLUGIN_SIDECAR_EVENT_NAME: &str = "milkup-plugin-sidecar-message";
const LARGE_FILE_WORKING_TEMP_MARKER: &str = "milkup-large";
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
    size_bytes: usize,
    piece_tree: PieceTree,
    disk_snapshot_hash: String,
    version: usize,
    saved_version: usize,
}

impl Drop for LargeFileRegistry {
    fn drop(&mut self) {
        if let Ok(stores) = self.0.get_mut() {
            stores.clear();
        }
    }
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
struct TextFileMetadataResult {
    path: String,
    size_bytes: u64,
    readonly: bool,
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
fn stat_text_file(path: String) -> Result<TextFileMetadataResult, String> {
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;

    Ok(TextFileMetadataResult {
        path,
        size_bytes: metadata.len(),
        readonly: metadata.permissions().readonly(),
    })
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginDirectoryPaths {
    package_root: String,
    data_root: String,
    storage_root: String,
}

#[tauri::command]
fn ensure_plugin_directories(
    app: AppHandle,
    plugin_id: String,
) -> Result<PluginDirectoryPaths, String> {
    validate_plugin_id(&plugin_id)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("plugins")
        .join(&plugin_id);
    let package_root = base.join("package");
    let data_root = base.join("data");
    let storage_root = base.join("storage");
    fs::create_dir_all(&package_root).map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_root).map_err(|error| error.to_string())?;
    fs::create_dir_all(&storage_root).map_err(|error| error.to_string())?;

    Ok(PluginDirectoryPaths {
        package_root: path_to_string(package_root),
        data_root: path_to_string(data_root),
        storage_root: path_to_string(storage_root),
    })
}

#[tauri::command]
fn install_plugin_package_file(
    app: AppHandle,
    plugin_id: String,
    relative_path: String,
    data: Vec<u8>,
    executable: bool,
) -> Result<String, String> {
    let roots = ensure_plugin_directories(app, plugin_id)?;
    let relative = validate_plugin_relative_path(&relative_path)?;
    let target = PathBuf::from(roots.package_root).join(relative);

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&target, data).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    if executable {
        fs::set_permissions(&target, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    let _ = executable;
    Ok(path_to_string(target))
}

#[tauri::command]
fn remove_installed_plugin_package(app: AppHandle, plugin_id: String) -> Result<bool, String> {
    validate_plugin_id(&plugin_id)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("plugins")
        .join(plugin_id);

    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
fn open_large_text_file(
    registry: State<LargeFileRegistry>,
    document_id: String,
    path: String,
) -> Result<LargeFileOpenResult, String> {
    open_large_text_file_in_registry(&registry.0, document_id, path)
}

fn open_large_text_file_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    path: String,
) -> Result<LargeFileOpenResult, String> {
    cleanup_large_file_working_temps_for_path(Path::new(&path))?;
    let add_path = large_file_add_buffer_path(Path::new(&path), &document_id)?;
    let piece_tree = PieceTree::open(Path::new(&path), add_path)?;
    let size_bytes = piece_tree.byte_len();
    let disk_snapshot_hash = hash_file_contents(Path::new(&path))?;
    let line_count = piece_tree.line_count();

    {
        let mut stores = registry.lock().map_err(|error| error.to_string())?;
        stores.insert(
            document_id.clone(),
            LargeFileRegistration {
                path: path.clone(),
                size_bytes,
                piece_tree,
                disk_snapshot_hash,
                version: 0,
                saved_version: 0,
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
    let mut stores = registry.0.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    validate_large_file_byte_range(store, from_byte, to_byte)?;
    let text = read_large_text_byte_range(store, from_byte, to_byte)?;

    Ok(LargeFileChunkResult {
        document_id,
        from_byte,
        to_byte,
        from_utf16: byte_to_utf16_offset_in_file(store, from_byte)?,
        to_utf16: byte_to_utf16_offset_in_file(store, to_byte)?,
        text,
    })
}

#[tauri::command]
fn read_large_text_file_line_window(
    registry: State<LargeFileRegistry>,
    document_id: String,
    from_line: usize,
    to_line: usize,
) -> Result<LargeFileLineWindowResult, String> {
    read_large_text_file_line_window_from_registry(&registry.0, document_id, from_line, to_line)
}

fn read_large_text_file_line_window_from_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    from_line: usize,
    to_line: usize,
) -> Result<LargeFileLineWindowResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;
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
        text: read_large_text_byte_range(store, from_byte, to_byte)?,
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
    apply_large_text_file_changes_in_registry(&registry.0, document_id, expected_version, changes)
}

fn apply_large_text_file_changes_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    expected_version: usize,
    changes: Vec<LargeFileTextChange>,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
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
        let batch = changes
            .into_iter()
            .map(|change| (change.from_utf16, change.to_utf16, change.insert))
            .collect::<Vec<_>>();
        store.piece_tree.apply_batch(&batch)?;
        store.size_bytes = store.piece_tree.byte_len();
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
    flush_large_text_file_in_registry(&registry.0, document_id, expected_version)
}

fn flush_large_text_file_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    expected_version: usize,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    if store.version != expected_version {
        return Err(format!(
            "Large text file version mismatch: expected {expected_version}, current {}",
            store.version
        ));
    }

    if store.version != store.saved_version {
        let current_disk_hash = hash_file_contents(Path::new(&store.path))?;

        if current_disk_hash != store.disk_snapshot_hash {
            return Err(
                "Large text file changed outside the editor; refusing to overwrite".to_string(),
            );
        }

        let temp_path =
            large_file_save_as_temp_path(Path::new(&store.path), &document_id, store.version)?;
        store.piece_tree.write_to(&temp_path)?;
        store.piece_tree.release_base_handle();
        if let Err(error) = replace_file_with_temp(&temp_path, Path::new(&store.path)) {
            let _ = store.piece_tree.restore_base_handle();
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
        store.piece_tree.rebase(Path::new(&store.path))?;
        store.size_bytes = store.piece_tree.byte_len();
        store.disk_snapshot_hash = hash_file_contents(Path::new(&store.path))?;
        store.saved_version = store.version;
    }

    Ok(large_file_snapshot(&document_id, store))
}

#[tauri::command]
fn flush_large_text_file_as(
    registry: State<LargeFileRegistry>,
    document_id: String,
    expected_version: usize,
    path: String,
) -> Result<LargeFileSnapshotResult, String> {
    flush_large_text_file_as_in_registry(&registry.0, document_id, expected_version, path)
}

fn flush_large_text_file_as_in_registry(
    registry: &Mutex<HashMap<String, LargeFileRegistration>>,
    document_id: String,
    expected_version: usize,
    path: String,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = registry.lock().map_err(|error| error.to_string())?;
    let store = stores
        .get_mut(&document_id)
        .ok_or_else(|| format!("Unknown large text file: {document_id}"))?;

    if store.version != expected_version {
        return Err(format!(
            "Large text file version mismatch: expected {expected_version}, current {}",
            store.version
        ));
    }

    let target_path = PathBuf::from(&path);
    let normalized_target_path = path_to_string(target_path.clone());
    let normalized_store_path = path_to_string(PathBuf::from(&store.path));

    if normalized_target_path == normalized_store_path {
        if store.version != store.saved_version {
            let current_disk_hash = hash_file_contents(Path::new(&store.path))?;

            if current_disk_hash != store.disk_snapshot_hash {
                return Err(
                    "Large text file changed outside the editor; refusing to overwrite".to_string(),
                );
            }

            let temp_path =
                large_file_save_as_temp_path(Path::new(&store.path), &document_id, store.version)?;
            store.piece_tree.write_to(&temp_path)?;
            store.piece_tree.release_base_handle();
            if let Err(error) = replace_file_with_temp(&temp_path, Path::new(&store.path)) {
                let _ = store.piece_tree.restore_base_handle();
                let _ = fs::remove_file(&temp_path);
                return Err(error);
            }
            store.piece_tree.rebase(Path::new(&store.path))?;
            store.size_bytes = store.piece_tree.byte_len();
            store.disk_snapshot_hash = hash_file_contents(Path::new(&store.path))?;
            store.saved_version = store.version;
        }

        return Ok(large_file_snapshot(&document_id, store));
    }

    let temp_path = large_file_save_as_temp_path(&target_path, &document_id, store.version)?;

    store.piece_tree.write_to(&temp_path)?;
    if let Err(error) = replace_file_with_temp(&temp_path, &target_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    store.path = normalized_target_path;
    store.piece_tree.rebase(&target_path)?;
    store.size_bytes = store.piece_tree.byte_len();
    store.disk_snapshot_hash = hash_file_contents(&target_path)?;
    store.saved_version = store.version;

    Ok(large_file_snapshot(&document_id, store))
}

#[tauri::command]
fn close_large_text_file(
    registry: State<LargeFileRegistry>,
    document_id: String,
) -> Result<bool, String> {
    let mut stores = registry.0.lock().map_err(|error| error.to_string())?;

    let Some(store) = stores.get_mut(&document_id) else {
        return Ok(true);
    };
    store.piece_tree.close()?;
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
        .setup(|_app| {
            let _ = cleanup_large_file_working_temps_in_dir(&std::env::temp_dir());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge_status,
            window_control,
            initial_open_file_path,
            stat_text_file,
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
            ensure_plugin_directories,
            install_plugin_package_file,
            remove_installed_plugin_package,
            open_large_text_file,
            read_large_text_file_chunk,
            read_large_text_file_line_window,
            apply_large_text_file_changes,
            flush_large_text_file,
            flush_large_text_file_as,
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

fn hash_file_contents(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;

        if read == 0 {
            break;
        }

        buffer[..read].hash(&mut hasher);
    }

    Ok(format!("{:016x}", hasher.finish()))
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

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty()
        || plugin_id.len() > 128
        || !plugin_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("Plugin id contains invalid path characters".to_string());
    }
    Ok(())
}

fn validate_plugin_relative_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);

    if candidate.as_os_str().is_empty() || candidate.is_absolute() {
        return Err("Plugin package path must be relative".to_string());
    }

    if candidate
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Plugin package path must stay inside the package root".to_string());
    }

    Ok(candidate.to_path_buf())
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

#[cfg(test)]
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

fn validate_large_file_byte_range(
    store: &LargeFileRegistration,
    from_byte: usize,
    to_byte: usize,
) -> Result<(), String> {
    if from_byte > to_byte || to_byte > store.size_bytes {
        return Err(format!(
            "Invalid byte range: {from_byte}-{to_byte} for {} bytes",
            store.size_bytes
        ));
    }

    Ok(())
}

#[cfg(test)]
fn read_text_byte_range(path: &Path, from_byte: usize, to_byte: usize) -> Result<String, String> {
    if to_byte < from_byte {
        return Err(format!("Invalid byte range: {from_byte}-{to_byte}"));
    }

    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(from_byte as u64))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0; to_byte - from_byte];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn read_large_text_byte_range(
    store: &mut LargeFileRegistration,
    from_byte: usize,
    to_byte: usize,
) -> Result<String, String> {
    validate_large_file_byte_range(store, from_byte, to_byte)?;
    store.piece_tree.read_range(from_byte, to_byte)
}

#[cfg(test)]
fn byte_to_utf16_offset(text: &str, byte_offset: usize) -> Result<usize, String> {
    validate_byte_range(text, byte_offset, byte_offset)?;

    Ok(text[..byte_offset].encode_utf16().count())
}

fn byte_to_utf16_offset_in_file(
    store: &mut LargeFileRegistration,
    byte_offset: usize,
) -> Result<usize, String> {
    validate_large_file_byte_range(store, byte_offset, byte_offset)?;

    store.piece_tree.byte_to_utf16(byte_offset)
}

#[cfg(test)]
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

#[cfg(test)]
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

fn large_file_save_as_temp_path(
    path: &Path,
    document_id: &str,
    version: usize,
) -> Result<PathBuf, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    let safe_document_id = document_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    Ok(parent.join(format!(
        ".{file_name}.{LARGE_FILE_WORKING_TEMP_MARKER}.{}.{}.v{version}.{nonce}.save-as.tmp",
        std::process::id(),
        safe_document_id
    )))
}

fn large_file_add_buffer_path(path: &Path, document_id: &str) -> Result<PathBuf, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    let safe_document_id = document_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    Ok(parent.join(format!(
        ".{file_name}.{LARGE_FILE_WORKING_TEMP_MARKER}.{}.{}.add.work",
        std::process::id(),
        safe_document_id
    )))
}

fn cleanup_large_file_working_temps_for_path(path: &Path) -> Result<usize, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;

    cleanup_large_file_working_temps_by_prefix(parent, &format!(".{file_name}."))
}

fn cleanup_large_file_working_temps_in_dir(dir: &Path) -> Result<usize, String> {
    cleanup_large_file_working_temps_by_prefix(dir, ".")
}

fn cleanup_large_file_working_temps_by_prefix(dir: &Path, prefix: &str) -> Result<usize, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };
    let mut removed = 0;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if is_large_file_working_temp_name(name, prefix) {
            match fs::remove_file(&path) {
                Ok(()) => removed += 1,
                Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    Ok(removed)
}

fn is_large_file_working_temp_name(name: &str, prefix: &str) -> bool {
    if !name.starts_with(prefix) {
        return false;
    }

    if name.ends_with(".save-as.tmp") {
        return name.contains(&format!(".{LARGE_FILE_WORKING_TEMP_MARKER}."));
    }

    if !name.ends_with(".work") {
        return false;
    }

    let rest = &name[prefix.len()..name.len() - ".work".len()];

    rest.contains(&format!(".{LARGE_FILE_WORKING_TEMP_MARKER}."))
        || looks_like_legacy_large_file_working_temp(rest)
}

fn looks_like_legacy_large_file_working_temp(rest: &str) -> bool {
    let mut parts = rest.split('.');
    let Some(pid) = parts.next() else {
        return false;
    };
    let Some(_document_id) = parts.next() else {
        return false;
    };
    let Some(version) = parts.next() else {
        return false;
    };

    if parts.next().is_some() {
        return false;
    }

    pid.chars().all(|character| character.is_ascii_digit())
        && version.starts_with('v')
        && version[1..]
            .chars()
            .all(|character| character.is_ascii_digit())
}

fn large_file_snapshot(
    document_id: &str,
    store: &LargeFileRegistration,
) -> LargeFileSnapshotResult {
    LargeFileSnapshotResult {
        document_id: document_id.to_string(),
        path: store.path.clone(),
        version: store.version,
        size_bytes: store.size_bytes,
        line_count: store.piece_tree.line_count(),
    }
}

#[cfg(test)]
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

fn replace_file_with_temp(temp_path: &Path, path: &Path) -> Result<(), String> {
    if let Err(error) = replace_file_atomically(temp_path, path) {
        let _ = fs::remove_file(temp_path);
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
    store: &mut LargeFileRegistration,
    from_line: usize,
    to_line: usize,
) -> Result<(usize, usize, Vec<LargeFileLine>), String> {
    let line_count = store.piece_tree.line_count();
    if from_line == 0 || to_line < from_line || to_line > line_count {
        return Err(format!(
            "Invalid line window: {from_line}-{to_line} for {} lines",
            line_count
        ));
    }

    let from_byte = store.piece_tree.line_start_byte(from_line)?;
    let to_byte = line_content_end_byte(store, to_line)?;
    let mut lines = Vec::with_capacity(to_line - from_line + 1);

    for number in from_line..=to_line {
        let line_from = store.piece_tree.line_start_byte(number)?;
        let line_to = line_content_end_byte(store, number)?;

        lines.push(LargeFileLine {
            number,
            from_byte: line_from,
            to_byte: line_to,
            from_utf16: byte_to_utf16_offset_in_line(store, number, line_from)?,
            to_utf16: byte_to_utf16_offset_in_line(store, number, line_to)?,
            text: read_large_text_byte_range(store, line_from, line_to)?,
        });
    }

    Ok((from_byte, to_byte, lines))
}

fn line_content_end_byte(
    store: &mut LargeFileRegistration,
    line_number: usize,
) -> Result<usize, String> {
    store.piece_tree.line_content_end_byte(line_number)
}

fn byte_to_utf16_offset_in_line(
    store: &mut LargeFileRegistration,
    line_number: usize,
    byte_offset: usize,
) -> Result<usize, String> {
    let line_start = store.piece_tree.line_start_byte(line_number)?;

    if byte_offset < line_start || byte_offset > store.size_bytes {
        return Err(format!(
            "Invalid line byte offset: {byte_offset} for line {line_number}"
        ));
    }

    store.piece_tree.byte_to_utf16(byte_offset)
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
    fn stat_text_file_reports_size_and_readonly_flag() {
        let dir = create_test_dir("stat");
        let path = dir.join("note.md");

        fs::write(&path, "hello").expect("write fixture");

        let result = stat_text_file(path_to_string(path.clone())).expect("stat text file");

        assert_eq!(result.path, path_to_string(path.clone()));
        assert_eq!(result.size_bytes, 5);
        assert!(!result.readonly);

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
    fn plugin_package_paths_cannot_escape_the_plugin_root() {
        assert!(validate_plugin_id("example.tools-1").is_ok());
        assert!(validate_plugin_id("../outside").is_err());
        assert_eq!(
            validate_plugin_relative_path("dist/plugin.js").expect("valid package path"),
            PathBuf::from("dist/plugin.js")
        );
        assert!(validate_plugin_relative_path("../outside.exe").is_err());
        assert!(validate_plugin_relative_path("/absolute/plugin.js").is_err());
    }

    #[test]
    fn large_file_line_index_handles_lf_crlf_and_trailing_newline() {
        let dir = create_test_dir("large-line-index");
        let mut store = create_large_file_store(&dir, "large.md", "alpha\r\nbeta\n");

        assert_eq!(store.piece_tree.line_count(), 3);

        let (from_byte, to_byte, lines) =
            read_large_line_window(&mut store, 1, 3).expect("read line window");

        assert_eq!(from_byte, 0);
        assert_eq!(to_byte, 12);
        assert_eq!(
            read_text_byte_range(Path::new(&store.path), from_byte, to_byte)
                .expect("read full window"),
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
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_maps_utf8_bytes_to_utf16_offsets() {
        let dir = create_test_dir("large-utf16");
        let text = "a😀中\r\nb";
        let mut store = create_large_file_store(&dir, "large.md", text);

        assert_eq!(byte_to_utf16_offset(text, 0).expect("start offset"), 0);
        assert_eq!(byte_to_utf16_offset(text, 1).expect("ascii offset"), 1);
        assert_eq!(byte_to_utf16_offset(text, 5).expect("emoji offset"), 3);
        assert_eq!(byte_to_utf16_offset(text, 8).expect("cjk offset"), 4);
        assert!(byte_to_utf16_offset(text, 2).is_err());

        let (_from_byte, _to_byte, lines) =
            read_large_line_window(&mut store, 1, 2).expect("read unicode line window");

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
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_line_window_accepts_utf8_character_before_lf() {
        let dir = create_test_dir("large-utf8-before-lf");
        let mut store = create_large_file_store(&dir, "large.md", "# 标题\n正文😀\n");

        let (_from_byte, _to_byte, lines) =
            read_large_line_window(&mut store, 1, 3).expect("read unicode LF line window");

        assert_eq!(
            lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec!["# 标题", "正文😀", ""]
        );
        remove_test_dir(dir);
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
        let dir = create_test_dir("large-window-bounds");
        let text = "one\ntwo";
        let mut store = create_large_file_store(&dir, "large.md", text);

        assert!(read_large_line_window(&mut store, 0, 1).is_err());
        assert!(read_large_line_window(&mut store, 2, 1).is_err());
        assert!(read_large_line_window(&mut store, 1, 3).is_err());
        remove_test_dir(dir);
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

    #[test]
    fn large_file_open_and_window_reads_do_not_materialize_full_text() {
        let dir = create_test_dir("large-open-lazy");
        let path = dir.join("large.md");
        fs::write(&path, "one\ntwo\nthree").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        let opened = open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        assert_eq!(opened.size_bytes, "one\ntwo\nthree".len());
        assert_eq!(opened.line_count, 3);
        assert_eq!(
            registry
                .0
                .lock()
                .expect("lock registry")
                .get("large-doc")
                .expect("large registration")
                .piece_tree
                .byte_len(),
            opened.size_bytes
        );

        let window = read_large_text_file_line_window_from_registry(
            &registry.0,
            "large-doc".to_string(),
            2,
            3,
        )
        .expect("read line window");

        assert_eq!(window.text, "two\nthree");
        assert_eq!(
            registry
                .0
                .lock()
                .expect("lock registry")
                .get("large-doc")
                .expect("large registration")
                .piece_tree
                .byte_len(),
            opened.size_bytes
        );
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_flush_rejects_external_modification_after_visible_edit() {
        let dir = create_test_dir("large-flush-conflict");
        let path = dir.join("large.md");
        fs::write(&path, "hello world").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");
        fs::write(&path, "external change").expect("external edit");

        let error = match flush_large_text_file_in_registry(&registry.0, "large-doc".to_string(), 1)
        {
            Ok(_) => panic!("expected flush conflict"),
            Err(error) => error,
        };

        assert!(error.contains("changed outside the editor"));
        assert_eq!(
            fs::read_to_string(&path).expect("read conflicted file"),
            "external change"
        );
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_visible_edit_uses_memory_snapshot_without_working_file() {
        let dir = create_test_dir("large-edit-working");
        let path = dir.join("large.md");
        fs::write(&path, "hello world\nsecond").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        let snapshot = apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");

        assert_eq!(snapshot.version, 1);
        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello milkup\nsecond".len());
            assert_eq!(
                fs::read_to_string(&path).expect("read original"),
                "hello world\nsecond"
            );
        }

        let window = read_large_text_file_line_window_from_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            1,
        )
        .expect("read edited window");

        assert_eq!(window.text, "hello milkup");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_flush_commits_memory_snapshot_and_clears_edit_log() {
        let dir = create_test_dir("large-flush-memory");
        let path = dir.join("large.md");
        fs::write(&path, "hello world\nsecond").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");
        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 12,
                to_utf16: 18,
                insert: "tail".to_string(),
            }],
        )
        .expect("apply visible edit");

        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello world\ntail".len());
        }

        flush_large_text_file_in_registry(&registry.0, "large-doc".to_string(), 1)
            .expect("flush memory snapshot");

        assert_eq!(
            fs::read_to_string(&path).expect("read flushed file"),
            "hello world\ntail"
        );
        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello world\ntail".len());
        }
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_save_as_writes_memory_snapshot_without_overwriting_original() {
        let dir = create_test_dir("large-save-as-memory");
        let path = dir.join("large.md");
        let save_as_path = dir.join("large-copy.md");
        fs::write(&path, "hello world\nsecond").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");
        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");

        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.piece_tree.byte_len(), "hello milkup\nsecond".len());
        }

        let snapshot = flush_large_text_file_as_in_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            path_to_string(save_as_path.clone()),
        )
        .expect("save large file as");

        assert_eq!(snapshot.path, path_to_string(save_as_path.clone()));
        assert_eq!(
            fs::read_to_string(&path).expect("read original file"),
            "hello world\nsecond"
        );
        assert_eq!(
            fs::read_to_string(&save_as_path).expect("read save-as file"),
            "hello milkup\nsecond"
        );
        {
            let stores = registry.0.lock().expect("lock registry");
            let store = stores.get("large-doc").expect("large registration");
            assert_eq!(store.path, path_to_string(save_as_path.clone()));
            assert_eq!(store.piece_tree.byte_len(), "hello milkup\nsecond".len());
        }

        let window = read_large_text_file_line_window_from_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            1,
        )
        .expect("read saved-as window");

        assert_eq!(window.text, "hello milkup");
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_save_as_to_same_path_preserves_external_conflict_guard() {
        let dir = create_test_dir("large-save-as-conflict");
        let path = dir.join("large.md");
        fs::write(&path, "hello world").expect("write large fixture");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");
        apply_large_text_file_changes_in_registry(
            &registry.0,
            "large-doc".to_string(),
            0,
            vec![LargeFileTextChange {
                from_utf16: 6,
                to_utf16: 11,
                insert: "milkup".to_string(),
            }],
        )
        .expect("apply visible edit");
        fs::write(&path, "external change").expect("external edit");

        let error = match flush_large_text_file_as_in_registry(
            &registry.0,
            "large-doc".to_string(),
            1,
            path_to_string(path.clone()),
        ) {
            Ok(_) => panic!("expected save-as conflict"),
            Err(error) => error,
        };

        assert!(error.contains("changed outside the editor"));
        assert_eq!(
            fs::read_to_string(&path).expect("read conflicted file"),
            "external change"
        );
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_open_cleans_stale_working_temps_for_same_path_only() {
        let dir = create_test_dir("large-clean-open");
        let path = dir.join("large.md");
        let other_path = dir.join("other.md");
        fs::write(&path, "hello").expect("write large fixture");
        fs::write(&other_path, "other").expect("write other fixture");
        let stale = dir.join(".large.md.milkup-large.999.doc.v1.work");
        let legacy_stale = dir.join(".large.md.999.doc.v2.work");
        let unrelated = dir.join(".other.md.milkup-large.999.doc.v1.work");
        fs::write(&stale, "stale").expect("write stale temp");
        fs::write(&legacy_stale, "legacy").expect("write legacy temp");
        fs::write(&unrelated, "other").expect("write unrelated temp");
        let registry = LargeFileRegistry(Mutex::new(HashMap::new()));

        open_large_text_file_in_registry(
            &registry.0,
            "large-doc".to_string(),
            path_to_string(path.clone()),
        )
        .expect("open large file");

        assert!(!stale.exists());
        assert!(!legacy_stale.exists());
        assert!(unrelated.exists());
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_temp_cleanup_only_removes_marked_work_files() {
        let dir = create_test_dir("large-clean-dir");
        let stale = dir.join(".note.md.milkup-large.999.doc.v1.work");
        let stale_save = dir.join(".note.md.milkup-large.999.doc.v1.123.save-as.tmp");
        let keep_regular_work = dir.join("draft.work");
        let keep_tmp = dir.join(".note.md.999.tmp");
        fs::write(&stale, "stale").expect("write stale temp");
        fs::write(&stale_save, "stale save").expect("write stale save temp");
        fs::write(&keep_regular_work, "work").expect("write regular work");
        fs::write(&keep_tmp, "tmp").expect("write tmp");

        let removed = cleanup_large_file_working_temps_in_dir(&dir).expect("cleanup dir");

        assert_eq!(removed, 2);
        assert!(!stale.exists());
        assert!(!stale_save.exists());
        assert!(keep_regular_work.exists());
        assert!(keep_tmp.exists());
        remove_test_dir(dir);
    }

    #[test]
    fn large_file_registry_drop_removes_active_working_temps() {
        let dir = create_test_dir("large-registry-drop");
        let store = create_large_file_store(&dir, "note.md", "hello");
        let working = store.piece_tree.add_path.clone();

        {
            let registry = LargeFileRegistry(Mutex::new(HashMap::from([(
                "large-doc".to_string(),
                store,
            )])));
            drop(registry);
        }

        assert!(!working.exists());
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

    fn create_large_file_store(dir: &Path, name: &str, text: &str) -> LargeFileRegistration {
        let path = dir.join(name);
        fs::write(&path, text).expect("write large fixture");
        let add_path = large_file_add_buffer_path(&path, "test-document").expect("add buffer path");
        let piece_tree = PieceTree::open(&path, add_path).expect("open piece tree");

        LargeFileRegistration {
            path: path_to_string(path.clone()),
            size_bytes: piece_tree.byte_len(),
            piece_tree,
            disk_snapshot_hash: hash_file_contents(&path).expect("hash large fixture"),
            version: 0,
            saved_version: 0,
        }
    }

    fn remove_test_dir(path: PathBuf) {
        fs::remove_dir_all(path).expect("remove test directory");
    }
}

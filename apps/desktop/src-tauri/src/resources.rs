//! Host-owned local image transactions. Paths never authorize resource IPC.
//! Documents are registered only by successful native document I/O; save targets
//! come from the native picker. Published/accepted files outlive plugin lifetimes.
use image::{ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
#[cfg(not(unix))]
use std::fs::OpenOptions;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

type Result<T> = std::result::Result<T, String>;
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 64 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_IMAGES: usize = 16;
const MAX_TRANSACTIONS: usize = 32;
const MAX_DOCUMENTS: usize = 64;
fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}
fn token(kind: &str) -> Result<String> {
    crate::workspace::id(kind)
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ResourcePolicy {
    Assets,
    DocumentAssets,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageMetadata {
    pub mime_type: &'static str,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedAsset {
    pub id: String,
    pub relative_path: String,
    pub original_name: String,
    #[serde(flatten)]
    pub image: ImageMetadata,
}
#[derive(Debug, Serialize)]
pub(crate) struct PreparedResources {
    pub id: String,
    pub assets: Vec<PreparedAsset>,
}
#[derive(Debug, Serialize)]
pub(crate) struct SaveTarget {
    pub id: String,
    pub path: String,
}
#[derive(Debug, Serialize)]
pub(crate) struct Relocation {
    pub id: String,
    pub replacements: HashMap<String, String>,
}
#[derive(Debug, Serialize)]
pub(crate) struct ResolvedImage {
    pub data: Vec<u8>,
    #[serde(flatten)]
    pub image: ImageMetadata,
}
#[derive(Deserialize)]
pub(crate) struct ClipboardImage {
    pub name: String,
    pub data: Vec<u8>,
}

struct Directory {
    path: PathBuf,
    file: File,
    _guards: Vec<File>,
}
struct Document {
    path: PathBuf,
    parent: Arc<Directory>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceSource {
    pub id: String,
    pub name: String,
    pub mime_type: &'static str,
    pub size_bytes: usize,
}
struct Source {
    document: Arc<Document>,
    document_id: String,
    image: ClipboardImage,
    created: Instant,
}
struct Destination {
    document: Arc<Document>,
    created: Instant,
}
struct StagedFile {
    public: PreparedAsset,
    directory: Arc<Directory>,
    name: String,
    identity: (u64, u64),
    hash: Vec<u8>,
    owned: bool,
    accepted: bool,
}
struct Transaction {
    document_id: String,
    destination: Arc<Document>,
    files: Vec<StagedFile>,
    relocation: bool,
}
#[derive(Default)]
struct Registry {
    documents: HashMap<String, Arc<Document>>,
    targets: HashMap<String, Destination>,
    transactions: HashMap<String, Transaction>,
    sources: HashMap<String, Source>,
}
fn registry() -> &'static Mutex<Registry> {
    static STORE: OnceLock<Mutex<Registry>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Registry::default()))
}

impl Directory {
    fn open(path: &Path) -> Result<Arc<Self>> {
        let (file, guards) = crate::workspace::open_absolute_directory(path)?;
        Ok(Arc::new(Self {
            path: path.to_owned(),
            file,
            _guards: guards,
        }))
    }
    fn verify(&self) -> Result<()> {
        let (now, _) = crate::workspace::open_absolute_directory(&self.path)?;
        if identity(&now)? != identity(&self.file)? {
            return Err("Resource directory changed".into());
        }
        Ok(())
    }
    fn child(&self, name: &str, directory: bool) -> Result<File> {
        valid_component(name)?;
        self.verify()?;
        crate::workspace::open_child(&self.file, &self.path, name.as_ref(), directory)
            .map_err(error)
    }
    fn directory(&self, name: &str, create: bool) -> Result<Arc<Directory>> {
        valid_component(name)?;
        self.verify()?;
        if create {
            #[cfg(unix)]
            {
                use std::os::fd::AsRawFd;
                let name = std::ffi::CString::new(name).map_err(error)?;
                if unsafe { libc::mkdirat(self.file.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
                    let failure = std::io::Error::last_os_error();
                    if failure.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(error(failure));
                    }
                }
            }
            #[cfg(not(unix))]
            match fs::create_dir(self.path.join(name)) {
                Ok(()) => (),
                Err(failure) if failure.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(failure) => return Err(error(failure)),
            }
        }
        let file = self.child(name, true)?;
        if !file.metadata().map_err(error)?.is_dir() {
            return Err("Resource container is not a directory".into());
        }
        let mut guards = self
            ._guards
            .iter()
            .map(File::try_clone)
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(error)?;
        guards.push(self.file.try_clone().map_err(error)?);
        Ok(Arc::new(Directory {
            path: self.path.join(name),
            file,
            _guards: guards,
        }))
    }
    fn create_exclusive(&self, name: &str) -> Result<File> {
        valid_component(name)?;
        self.verify()?;
        #[cfg(unix)]
        {
            use std::os::fd::{AsRawFd, FromRawFd};
            let name = std::ffi::CString::new(name).map_err(error)?;
            let fd = unsafe {
                libc::openat(
                    self.file.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if fd < 0 {
                return Err(error(std::io::Error::last_os_error()));
            }
            Ok(unsafe { File::from_raw_fd(fd) })
        }
        #[cfg(not(unix))]
        {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.path.join(name))
                .map_err(error)
        }
    }
    fn unlink(&self, name: &str) -> Result<()> {
        self.verify()?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let name = std::ffi::CString::new(name).map_err(error)?;
            if unsafe { libc::unlinkat(self.file.as_raw_fd(), name.as_ptr(), 0) } != 0 {
                return Err(error(std::io::Error::last_os_error()));
            }
            self.file.sync_all().map_err(error)
        }
        #[cfg(not(unix))]
        {
            fs::remove_file(self.path.join(name)).map_err(error)
        }
    }
}
#[cfg(unix)]
fn identity(file: &File) -> Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().map_err(error)?;
    Ok((metadata.dev(), metadata.ino()))
}
#[cfg(windows)]
fn identity(file: &File) -> Result<(u64, u64)> {
    crate::workspace::windows_identity(file)
}
#[cfg(not(any(unix, windows)))]
fn identity(_: &File) -> Result<(u64, u64)> {
    Err("Resource handles unsupported".into())
}
fn valid_component(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 255
        || value == "."
        || value == ".."
        || value.contains(['/', '\\', ':'])
        || value.chars().any(|c| c.is_control())
        || value.ends_with(['.', ' '])
    {
        return Err("Invalid resource path component".into());
    }
    Ok(())
}
fn document(path: &Path, existing: bool) -> Result<Arc<Document>> {
    let path = if existing {
        path.canonicalize().map_err(error)?
    } else {
        if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err("Save targets must not be symlinks".into());
        }
        let name = path.file_name().ok_or("Invalid document name")?;
        path.parent()
            .ok_or("Missing document directory")?
            .canonicalize()
            .map_err(error)?
            .join(name)
    };
    if !path.is_absolute() {
        return Err("Document target is not absolute".into());
    }
    let parent = Directory::open(path.parent().ok_or("Missing document directory")?)?;
    Ok(Arc::new(Document { path, parent }))
}
/// Internal native document-I/O hook. There is intentionally no path-taking IPC registration.
pub(crate) fn register_document(document_id: &str, path: &Path) {
    let value = document(path, true);
    if let Ok(mut store) = registry().lock() {
        store.documents.remove(document_id);
        if store.documents.len() < MAX_DOCUMENTS {
            if let Ok(value) = value {
                store.documents.insert(document_id.into(), value);
            }
        }
    }
}
/// A native Markdown rename is irreversible even if later indexing or the IPC
/// acknowledgement fails. Mark only this document's authorized destination;
/// subsequent aborts must never delete files the written Markdown can reference.
pub(crate) fn document_write_committed(document_id: &str, path: &Path) {
    let mut store = registry()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for transaction in store.transactions.values_mut() {
        if transaction.relocation
            && transaction.document_id == document_id
            && transaction.destination.path == path
        {
            for file in &mut transaction.files {
                file.accepted = true;
            }
        }
    }
}
fn current_document(document_id: &str) -> Result<Arc<Document>> {
    let value = registry()
        .lock()
        .map_err(error)?
        .documents
        .get(document_id)
        .cloned()
        .ok_or("Save or open this document before importing resources")?;
    value.parent.verify()?;
    Ok(value)
}
fn policy_directory(document: &Document, policy: ResourcePolicy) -> Result<String> {
    let name = match policy {
        ResourcePolicy::Assets => "assets".into(),
        ResourcePolicy::DocumentAssets => format!(
            "{}.assets",
            document
                .path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("Invalid document name")?
        ),
    };
    valid_component(&name)?;
    Ok(name)
}
fn validate_image(bytes: &[u8]) -> Result<(ImageMetadata, &'static str)> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image exceeds the 16 MiB limit".into());
    }
    let format = image::guess_format(bytes).map_err(error)?;
    let (mime_type, extension) = match format {
        ImageFormat::Png => ("image/png", "png"),
        ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        ImageFormat::WebP => ("image/webp", "webp"),
        _ => return Err("Only local PNG, JPEG and WebP images are supported".into()),
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits.clone());
    let (width, height) = reader.into_dimensions().map_err(error)?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("Image exceeds the 40 megapixel limit".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let decoded = reader.decode().map_err(error)?;
    if decoded.width() != width || decoded.height() != height {
        return Err("Image dimensions changed while decoding".into());
    }
    Ok((
        ImageMetadata {
            mime_type,
            width,
            height,
        },
        extension,
    ))
}
fn read_bounded(mut file: File) -> Result<Vec<u8>> {
    let metadata = file.metadata().map_err(error)?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("Image is not a bounded regular file".into());
    }
    let mut data = Vec::new();
    (&mut file)
        .take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut data)
        .map_err(error)?;
    if data.len() > MAX_IMAGE_BYTES {
        return Err("Image exceeds the byte limit".into());
    }
    Ok(data)
}
fn encode_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
fn managed_parts(url: &str) -> Result<(String, String)> {
    if url.len() > 2048 || url.contains(['?', '#', '\\', ':']) {
        return Err("Unsupported image URL; only managed local resources can be relocated".into());
    }
    let bytes = url.as_bytes();
    let mut decoded = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = url
                .get(index + 1..index + 3)
                .ok_or("Invalid image URL escape")?;
            decoded.push(u8::from_str_radix(hex, 16).map_err(error)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let decoded = String::from_utf8(decoded).map_err(error)?;
    let decoded = decoded.strip_prefix("./").unwrap_or(&decoded);
    let mut parts = decoded.split('/');
    let directory = parts.next().ok_or("Missing image directory")?;
    let name = parts.next().ok_or("Missing image filename")?;
    if parts.next().is_some()
        || !(directory == "assets" || (directory.ends_with(".assets") && directory.len() > 7))
    {
        return Err(
            "Unsupported image URL; only assets or document.assets directories are managed".into(),
        );
    }
    valid_component(directory)?;
    valid_component(name)?;
    Ok((directory.into(), name.into()))
}
fn write_staged(
    directory: Arc<Directory>,
    name: String,
    data: &[u8],
    original_name: String,
    image: ImageMetadata,
    relative_path: String,
    reuse: bool,
) -> Result<StagedFile> {
    let hash = Sha256::digest(data).to_vec();
    let asset_id = token("asset")?;
    let (identity, owned) = match directory.create_exclusive(&name) {
        Ok(mut file) => {
            let id = identity(&file)?;
            let mut written = 0;
            let write_result = (|| -> std::io::Result<()> {
                while written < data.len() {
                    match file.write(&data[written..]) {
                        Ok(0) => {
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::WriteZero,
                                "Resource write stopped",
                            ))
                        }
                        Ok(count) => written += count,
                        Err(failure) if failure.kind() == std::io::ErrorKind::Interrupted => {
                            continue
                        }
                        Err(failure) => return Err(failure),
                    }
                }
                file.sync_all()?;
                directory.file.sync_all()
            })();
            if let Err(failure) = write_result {
                drop(file);
                // Cleanup uses the same identity/content guards as explicit abort,
                // including partial writes. A replacement or changed file stays put.
                let partial = StagedFile {
                    public: PreparedAsset {
                        id: asset_id,
                        relative_path,
                        original_name,
                        image,
                    },
                    directory,
                    name,
                    identity: id,
                    hash: Sha256::digest(&data[..written]).to_vec(),
                    owned: true,
                    accepted: false,
                };
                return match cleanup(&[partial]) {
                    Ok(()) => Err(error(failure)),
                    Err(cleanup) => Err(format!("{failure}; cleanup: {cleanup}")),
                };
            }
            (id, true)
        }
        Err(failure) => {
            if !reuse {
                return Err(failure);
            }
            let file = directory.child(&name, false)?;
            let id = identity(&file)?;
            if Sha256::digest(read_bounded(file)?).as_slice() != hash.as_slice() {
                return Err("Resource destination already exists with different bytes".into());
            }
            (id, false)
        }
    };
    Ok(StagedFile {
        public: PreparedAsset {
            id: asset_id,
            relative_path,
            original_name,
            image,
        },
        directory,
        name,
        identity,
        hash,
        owned,
        accepted: false,
    })
}
fn cleanup(files: &[StagedFile]) -> Result<()> {
    let mut failures = Vec::new();
    for staged in files.iter().filter(|file| file.owned && !file.accepted) {
        let result = (|| {
            let file = staged.directory.child(&staged.name, false)?;
            if identity(&file)? != staged.identity
                || Sha256::digest(read_bounded(file)?).as_slice() != staged.hash.as_slice()
            {
                return Err(
                    "Resource changed after staging; retained instead of deleting".to_string(),
                );
            }
            staged.directory.unlink(&staged.name)
        })();
        if let Err(failure) = result {
            failures.push(format!("{}: {failure}", staged.public.relative_path));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}
fn store_transaction(transaction: Transaction) -> Result<PreparedResources> {
    let mut store = registry().lock().map_err(error)?;
    if store.transactions.len() >= MAX_TRANSACTIONS {
        cleanup(&transaction.files)?;
        return Err("Resource transaction budget reached".into());
    }
    let id = token("resource-transaction")?;
    let assets = transaction
        .files
        .iter()
        .map(|file| file.public.clone())
        .collect();
    store.transactions.insert(id.clone(), transaction);
    Ok(PreparedResources { id, assets })
}
fn stage_images(
    document_id: &str,
    expected: Arc<Document>,
    policy: ResourcePolicy,
    images: Vec<ClipboardImage>,
) -> Result<PreparedResources> {
    if images.is_empty()
        || images.len() > MAX_IMAGES
        || images.iter().map(|image| image.data.len()).sum::<usize>() > MAX_BATCH_BYTES
    {
        return Err("Image batch exceeds 16 images or 64 MiB".into());
    }
    let current = current_document(document_id)?;
    if current.path != expected.path {
        return Err("Document changed while choosing images".into());
    }
    let validated = images
        .iter()
        .map(|image| validate_image(&image.data))
        .collect::<Result<Vec<_>>>()?;
    let directory_name = policy_directory(&expected, policy)?;
    let directory = expected.parent.directory(&directory_name, true)?;
    let mut files = Vec::new();
    for (input, (image, extension)) in images.into_iter().zip(validated) {
        let name = format!("{}.{}", token("image")?, extension);
        let relative = format!(
            "{}/{}",
            encode_segment(&directory_name),
            encode_segment(&name)
        );
        match write_staged(
            directory.clone(),
            name,
            &input.data,
            input.name,
            image,
            relative,
            false,
        ) {
            Ok(file) => files.push(file),
            Err(failure) => {
                return match cleanup(&files) {
                    Ok(()) => Err(failure),
                    Err(cleanup) => Err(format!("{failure}; cleanup: {cleanup}")),
                }
            }
        }
    }
    store_transaction(Transaction {
        document_id: document_id.into(),
        destination: expected,
        files,
        relocation: false,
    })
}

fn grant_source(
    document_id: String,
    expected: Arc<Document>,
    input: ClipboardImage,
) -> Result<ResourceSource> {
    let (metadata, _) = validate_image(&input.data)?;
    let current = current_document(&document_id)?;
    if current.path != expected.path {
        return Err("Document changed while acquiring image".into());
    }
    let id = token("resource-source")?;
    let public = ResourceSource {
        id: id.clone(),
        name: {
            let safe: String = input
                .name
                .chars()
                .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
                .take(120)
                .collect();
            if safe.is_empty() {
                "image".into()
            } else {
                safe
            }
        },
        mime_type: metadata.mime_type,
        size_bytes: input.data.len(),
    };
    let mut store = registry().lock().map_err(error)?;
    store
        .sources
        .retain(|_, source| source.created.elapsed() < Duration::from_secs(120));
    if store.sources.len() >= 8
        || store
            .sources
            .values()
            .map(|source| source.image.data.len())
            .sum::<usize>()
            + input.data.len()
            > MAX_BATCH_BYTES
    {
        return Err("Image source budget reached".into());
    }
    store.sources.insert(
        id,
        Source {
            document: expected,
            document_id,
            image: input,
            created: Instant::now(),
        },
    );
    Ok(public)
}
#[tauri::command]
pub(crate) async fn resources_choose_image(
    app: AppHandle,
    document_id: String,
) -> Result<Option<ResourceSource>> {
    let expected = current_document(&document_id)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Local images", &["png", "jpg", "jpeg", "webp"])
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(selected) = receive.await.map_err(error)? else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(error)?;
    let parent = Directory::open(path.parent().ok_or("Missing image directory")?)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid image name")?;
    let data = read_bounded(parent.child(name, false)?)?;
    grant_source(
        document_id,
        expected,
        ClipboardImage {
            name: name.into(),
            data,
        },
    )
    .map(Some)
}
#[tauri::command]
pub(crate) fn resources_grant_clipboard(
    document_id: String,
    name: String,
    data: Vec<u8>,
) -> Result<ResourceSource> {
    let document = current_document(&document_id)?;
    grant_source(document_id, document, ClipboardImage { name, data })
}
#[tauri::command]
pub(crate) fn resources_stage_image(
    document_id: String,
    source_id: String,
    policy: ResourcePolicy,
) -> Result<PreparedResources> {
    let source = registry()
        .lock()
        .map_err(error)?
        .sources
        .remove(&source_id)
        .ok_or("Unknown or consumed image source")?;
    if source.document_id != document_id || source.created.elapsed() >= Duration::from_secs(120) {
        return Err("Image source expired or belongs to another document".into());
    }
    stage_images(&document_id, source.document, policy, vec![source.image])
}
#[tauri::command]
pub(crate) fn resources_release_source(source_id: String) -> Result<bool> {
    registry().lock().map_err(error)?.sources.remove(&source_id);
    Ok(true)
}
#[tauri::command]
pub(crate) fn resources_validate_assets(
    transaction_id: String,
    document_id: String,
    asset_ids: Vec<String>,
) -> Result<bool> {
    let current = current_document(&document_id)?;
    let store = registry().lock().map_err(error)?;
    let transaction = store
        .transactions
        .get(&transaction_id)
        .ok_or("Unknown resource transaction")?;
    if transaction.document_id != document_id || transaction.destination.path != current.path {
        return Err("Resource document changed before insertion".into());
    }
    for id in asset_ids {
        let staged = transaction
            .files
            .iter()
            .find(|file| file.public.id == id)
            .ok_or("Unknown staged asset")?;
        let file = staged.directory.child(&staged.name, false)?;
        if identity(&file)? != staged.identity
            || Sha256::digest(read_bounded(file)?).as_slice() != staged.hash.as_slice()
        {
            return Err("Resource changed before insertion".into());
        }
    }
    Ok(true)
}
#[tauri::command]
pub(crate) fn resources_accept(transaction_id: String, asset_ids: Vec<String>) -> Result<bool> {
    let mut store = registry().lock().map_err(error)?;
    let transaction = store
        .transactions
        .get_mut(&transaction_id)
        .ok_or("Unknown resource transaction")?;
    if transaction.relocation {
        return Err("Use commit relocation after saving the document".into());
    }
    let wanted: HashSet<_> = asset_ids.into_iter().collect();
    if wanted
        .iter()
        .any(|id| !transaction.files.iter().any(|file| &file.public.id == id))
    {
        return Err("Asset does not belong to this transaction".into());
    }
    for file in &mut transaction.files {
        if wanted.contains(&file.public.id) {
            file.accepted = true;
        }
    }
    if transaction.files.iter().all(|file| file.accepted) {
        store.transactions.remove(&transaction_id);
    }
    Ok(true)
}
#[tauri::command]
pub(crate) fn resources_abort(transaction_id: String) -> Result<bool> {
    let Some(transaction) = registry()
        .lock()
        .map_err(error)?
        .transactions
        .remove(&transaction_id)
    else {
        return Ok(true);
    };
    cleanup(&transaction.files)?;
    Ok(true)
}
#[tauri::command]
pub(crate) fn resources_resolve_image(
    document_id: String,
    relative_url: String,
) -> Result<ResolvedImage> {
    let current = current_document(&document_id)?;
    let (directory, name) = managed_parts(&relative_url)?;
    let data = read_bounded(
        current
            .parent
            .directory(&directory, false)?
            .child(&name, false)?,
    )?;
    let (image, _) = validate_image(&data)?;
    Ok(ResolvedImage { data, image })
}
#[tauri::command]
pub(crate) async fn resources_choose_save_target(
    app: AppHandle,
    default_path: String,
) -> Result<Option<SaveTarget>> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let path = Path::new(&default_path);
    let mut dialog = app.dialog().file();
    if let Some(name) = path.file_name() {
        dialog = dialog.set_file_name(name.to_string_lossy());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        dialog = dialog.set_directory(parent);
    }
    dialog
        .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
        .save_file(move |file| {
            let _ = send.send(file);
        });
    let Some(selected) = receive.await.map_err(error)? else {
        return Ok(None);
    };
    adopt_save_target(&selected.into_path().map_err(error)?).map(Some)
}
fn adopt_save_target(path: &Path) -> Result<SaveTarget> {
    let document = document(path, false)?;
    let id = token("resource-target")?;
    let path = document.path.to_string_lossy().into_owned();
    let mut store = registry().lock().map_err(error)?;
    store
        .targets
        .retain(|_, target| target.created.elapsed() < Duration::from_secs(600));
    if store.targets.len() >= 16 {
        return Err("Save target budget reached".into());
    }
    store.targets.insert(
        id.clone(),
        Destination {
            document,
            created: Instant::now(),
        },
    );
    Ok(SaveTarget { id, path })
}
#[tauri::command]
pub(crate) fn resources_prepare_relocation(
    document_id: String,
    target_id: String,
    relative_urls: Vec<String>,
) -> Result<Relocation> {
    if relative_urls.len() > 1024 {
        return Err("Resource relocation exceeds 1024 references".into());
    }
    let source = if relative_urls.is_empty() {
        None
    } else {
        Some(current_document(&document_id)?)
    };
    let destination = registry()
        .lock()
        .map_err(error)?
        .targets
        .remove(&target_id)
        .ok_or("Unknown or consumed save target")?;
    if destination.created.elapsed() >= Duration::from_secs(600) {
        return Err("Save target expired; choose again".into());
    }
    let destination = destination.document;
    let files = copy_managed_resources(source.as_deref(), &destination, relative_urls, |_| Ok(()))?;
    let prepared = store_transaction(Transaction {
        document_id,
        destination,
        files,
        relocation: true,
    })?;
    // Preserve the old managed directory basename, including document.assets after renaming.
    Ok(Relocation {
        id: prepared.id,
        replacements: HashMap::new(),
    })
}
fn copy_managed_resources(
    source: Option<&Document>,
    destination: &Document,
    relative_urls: Vec<String>,
    mut admit: impl FnMut(usize) -> Result<()>,
) -> Result<Vec<StagedFile>> {
    if relative_urls.len() > 1024 {
        return Err("Resource relocation exceeds 1024 references".into());
    }
    destination.parent.verify()?;
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0;
    let prepared = (|| {
        for url in relative_urls {
            let (directory_name, name) = managed_parts(&url)?;
            if !seen.insert((directory_name.clone(), name.clone())) {
                continue;
            }
            let data = read_bounded(
                source
                    .ok_or("Unregistered source document")?
                    .parent
                    .directory(&directory_name, false)?
                    .child(&name, false)?,
            )?;
            total += data.len();
            if total > MAX_BATCH_BYTES {
                return Err("Resource relocation exceeds 64 MiB".into());
            }
            let (image, _) = validate_image(&data)?;
            admit(data.len())?;
            let directory = destination.parent.directory(&directory_name, true)?;
            files.push(write_staged(
                directory,
                name.clone(),
                &data,
                name,
                image,
                url,
                true,
            )?);
        }
        Ok(())
    })();
    if let Err(failure) = prepared {
        return match cleanup(&files) {
            Ok(()) => Err(failure),
            Err(cleanup) => Err(format!("{failure}; cleanup: {cleanup}")),
        };
    }
    Ok(files)
}
/// Native recovery alone supplies the original path from its checked record.
/// This is intentionally not a path-taking IPC.
pub(crate) fn restore_recovery_resources(
    document_id: &str,
    expected_copy: &Path,
    original: Option<&str>,
    relative_urls: Vec<String>,
    admit: impl FnMut(usize) -> Result<()>,
) -> Result<()> {
    let destination = current_document(document_id)?;
    if destination.path != expected_copy {
        return Err("Recovery document changed".into());
    }
    let source = if relative_urls.is_empty() {
        None
    } else {
        let origin = Path::new(
            original.ok_or("Recovery has local images but no original resource directory")?,
        );
        if !origin.is_absolute() {
            return Err("Recovery original path is not absolute".into());
        }
        Some(Arc::new(Document {
            path: origin.to_owned(),
            parent: Directory::open(origin.parent().ok_or("Missing recovery origin directory")?)?,
        }))
    };
    // The copy already contains the references. Once all files have arrived they
    // belong to that recovery copy, not a plugin or a transient import lease.
    let _files = copy_managed_resources(source.as_deref(), &destination, relative_urls, admit)?;
    Ok(())
}
pub(crate) fn registered_document_file(document_id: &str) -> Result<(PathBuf, File)> {
    let document = current_document(document_id)?;
    let name = document
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid registered document name")?;
    Ok((document.path.clone(), document.parent.child(name, false)?))
}
// Output selection never grants permission to replace an open document, even
// when a file picker returns a different hard-link name for that document.
pub(crate) fn protect_output_destination(path: &Path, target: Option<&File>) -> Result<()> {
    let store = registry().lock().map_err(error)?;
    let target_identity = target.map(identity).transpose()?;
    for document in store.documents.values() {
        if document.path == path {
            return Err("Output cannot replace an open document".into());
        }
        if let Some(target_identity) = target_identity {
            if let Some(name) = document.path.file_name().and_then(|name| name.to_str()) {
                if let Ok(source) = document.parent.child(name, false) {
                    if identity(&source)? == target_identity {
                        return Err("Output cannot replace an alias of an open document".into());
                    }
                }
            }
        }
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn resources_commit_relocation(transaction_id: String) -> Result<bool> {
    let mut store = registry().lock().map_err(error)?;
    let transaction = store
        .transactions
        .get(&transaction_id)
        .ok_or("Unknown relocation")?;
    if !transaction.relocation {
        return Err("Not a relocation transaction".into());
    }
    let current = store
        .documents
        .get(&transaction.document_id)
        .ok_or("Document is no longer registered")?;
    if current.path != transaction.destination.path {
        return Err("Save has not committed to the authorized destination".into());
    }
    store.transactions.remove(&transaction_id);
    Ok(true)
}
#[tauri::command]
pub(crate) fn resources_release_document(document_id: String) -> Result<bool> {
    registry()
        .lock()
        .map_err(error)?
        .documents
        .remove(&document_id);
    // Transactions must be explicitly aborted by the host. Never infer deletion from unload.
    Ok(true)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceDocumentChunk {
    text: String,
    next_byte: usize,
    total_bytes: usize,
}
#[tauri::command]
pub(crate) fn resources_read_document_chunk(
    registry: tauri::State<crate::LargeFileRegistry>,
    document_id: String,
    expected_version: usize,
    from_byte: usize,
) -> Result<ResourceDocumentChunk> {
    read_document_chunk(&registry, &document_id, expected_version, from_byte)
}
fn read_document_chunk(
    registry: &crate::LargeFileRegistry,
    document_id: &str,
    expected_version: usize,
    from_byte: usize,
) -> Result<ResourceDocumentChunk> {
    let stores = registry.0.lock().map_err(error)?;
    let store = stores.get(document_id).ok_or("Unknown resource document")?;
    if store.version != expected_version {
        return Err("Document changed during resource scan".into());
    }
    let total_bytes = store.piece_tree.byte_len();
    if from_byte > total_bytes {
        return Err("Invalid resource scan offset".into());
    }
    let end = from_byte.saturating_add(64 * 1024).min(total_bytes);
    let mut bytes = store.piece_tree.read_range_bytes(from_byte, end)?;
    match std::str::from_utf8(&bytes) {
        Ok(_) => (),
        Err(failure) if failure.error_len().is_none() && end < total_bytes => {
            bytes.truncate(failure.valid_up_to());
        }
        Err(_) => return Err("Invalid UTF-8 resource scan boundary".into()),
    }
    let next_byte = from_byte + bytes.len();
    Ok(ResourceDocumentChunk {
        text: String::from_utf8(bytes).map_err(error)?,
        next_byte,
        total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resource_scan_reads_current_piece_tree_with_utf8_boundaries_and_version_guard() {
        let fixture = Fixture::new();
        let text = format!("{}😀中文\r\n", "x".repeat(65535));
        fs::write(&fixture.document.path, &text).unwrap();
        let store = crate::LargeFileRegistry(Mutex::new(HashMap::new()));
        crate::open_large_text_file_in_registry(
            &store.0,
            fixture.id.clone(),
            fixture.document.path.to_string_lossy().into_owned(),
        )
        .unwrap();
        crate::apply_large_text_file_changes_in_registry(
            &store.0,
            fixture.id.clone(),
            0,
            vec![crate::LargeFileTextChange {
                from_utf16: 0,
                to_utf16: 0,
                insert: "![new](assets/a.png)".into(),
            }],
        )
        .unwrap();
        assert!(read_document_chunk(&store, &fixture.id, 0, 0)
            .unwrap_err()
            .contains("changed"));
        let mut actual = String::new();
        let mut offset = 0;
        loop {
            let part = read_document_chunk(&store, &fixture.id, 1, offset).unwrap();
            assert!(part.text.len() <= 65536);
            actual.push_str(&part.text);
            offset = part.next_byte;
            if offset == part.total_bytes {
                break;
            }
        }
        assert_eq!(actual, format!("![new](assets/a.png){text}"));
        assert_eq!(fs::read_to_string(&fixture.document.path).unwrap(), text);
        assert!(read_document_chunk(&store, &fixture.id, 1, actual.len() + 1).is_err());
    }
    #[test]
    fn first_save_without_resources_needs_only_a_chosen_target_and_serializes_flat_images() {
        let fixture = Fixture::new();
        let target = adopt_save_target(&fixture.root.join("first.md")).unwrap();
        let relocation =
            resources_prepare_relocation("new-unsaved-document".into(), target.id, vec![]).unwrap();
        resources_abort(relocation.id).unwrap();
        let image = ResolvedImage {
            data: vec![1],
            image: ImageMetadata {
                mime_type: "image/png",
                width: 2,
                height: 3,
            },
        };
        let value = serde_json::to_value(image).unwrap();
        assert_eq!(value["mimeType"], "image/png");
        assert_eq!(value["width"], 2);
        assert!(value.get("image").is_none());
    }
    struct Fixture {
        root: PathBuf,
        id: String,
        document: Arc<Document>,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(token("milkup-resource-test").unwrap());
            fs::create_dir(&root).unwrap();
            let path = root.join("文档.md");
            fs::write(&path, "# original\r\n").unwrap();
            let id = token("document").unwrap();
            register_document(&id, &path);
            let document = current_document(&id).unwrap();
            Self { root, id, document }
        }
        fn stage(&self, bytes: Vec<u8>, policy: ResourcePolicy) -> PreparedResources {
            stage_images(
                &self.id,
                self.document.clone(),
                policy,
                vec![ClipboardImage {
                    name: "照片.png".into(),
                    data: bytes,
                }],
            )
            .unwrap()
        }
        fn asset_path(&self, asset: &PreparedAsset) -> PathBuf {
            let (directory, name) = managed_parts(&asset.relative_path).unwrap();
            self.root.join(directory).join(name)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = resources_release_document(self.id.clone());
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn image_bytes(format: ImageFormat, color: u8) -> Vec<u8> {
        let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            2,
            3,
            image::Rgb([color, 20, 30]),
        ));
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }
    #[test]
    fn accepts_three_decodable_formats_and_rejects_forged_truncated_and_oversize_images() {
        for (format, mime) in [
            (ImageFormat::Png, "image/png"),
            (ImageFormat::Jpeg, "image/jpeg"),
            (ImageFormat::WebP, "image/webp"),
        ] {
            let bytes = image_bytes(format, 1);
            let (metadata, _) = validate_image(&bytes).unwrap();
            assert_eq!(metadata.mime_type, mime);
            assert_eq!((metadata.width, metadata.height), (2, 3));
            assert!(validate_image(&bytes[..bytes.len() / 2]).is_err());
        }
        assert!(validate_image(b"<svg><script>anything</script></svg>").is_err());
        assert!(validate_image(&vec![1; MAX_IMAGE_BYTES + 1]).is_err());
        let wide = image::DynamicImage::new_rgb8(16385, 1);
        let mut bytes = Cursor::new(Vec::new());
        wide.write_to(&mut bytes, ImageFormat::Png).unwrap();
        assert!(validate_image(&bytes.into_inner()).is_err());
    }
    #[test]
    fn pixel_budget_rejects_decodable_images_with_individually_valid_dimensions() {
        use image::ImageEncoder;
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new_with_quality(
            &mut bytes,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::NoFilter,
        )
        .write_image(
            &vec![0; 8000 * 5001],
            8000,
            5001,
            image::ExtendedColorType::L8,
        )
        .unwrap();
        assert!(bytes.len() < MAX_IMAGE_BYTES);
        assert_eq!(
            ImageReader::with_format(Cursor::new(&bytes), ImageFormat::Png)
                .into_dimensions()
                .unwrap(),
            (8000, 5001)
        );
        assert!(validate_image(&bytes).unwrap_err().contains("40 megapixel"));
    }
    #[test]
    fn misleading_extension_does_not_override_decoded_format_or_written_extension() {
        let fixture = Fixture::new();
        let source = grant_source(
            fixture.id.clone(),
            fixture.document.clone(),
            ClipboardImage {
                name: "looks-like-png.png".into(),
                data: image_bytes(ImageFormat::WebP, 3),
            },
        )
        .unwrap();
        assert_eq!(source.mime_type, "image/webp");
        let staged =
            resources_stage_image(fixture.id.clone(), source.id, ResourcePolicy::Assets).unwrap();
        assert_eq!(staged.assets[0].image.mime_type, "image/webp");
        assert!(staged.assets[0].relative_path.ends_with(".webp"));
        resources_abort(staged.id).unwrap();
    }
    #[test]
    fn sources_are_document_scoped_single_use_and_content_verified() {
        let fixture = Fixture::new();
        let other = Fixture::new();
        let source = grant_source(
            fixture.id.clone(),
            fixture.document.clone(),
            ClipboardImage {
                name: "one.png".into(),
                data: image_bytes(ImageFormat::Png, 1),
            },
        )
        .unwrap();
        assert!(
            resources_stage_image(other.id.clone(), source.id.clone(), ResourcePolicy::Assets)
                .is_err()
        );
        assert!(
            resources_stage_image(fixture.id.clone(), source.id, ResourcePolicy::Assets).is_err()
        );
        assert!(resources_stage_image(
            fixture.id.clone(),
            "guessed".into(),
            ResourcePolicy::Assets
        )
        .is_err());
    }
    #[test]
    fn simultaneous_identical_imports_have_distinct_exclusive_files() {
        let fixture = Fixture::new();
        let a_id = fixture.id.clone();
        let b_id = fixture.id.clone();
        let a_doc = fixture.document.clone();
        let b_doc = fixture.document.clone();
        let a = std::thread::spawn(move || {
            stage_images(
                &a_id,
                a_doc,
                ResourcePolicy::Assets,
                vec![ClipboardImage {
                    name: "same.png".into(),
                    data: image_bytes(ImageFormat::Png, 1),
                }],
            )
            .unwrap()
        });
        let b = std::thread::spawn(move || {
            stage_images(
                &b_id,
                b_doc,
                ResourcePolicy::Assets,
                vec![ClipboardImage {
                    name: "same.png".into(),
                    data: image_bytes(ImageFormat::Png, 2),
                }],
            )
            .unwrap()
        });
        let a = a.join().unwrap();
        let b = b.join().unwrap();
        assert_ne!(a.assets[0].relative_path, b.assets[0].relative_path);
        assert_eq!(
            fs::read(fixture.asset_path(&a.assets[0])).unwrap(),
            image_bytes(ImageFormat::Png, 1)
        );
        assert_eq!(
            fs::read(fixture.asset_path(&b.assets[0])).unwrap(),
            image_bytes(ImageFormat::Png, 2)
        );
        resources_abort(a.id).unwrap();
        resources_abort(b.id).unwrap();
    }
    #[test]
    fn abort_removes_only_unchanged_owned_files_and_accepted_assets_survive() {
        let fixture = Fixture::new();
        let bytes = image_bytes(ImageFormat::Png, 1);
        let pending = fixture.stage(bytes.clone(), ResourcePolicy::Assets);
        let path = fixture.asset_path(&pending.assets[0]);
        resources_abort(pending.id).unwrap();
        assert!(!path.exists());
        let changed = fixture.stage(bytes.clone(), ResourcePolicy::Assets);
        let path = fixture.asset_path(&changed.assets[0]);
        fs::write(&path, "external edit").unwrap();
        assert!(resources_validate_assets(
            changed.id.clone(),
            fixture.id.clone(),
            vec![changed.assets[0].id.clone()]
        )
        .is_err());
        assert!(resources_abort(changed.id).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external edit");
        let accepted = fixture.stage(bytes, ResourcePolicy::Assets);
        let path = fixture.asset_path(&accepted.assets[0]);
        resources_accept(accepted.id.clone(), vec![accepted.assets[0].id.clone()]).unwrap();
        resources_abort(accepted.id).unwrap();
        assert!(path.exists());
    }
    #[test]
    fn resolver_reopens_managed_images_and_rejects_network_absolute_and_traversal() {
        let fixture = Fixture::new();
        let prepared = fixture.stage(
            image_bytes(ImageFormat::WebP, 1),
            ResourcePolicy::DocumentAssets,
        );
        let asset = &prepared.assets[0];
        assert!(asset
            .relative_path
            .starts_with("%E6%96%87%E6%A1%A3.assets/"));
        resources_accept(prepared.id.clone(), vec![asset.id.clone()]).unwrap();
        resources_release_document(fixture.id.clone()).unwrap();
        register_document(&fixture.id, &fixture.document.path);
        let resolved =
            resources_resolve_image(fixture.id.clone(), asset.relative_path.clone()).unwrap();
        assert_eq!(resolved.image.width, 2);
        for url in [
            "https://example.com/a.png",
            "file:///tmp/a.png",
            "/assets/a.png",
            "assets/../a.png",
            "assets/%2e%2e",
            "elsewhere/a.png",
            "assets/a.png?x",
            "assets/a%00.png",
        ] {
            assert!(
                resources_resolve_image(fixture.id.clone(), url.into()).is_err(),
                "{url}"
            );
        }
    }
    #[test]
    fn relocation_preserves_references_and_originals_and_is_readable_after_reopen() {
        let fixture = Fixture::new();
        let original = fixture.stage(
            image_bytes(ImageFormat::Png, 1),
            ResourcePolicy::DocumentAssets,
        );
        resources_accept(original.id.clone(), vec![original.assets[0].id.clone()]).unwrap();
        let source = fixture.asset_path(&original.assets[0]);
        let target_dir = fixture.root.join("copy");
        fs::create_dir(&target_dir).unwrap();
        let target = adopt_save_target(&target_dir.join("different.md")).unwrap();
        let relocation = resources_prepare_relocation(
            fixture.id.clone(),
            target.id,
            vec![original.assets[0].relative_path.clone()],
        )
        .unwrap();
        assert!(relocation.replacements.is_empty());
        assert!(resources_commit_relocation(relocation.id.clone()).is_err());
        fs::write(&target.path, "# copied").unwrap();
        register_document(&fixture.id, Path::new(&target.path));
        resources_commit_relocation(relocation.id.clone()).unwrap();
        resources_abort(relocation.id).unwrap();
        resources_release_document(fixture.id.clone()).unwrap();
        register_document(&fixture.id, Path::new(&target.path));
        assert!(resources_resolve_image(
            fixture.id.clone(),
            original.assets[0].relative_path.clone()
        )
        .is_ok());
        assert!(source.exists());
    }
    #[test]
    fn markdown_committed_before_index_failure_keeps_copied_resources_on_abort() {
        let fixture = Fixture::new();
        let original = fixture.stage(image_bytes(ImageFormat::Png, 8), ResourcePolicy::Assets);
        resources_accept(original.id.clone(), vec![original.assets[0].id.clone()]).unwrap();
        let text = format!("![image]({})\r\n", original.assets[0].relative_path);
        fs::write(&fixture.document.path, &text).unwrap();
        let store = crate::LargeFileRegistry(Mutex::new(HashMap::new()));
        crate::open_large_text_file_in_registry(
            &store.0,
            fixture.id.clone(),
            fixture.document.path.to_string_lossy().into_owned(),
        )
        .unwrap();
        let target_dir = fixture.root.join("committed-copy");
        fs::create_dir(&target_dir).unwrap();
        let target = adopt_save_target(&target_dir.join("saved.md")).unwrap();
        let relocation = resources_prepare_relocation(
            fixture.id.clone(),
            target.id,
            vec![original.assets[0].relative_path.clone()],
        )
        .unwrap();
        crate::FAIL_LARGE_SAVE_AFTER_RENAME.with(|value| value.set(true));
        let failure = crate::flush_large_text_file_as_in_registry(
            &store.0,
            fixture.id.clone(),
            0,
            target.path.clone(),
        )
        .err()
        .unwrap();
        assert!(failure.contains("was written"));
        assert!(failure.contains("Reopen"));
        assert_eq!(fs::read_to_string(&target.path).unwrap(), text);
        resources_abort(relocation.id).unwrap();
        resources_release_document(fixture.id.clone()).unwrap();
        register_document(&fixture.id, Path::new(&target.path));
        assert!(resources_resolve_image(
            fixture.id.clone(),
            original.assets[0].relative_path.clone()
        )
        .is_ok());
        assert!(fixture.asset_path(&original.assets[0]).exists());
    }
    #[test]
    fn relocation_conflicts_do_not_overwrite_and_partial_copies_roll_back() {
        let fixture = Fixture::new();
        let first = fixture.stage(image_bytes(ImageFormat::Png, 1), ResourcePolicy::Assets);
        let second = fixture.stage(image_bytes(ImageFormat::Png, 2), ResourcePolicy::Assets);
        resources_accept(first.id.clone(), vec![first.assets[0].id.clone()]).unwrap();
        resources_accept(second.id.clone(), vec![second.assets[0].id.clone()]).unwrap();
        let target_dir = fixture.root.join("copy");
        fs::create_dir_all(target_dir.join("assets")).unwrap();
        let (_, name) = managed_parts(&second.assets[0].relative_path).unwrap();
        let conflict = target_dir.join("assets").join(name);
        fs::write(&conflict, image_bytes(ImageFormat::Png, 3)).unwrap();
        let target = adopt_save_target(&target_dir.join("copy.md")).unwrap();
        assert!(resources_prepare_relocation(
            fixture.id.clone(),
            target.id,
            vec![
                first.assets[0].relative_path.clone(),
                second.assets[0].relative_path.clone()
            ]
        )
        .unwrap_err()
        .contains("different bytes"));
        assert_eq!(
            fs::read(&conflict).unwrap(),
            image_bytes(ImageFormat::Png, 3)
        );
        assert_eq!(fs::read_dir(target_dir.join("assets")).unwrap().count(), 1);
        assert!(fixture.asset_path(&first.assets[0]).exists());
        assert!(fixture.asset_path(&second.assets[0]).exists());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_directories_files_and_replaced_ancestors_do_not_escape() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        symlink(&outside.root, fixture.root.join("assets")).unwrap();
        assert!(stage_images(
            &fixture.id,
            fixture.document.clone(),
            ResourcePolicy::Assets,
            vec![ClipboardImage {
                name: "a.png".into(),
                data: image_bytes(ImageFormat::Png, 1)
            }]
        )
        .is_err());
        fs::remove_file(fixture.root.join("assets")).unwrap();
        fs::create_dir(fixture.root.join("assets")).unwrap();
        fs::write(
            outside.root.join("secret.png"),
            image_bytes(ImageFormat::Png, 1),
        )
        .unwrap();
        symlink(
            outside.root.join("secret.png"),
            fixture.root.join("assets/link.png"),
        )
        .unwrap();
        assert!(resources_resolve_image(fixture.id.clone(), "assets/link.png".into()).is_err());
        let prepared = fixture.stage(image_bytes(ImageFormat::Png, 2), ResourcePolicy::Assets);
        fs::rename(fixture.root.join("assets"), fixture.root.join("old-assets")).unwrap();
        symlink(&outside.root, fixture.root.join("assets")).unwrap();
        assert!(resources_abort(prepared.id).is_err());
        assert_eq!(
            fs::read(outside.root.join("secret.png")).unwrap(),
            image_bytes(ImageFormat::Png, 1)
        );
    }
}

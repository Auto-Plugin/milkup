//! Bounded current-document search. ASCII-equivalent batches stay native;
//! other batches use the renderer's existing JS locale semantics in a Worker.
use super::{
    large_file_snapshot, LargeFileRegistration, LargeFileRegistry, LargeFileSnapshotResult,
};
use crate::piece_tree::{BaseEncoding, PieceTree};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::State;

const STEP_BYTES: usize = 1024 * 1024;
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const MAX_INDEX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_HISTORY_BYTES: usize = 4 * 1024 * 1024 * 1024;
const RECORD_BYTES: usize = 80;

#[derive(Default)]
pub(crate) struct NativeSearchRegistry(Mutex<Registry>);
#[derive(Default)]
struct Registry {
    searches: HashMap<String, Search>,
    generations: HashMap<String, usize>,
    replacements: HashMap<String, Replacement>,
    histories: HashMap<String, History>,
}
struct PrivateDir(PathBuf);
impl PrivateDir {
    fn new() -> Result<Arc<Self>, String> {
        let name = format!(
            "milkup-search-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(err)?
                .as_nanos()
        );
        let path = std::env::temp_dir().join(name);
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).map_err(err)?;
        Ok(Arc::new(Self(path)))
    }
}
impl Drop for PrivateDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn valid_version(store: &LargeFileRegistration, expected: usize) -> Result<(), String> {
    if store.version != expected {
        return Err("Document changed during search or replacement".into());
    }
    Ok(())
}
fn new_file(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(err)
}

// Ten u64 fields. Consecutive equal-stride hits on one line form a run; dense
// repeated characters do not allocate one object or disk record per match.
#[derive(Clone, Copy, Debug)]
struct Run {
    first: usize,
    byte: usize,
    utf16: usize,
    line: usize,
    column: usize,
    bytes: usize,
    units: usize,
    count: usize,
    byte_step: usize,
    unit_step: usize,
}
impl Run {
    fn end_byte(&self) -> usize {
        self.byte + (self.count - 1) * self.byte_step + self.bytes
    }
    fn member(&self, index: usize) -> Self {
        let offset = index - self.first;
        Self {
            first: index,
            byte: self.byte + offset * self.byte_step,
            utf16: self.utf16 + offset * self.unit_step,
            column: self.column + offset * self.unit_step,
            count: 1,
            byte_step: 0,
            unit_step: 0,
            ..*self
        }
    }
    fn write(&self, writer: &mut impl Write) -> Result<(), String> {
        for n in [
            self.first,
            self.byte,
            self.utf16,
            self.line,
            self.column,
            self.bytes,
            self.units,
            self.count,
            self.byte_step,
            self.unit_step,
        ] {
            writer.write_all(&(n as u64).to_le_bytes()).map_err(err)?;
        }
        Ok(())
    }
    fn read(reader: &mut impl Read) -> Result<Self, String> {
        let mut bytes = [0; RECORD_BYTES];
        reader.read_exact(&mut bytes).map_err(err)?;
        let mut values = [0_usize; 10];
        for (i, chunk) in bytes.chunks_exact(8).enumerate() {
            values[i] =
                usize::try_from(u64::from_le_bytes(chunk.try_into().unwrap())).map_err(err)?;
        }
        Ok(Self {
            first: values[0],
            byte: values[1],
            utf16: values[2],
            line: values[3],
            column: values[4],
            bytes: values[5],
            units: values[6],
            count: values[7],
            byte_step: values[8],
            unit_step: values[9],
        })
    }
}
struct Index {
    writer: BufWriter<File>,
    path: PathBuf,
    pending: Option<Run>,
    records: usize,
    count: usize,
    matched_bytes: usize,
    last_end: usize,
}
impl Index {
    fn new(dir: &PrivateDir) -> Result<Self, String> {
        let path = dir.0.join("matches.bin");
        Ok(Self {
            writer: BufWriter::with_capacity(65536, new_file(&path)?),
            path,
            pending: None,
            records: 0,
            count: 0,
            matched_bytes: 0,
            last_end: 0,
        })
    }
    fn append(&mut self, mut hit: Run) -> Result<(), String> {
        if hit.units == 0 || hit.bytes == 0 || hit.utf16 < self.last_end {
            return Err("Invalid or overlapping search result".into());
        }
        hit.first = self.count;
        hit.count = 1;
        self.count += 1;
        self.matched_bytes += hit.bytes;
        self.last_end = hit.utf16 + hit.units;
        if let Some(last) = &mut self.pending {
            if last.line == hit.line && last.bytes == hit.bytes && last.units == hit.units {
                let bs = hit.byte - (last.byte + (last.count - 1) * last.byte_step);
                let us = hit.utf16 - (last.utf16 + (last.count - 1) * last.unit_step);
                if last.count == 1 || (bs == last.byte_step && us == last.unit_step) {
                    last.byte_step = bs;
                    last.unit_step = us;
                    last.count += 1;
                    return Ok(());
                }
            }
        }
        self.flush_run()?;
        self.pending = Some(hit);
        Ok(())
    }
    fn flush_run(&mut self) -> Result<(), String> {
        if let Some(run) = self.pending.take() {
            if (self.records as u64 + 1) * RECORD_BYTES as u64 > MAX_INDEX_BYTES {
                return Err(
                    "Search index exceeds its 512 MiB safety budget; results are incomplete".into(),
                );
            }
            run.write(&mut self.writer)?;
            self.records += 1;
        }
        Ok(())
    }
    fn flush(&mut self) -> Result<(), String> {
        self.flush_run()?;
        self.writer.flush().map_err(err)
    }
    fn locate(&self, index: usize) -> Result<(usize, Run), String> {
        if index >= self.count {
            return Err("Search result index is out of range".into());
        }
        let mut file = File::open(&self.path).map_err(err)?;
        let (mut low, mut high) = (0, self.records);
        while low < high {
            let middle = (low + high) / 2;
            file.seek(SeekFrom::Start((middle * RECORD_BYTES) as u64))
                .map_err(err)?;
            let run = Run::read(&mut file)?;
            if index < run.first {
                high = middle;
            } else if index >= run.first + run.count {
                low = middle + 1;
            } else {
                return Ok((middle, run));
            }
        }
        Err("Search index is inconsistent".into())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRequest {
    document_id: String,
    expected_version: usize,
    search_id: String,
    generation: usize,
    query: String,
    case_sensitive: bool,
    ascii_fold_safe: bool,
}
struct Fallback {
    text: String,
    byte: usize,
    utf16: usize,
    line: usize,
    end_byte: usize,
    end_utf16: usize,
    next_line: usize,
    map_byte: usize,
    map_utf16: usize,
    map_line: usize,
    line_start: usize,
}
struct Search {
    document_id: String,
    version: usize,
    query: String,
    case_sensitive: bool,
    ascii_fold_safe: bool,
    cursor_byte: usize,
    cursor_utf16: usize,
    next_line: usize,
    complete: bool,
    fallback: Option<Fallback>,
    index: Index,
    _dir: Arc<PrivateDir>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FallbackWindow {
    text: String,
    from_utf16: usize,
    from_line: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchProgress {
    complete: bool,
    match_count: usize,
    scanned_line_count: usize,
    scanned_bytes: usize,
    native_ms: f64,
    index_bytes: usize,
    fallback: Option<FallbackWindow>,
}
impl Search {
    fn progress(&self, line_count: usize, elapsed: f64) -> SearchProgress {
        SearchProgress {
            complete: self.complete,
            match_count: self.index.count,
            scanned_line_count: if self.complete {
                line_count
            } else {
                self.next_line.saturating_sub(1)
            },
            scanned_bytes: self.cursor_byte,
            native_ms: elapsed,
            index_bytes: self.index.records * RECORD_BYTES,
            fallback: None,
        }
    }
    fn step(&mut self, store: &LargeFileRegistration) -> Result<SearchProgress, String> {
        valid_version(store, self.version)?;
        let started = Instant::now();
        if self.complete || self.fallback.is_some() {
            return Ok(self.progress(store.piece_tree.line_count(), 0.0));
        }
        let size = store.piece_tree.byte_len();
        let from = self.cursor_byte;
        let mut budget = STEP_BYTES;
        let text = loop {
            let end = size.min(from + budget);
            let mut bytes = store.piece_tree.read_range_bytes(from, end)?;
            if end < size {
                if let Some(last) = bytes.iter().rposition(|&b| b == b'\n') {
                    bytes.truncate(last + 1);
                } else {
                    if budget >= MAX_LINE_BYTES {
                        return Err("A logical line exceeds the 8 MiB search buffer budget; results are incomplete".into());
                    }
                    budget = (budget * 2).min(MAX_LINE_BYTES);
                    continue;
                }
            }
            break String::from_utf8(bytes).map_err(err)?;
        };
        let end_byte = from + text.len();
        let ascii = text.is_ascii();
        let end_utf16 = self.cursor_utf16
            + if ascii {
                text.len()
            } else {
                text.encode_utf16().count()
            };
        let next_line = self.next_line + text.matches('\n').count();
        if !self.case_sensitive && !(self.ascii_fold_safe && self.query.is_ascii() && ascii) {
            self.fallback = Some(Fallback {
                text,
                byte: from,
                utf16: self.cursor_utf16,
                line: self.next_line,
                end_byte,
                end_utf16,
                next_line,
                map_byte: 0,
                map_utf16: self.cursor_utf16,
                map_line: self.next_line,
                line_start: self.cursor_utf16,
            });
        } else {
            let needle = if self.case_sensitive {
                self.query.clone()
            } else {
                self.query.to_ascii_lowercase()
            };
            let (mut byte, mut units, mut line) = (from, self.cursor_utf16, self.next_line);
            for raw in text.split_inclusive('\n') {
                let content = raw.strip_suffix('\n').unwrap_or(raw);
                let content = content.strip_suffix('\r').unwrap_or(content);
                let lowered;
                if self.case_sensitive {
                    lowered = None;
                } else {
                    lowered = Some(content.to_ascii_lowercase());
                }
                let haystack = lowered.as_deref().unwrap_or(content);
                let (mut at, mut measured, mut column) = (0, 0, 0);
                while let Some(found) = haystack[at..].find(&needle) {
                    let start = at + found;
                    let end = start + needle.len();
                    column += if ascii {
                        start - measured
                    } else {
                        content[measured..start].encode_utf16().count()
                    };
                    let width = if ascii {
                        end - start
                    } else {
                        content[start..end].encode_utf16().count()
                    };
                    self.index.append(Run {
                        first: 0,
                        byte: byte + start,
                        utf16: units + column,
                        line,
                        column,
                        bytes: end - start,
                        units: width,
                        count: 1,
                        byte_step: 0,
                        unit_step: 0,
                    })?;
                    column += width;
                    measured = end;
                    at = end;
                }
                byte += raw.len();
                units += if ascii {
                    raw.len()
                } else {
                    raw.encode_utf16().count()
                };
                line += 1;
            }
            self.cursor_byte = end_byte;
            self.cursor_utf16 = end_utf16;
            self.next_line = next_line;
            self.complete = end_byte == size;
            self.index.flush()?;
        }
        let mut result = self.progress(
            store.piece_tree.line_count(),
            started.elapsed().as_secs_f64() * 1000.0,
        );
        result.fallback = self.fallback.as_ref().map(|w| FallbackWindow {
            text: w.text.clone(),
            from_utf16: w.utf16,
            from_line: w.line,
        });
        Ok(result)
    }
    fn append_fallback(
        &mut self,
        store: &LargeFileRegistration,
        matches: &[[usize; 4]],
        done: bool,
    ) -> Result<SearchProgress, String> {
        valid_version(store, self.version)?;
        if matches.len() > 8192 {
            return Err("Worker result batch too large".into());
        }
        let started = Instant::now();
        let pending = self
            .fallback
            .as_mut()
            .ok_or("No pending Unicode search batch")?;
        for &[from, to, line, column] in matches {
            if from < pending.map_utf16 || to <= from || to > pending.end_utf16 {
                return Err("Invalid Worker match coordinates".into());
            }
            advance_fallback(pending, from)?;
            let byte = pending.byte + pending.map_byte;
            if line != pending.map_line || column != from - pending.line_start {
                return Err("Worker line coordinates do not match UTF-16 source".into());
            }
            advance_fallback(pending, to)?;
            self.index.append(Run {
                first: 0,
                byte,
                utf16: from,
                line,
                column,
                bytes: pending.byte + pending.map_byte - byte,
                units: to - from,
                count: 1,
                byte_step: 0,
                unit_step: 0,
            })?;
        }
        if done {
            let pending = self.fallback.take().unwrap();
            self.cursor_byte = pending.end_byte;
            self.cursor_utf16 = pending.end_utf16;
            self.next_line = pending.next_line;
            self.complete = self.cursor_byte == store.piece_tree.byte_len();
            self.index.flush()?;
        }
        // Do not return the same text again after every Worker acknowledgement.
        let mut result = self.progress(
            store.piece_tree.line_count(),
            started.elapsed().as_secs_f64() * 1000.0,
        );
        result.fallback = None;
        Ok(result)
    }
}
fn advance_fallback(window: &mut Fallback, target: usize) -> Result<(), String> {
    while window.map_utf16 < target {
        let point = window.text[window.map_byte..]
            .chars()
            .next()
            .ok_or("Invalid Worker boundary")?;
        window.map_byte += point.len_utf8();
        window.map_utf16 += point.len_utf16();
        if point == '\n' {
            window.map_line += 1;
            window.line_start = window.map_utf16;
        }
    }
    if window.map_utf16 != target {
        return Err("Worker match splits a UTF-16 surrogate pair".into());
    }
    Ok(())
}
fn search_meta(registry: &NativeSearchRegistry, id: &str) -> Result<(String, usize), String> {
    let guard = registry.0.lock().map_err(err)?;
    let s = guard
        .searches
        .get(id)
        .ok_or("Search was cancelled or superseded")?;
    Ok((s.document_id.clone(), s.version))
}
fn begin(
    files: &Mutex<HashMap<String, LargeFileRegistration>>,
    registry: &NativeSearchRegistry,
    request: SearchRequest,
) -> Result<(), String> {
    if request.query.is_empty() || request.query.encode_utf16().count() > 65536 {
        return Err("Search query must contain 1–65536 UTF-16 units".into());
    }
    let stores = files.lock().map_err(err)?;
    let store = stores
        .get(&request.document_id)
        .ok_or("Document is closed")?;
    valid_version(store, request.expected_version)?;
    let mut data = registry.0.lock().map_err(err)?;
    if data
        .generations
        .get(&request.document_id)
        .is_some_and(|v| *v >= request.generation)
    {
        return Err("Search was superseded".into());
    }
    let dir = PrivateDir::new()?;
    let index = Index::new(&dir)?;
    data.searches
        .retain(|_, s| s.document_id != request.document_id);
    data.generations
        .insert(request.document_id.clone(), request.generation);
    data.searches.insert(
        request.search_id,
        Search {
            document_id: request.document_id,
            version: request.expected_version,
            query: request.query,
            case_sensitive: request.case_sensitive,
            ascii_fold_safe: request.ascii_fold_safe,
            cursor_byte: 0,
            cursor_utf16: 0,
            next_line: 1,
            complete: false,
            fallback: None,
            index,
            _dir: dir,
        },
    );
    Ok(())
}
#[tauri::command]
pub(crate) async fn begin_large_text_search(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    request: SearchRequest,
) -> Result<(), String> {
    begin(&files.0, &searches, request)
}
#[tauri::command]
pub(crate) async fn step_large_text_search(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    search_id: String,
) -> Result<SearchProgress, String> {
    let (doc, version) = search_meta(&searches, &search_id)?;
    let stores = files.0.lock().map_err(err)?;
    let store = stores.get(&doc).ok_or("Document is closed")?;
    valid_version(store, version)?;
    searches
        .0
        .lock()
        .map_err(err)?
        .searches
        .get_mut(&search_id)
        .ok_or("Search cancelled")?
        .step(store)
}
#[tauri::command]
pub(crate) async fn append_large_text_search_matches(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    search_id: String,
    matches: Vec<[usize; 4]>,
    done: bool,
) -> Result<SearchProgress, String> {
    let (doc, version) = search_meta(&searches, &search_id)?;
    let stores = files.0.lock().map_err(err)?;
    let store = stores.get(&doc).ok_or("Document is closed")?;
    valid_version(store, version)?;
    searches
        .0
        .lock()
        .map_err(err)?
        .searches
        .get_mut(&search_id)
        .ok_or("Search cancelled")?
        .append_fallback(store, &matches, done)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchMatch {
    from: usize,
    to: usize,
    line: usize,
    line_offset: usize,
    text: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchPage {
    matches: Vec<SearchMatch>,
    match_offset: usize,
    match_count: usize,
}
fn page(
    store: &LargeFileRegistration,
    search: &Search,
    start: usize,
) -> Result<SearchPage, String> {
    valid_version(store, search.version)?;
    if !search.complete {
        return Err("Search has not completed".into());
    }
    let mut matches = Vec::new();
    if search.index.count == 0 {
        return Ok(SearchPage {
            matches,
            match_offset: 0,
            match_count: 0,
        });
    }
    let (record, mut run) = search.index.locate(start)?;
    let mut reader = BufReader::new(File::open(&search.index.path).map_err(err)?);
    reader
        .seek(SeekFrom::Start(((record + 1) * RECORD_BYTES) as u64))
        .map_err(err)?;
    let mut text_bytes = 0;
    for index in start..(start + 128).min(search.index.count) {
        if index >= run.first + run.count {
            run = Run::read(&mut reader)?;
        }
        let hit = run.member(index);
        let text = store
            .piece_tree
            .read_range(hit.byte, hit.byte + hit.bytes)?;
        text_bytes += text.len();
        matches.push(SearchMatch {
            from: hit.utf16,
            to: hit.utf16 + hit.units,
            line: hit.line,
            line_offset: hit.column,
            text,
        });
        if text_bytes >= STEP_BYTES {
            break;
        }
    }
    Ok(SearchPage {
        matches,
        match_offset: start,
        match_count: search.index.count,
    })
}
#[tauri::command]
pub(crate) async fn page_large_text_search(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    search_id: String,
    start: usize,
) -> Result<SearchPage, String> {
    let (doc, version) = search_meta(&searches, &search_id)?;
    let stores = files.0.lock().map_err(err)?;
    let store = stores.get(&doc).ok_or("Document is closed")?;
    valid_version(store, version)?;
    let data = searches.0.lock().map_err(err)?;
    page(
        store,
        data.searches.get(&search_id).ok_or("Search cancelled")?,
        start,
    )
}
#[tauri::command]
pub(crate) async fn cancel_large_text_search(
    searches: State<'_, NativeSearchRegistry>,
    search_id: String,
) -> Result<(), String> {
    searches.0.lock().map_err(err)?.searches.remove(&search_id);
    Ok(())
}

// Replacement preparation and native snapshot history are defined below.
struct Replacement {
    document_id: String,
    version: usize,
    insert: Vec<u8>,
    encoding: BaseEncoding,
    before_path: PathBuf,
    after_path: PathBuf,
    before: Option<BufWriter<File>>,
    after: Option<BufWriter<File>>,
    reader: BufReader<File>,
    records_left: usize,
    next: Option<Run>,
    cursor: usize,
    size: usize,
    prepared: Option<PieceTree>,
    history_bytes: usize,
    replaced: usize,
    _search_dir: Arc<PrivateDir>,
    dir: Arc<PrivateDir>,
}
struct History {
    document_id: String,
    before: PathBuf,
    after: PathBuf,
    encoding: BaseEncoding,
    applied: bool,
    bytes: usize,
    dir: Arc<PrivateDir>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceRequest {
    document_id: String,
    expected_version: usize,
    search_id: String,
    replacement_id: String,
    insert: String,
    selected_index: Option<usize>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceProgress {
    ready: bool,
    copied_bytes: usize,
    total_bytes: usize,
    replaced_count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceResult {
    snapshot: LargeFileSnapshotResult,
    history_id: String,
}
impl Replacement {
    fn progress(&self) -> ReplaceProgress {
        ReplaceProgress {
            ready: self.prepared.is_some(),
            copied_bytes: self.cursor,
            total_bytes: self.size,
            replaced_count: self.replaced,
        }
    }
    fn step(&mut self, store: &LargeFileRegistration) -> Result<ReplaceProgress, String> {
        valid_version(store, self.version)?;
        if self.prepared.is_some() {
            return Ok(self.progress());
        }
        let start = self.cursor;
        let mut end = (start + STEP_BYTES).min(self.size);
        let mut runs = Vec::new();
        while self.next.is_some_and(|r| r.byte < end) {
            let run = self.next.take().unwrap();
            end = end.max(run.end_byte());
            runs.push(run);
            self.next = if self.records_left > 0 {
                self.records_left -= 1;
                Some(Run::read(&mut self.reader)?)
            } else {
                None
            };
        }
        let mut bytes = store.piece_tree.read_range_bytes(start, end)?;
        if let Err(error) = std::str::from_utf8(&bytes) {
            if error.error_len().is_some() {
                return Err("Invalid UTF-8 replacement source".into());
            }
            bytes.truncate(error.valid_up_to());
            end = start + bytes.len();
        }
        let before = self
            .before
            .as_mut()
            .ok_or("Replacement already finalized")?;
        before.write_all(&bytes).map_err(err)?;
        let after = self.after.as_mut().ok_or("Replacement already finalized")?;
        let mut position = 0;
        for run in runs {
            after
                .write_all(&bytes[position..run.byte - start])
                .map_err(err)?;
            if run.count == 1 || run.byte_step == run.bytes {
                write_repeated(after, &self.insert, run.count)?;
                position = run.end_byte() - start;
            } else {
                position = run.byte - start;
                for offset in 0..run.count {
                    let begin = run.byte + offset * run.byte_step - start;
                    after.write_all(&bytes[position..begin]).map_err(err)?;
                    after.write_all(&self.insert).map_err(err)?;
                    position = begin + run.bytes;
                }
            }
        }
        after.write_all(&bytes[position..]).map_err(err)?;
        self.cursor = end;
        if end == self.size {
            self.before.as_mut().unwrap().flush().map_err(err)?;
            self.after.as_mut().unwrap().flush().map_err(err)?;
            self.before.take();
            self.after.take();
            let mut tree = PieceTree::open(&self.after_path, self.dir.0.join("current-add.bin"))?;
            tree.set_encoding(self.encoding);
            self.prepared = Some(tree);
        }
        Ok(self.progress())
    }
}
fn write_repeated(writer: &mut impl Write, insert: &[u8], count: usize) -> Result<(), String> {
    if insert.is_empty() {
        return Ok(());
    }
    let batch = (65536 / insert.len()).max(1).min(count);
    let mut buffer = Vec::with_capacity(batch * insert.len());
    for _ in 0..batch {
        buffer.extend_from_slice(insert);
    }
    let mut left = count;
    while left >= batch {
        writer.write_all(&buffer).map_err(err)?;
        left -= batch;
    }
    for _ in 0..left {
        writer.write_all(insert).map_err(err)?;
    }
    Ok(())
}
fn replacement_begin(
    files: &Mutex<HashMap<String, LargeFileRegistration>>,
    registry: &NativeSearchRegistry,
    request: ReplaceRequest,
) -> Result<ReplaceProgress, String> {
    if request.insert.len() > MAX_LINE_BYTES {
        return Err("Replacement text exceeds the 8 MiB safety budget".into());
    }
    let stores = files.lock().map_err(err)?;
    let store = stores
        .get(&request.document_id)
        .ok_or("Document is closed")?;
    valid_version(store, request.expected_version)?;
    let mut data = registry.0.lock().map_err(err)?;
    if data
        .replacements
        .values()
        .any(|r| r.document_id == request.document_id)
    {
        return Err("A replacement is already being prepared".into());
    }
    let search = data
        .searches
        .get(&request.search_id)
        .ok_or("Search was cancelled")?;
    if search.document_id != request.document_id
        || search.version != request.expected_version
        || !search.complete
        || search.index.count == 0
    {
        return Err("Replacement requires complete, current search results".into());
    }
    let selected = match request.selected_index {
        Some(index) => Some(search.index.locate(index)?.1.member(index)),
        None => None,
    };
    let count = if selected.is_some() {
        1
    } else {
        search.index.count
    };
    let removed = selected
        .map(|r| r.bytes)
        .unwrap_or(search.index.matched_bytes);
    let size = store.piece_tree.byte_len();
    let output = size
        .checked_sub(removed)
        .and_then(|n| {
            request
                .insert
                .len()
                .checked_mul(count)
                .and_then(|extra| n.checked_add(extra))
        })
        .ok_or("Replacement size overflow")?;
    let history_bytes = size.checked_add(output).ok_or("History size overflow")?;
    let retained: usize = data
        .histories
        .values()
        .filter(|h| h.document_id == request.document_id)
        .map(|h| h.bytes)
        .sum();
    if history_bytes > MAX_HISTORY_BYTES.saturating_sub(retained) {
        return Err("Native replacement history exceeds its 4 GiB budget; save and reopen before continuing".into());
    }
    let dir = PrivateDir::new()?;
    let before_path = dir.0.join("before.utf8");
    let after_path = dir.0.join("after.utf8");
    let mut reader = BufReader::with_capacity(65536, File::open(&search.index.path).map_err(err)?);
    let next = match selected {
        Some(run) => Some(run),
        None => Some(Run::read(&mut reader)?),
    };
    let prepared = Replacement {
        document_id: request.document_id,
        version: request.expected_version,
        insert: request.insert.into_bytes(),
        encoding: store.piece_tree.encoding(),
        before: Some(BufWriter::with_capacity(65536, new_file(&before_path)?)),
        after: Some(BufWriter::with_capacity(65536, new_file(&after_path)?)),
        before_path,
        after_path,
        reader,
        records_left: if selected.is_some() {
            0
        } else {
            search.index.records - 1
        },
        next,
        cursor: 0,
        size,
        prepared: None,
        history_bytes,
        replaced: count,
        _search_dir: search._dir.clone(),
        dir,
    };
    let progress = prepared.progress();
    data.replacements.insert(request.replacement_id, prepared);
    Ok(progress)
}
fn replacement_meta(registry: &NativeSearchRegistry, id: &str) -> Result<(String, usize), String> {
    let data = registry.0.lock().map_err(err)?;
    let r = data
        .replacements
        .get(id)
        .ok_or("Replacement was cancelled")?;
    Ok((r.document_id.clone(), r.version))
}
#[tauri::command]
pub(crate) async fn begin_large_text_replacement(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    request: ReplaceRequest,
) -> Result<ReplaceProgress, String> {
    replacement_begin(&files.0, &searches, request)
}
#[tauri::command]
pub(crate) async fn step_large_text_replacement(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    replacement_id: String,
) -> Result<ReplaceProgress, String> {
    let (doc, version) = replacement_meta(&searches, &replacement_id)?;
    let stores = files.0.lock().map_err(err)?;
    let store = stores.get(&doc).ok_or("Document is closed")?;
    valid_version(store, version)?;
    searches
        .0
        .lock()
        .map_err(err)?
        .replacements
        .get_mut(&replacement_id)
        .ok_or("Replacement cancelled")?
        .step(store)
}
fn replacement_commit(
    files: &Mutex<HashMap<String, LargeFileRegistration>>,
    registry: &NativeSearchRegistry,
    id: &str,
) -> Result<ReplaceResult, String> {
    let (doc, version) = replacement_meta(registry, id)?;
    let mut stores = files.lock().map_err(err)?;
    let store = stores.get_mut(&doc).ok_or("Document is closed")?;
    valid_version(store, version)?;
    let mut data = registry.0.lock().map_err(err)?;
    let mut replacement = data
        .replacements
        .remove(id)
        .ok_or("Replacement cancelled")?;
    let tree = replacement
        .prepared
        .take()
        .ok_or("Replacement preparation is incomplete")?;
    store.piece_tree = tree;
    store.size_bytes = store.piece_tree.byte_len();
    store.version += 1;
    data.histories.insert(
        id.to_string(),
        History {
            document_id: doc.clone(),
            before: replacement.before_path.clone(),
            after: replacement.after_path.clone(),
            encoding: replacement.encoding,
            applied: true,
            bytes: replacement.history_bytes,
            dir: replacement.dir.clone(),
        },
    );
    Ok(ReplaceResult {
        snapshot: large_file_snapshot(&doc, store),
        history_id: id.to_string(),
    })
}
#[tauri::command]
pub(crate) async fn commit_large_text_replacement(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    replacement_id: String,
) -> Result<ReplaceResult, String> {
    replacement_commit(&files.0, &searches, &replacement_id)
}
#[tauri::command]
pub(crate) async fn cancel_large_text_replacement(
    searches: State<'_, NativeSearchRegistry>,
    replacement_id: String,
) -> Result<(), String> {
    searches
        .0
        .lock()
        .map_err(err)?
        .replacements
        .remove(&replacement_id);
    Ok(())
}
fn restore_history(
    files: &Mutex<HashMap<String, LargeFileRegistration>>,
    registry: &NativeSearchRegistry,
    document_id: &str,
    expected_version: usize,
    history_id: &str,
    direction: &str,
) -> Result<LargeFileSnapshotResult, String> {
    let mut stores = files.lock().map_err(err)?;
    let store = stores.get_mut(document_id).ok_or("Document is closed")?;
    valid_version(store, expected_version)?;
    let mut data = registry.0.lock().map_err(err)?;
    let history = data
        .histories
        .get_mut(history_id)
        .ok_or("Native replacement history is unavailable")?;
    if history.document_id != document_id
        || !matches!(direction, "undo" | "redo")
        || history.applied != (direction == "undo")
    {
        return Err("Invalid native replacement history transition".into());
    }
    let path = if direction == "undo" {
        &history.before
    } else {
        &history.after
    };
    let mut tree = PieceTree::open(
        path,
        history
            .dir
            .0
            .join(format!("add-{}.bin", expected_version + 1)),
    )?;
    tree.set_encoding(history.encoding);
    store.piece_tree = tree;
    store.size_bytes = store.piece_tree.byte_len();
    store.version += 1;
    history.applied = !history.applied;
    Ok(large_file_snapshot(document_id, store))
}
#[tauri::command]
pub(crate) async fn restore_large_text_history(
    files: State<'_, LargeFileRegistry>,
    searches: State<'_, NativeSearchRegistry>,
    document_id: String,
    expected_version: usize,
    history_id: String,
    direction: String,
) -> Result<LargeFileSnapshotResult, String> {
    restore_history(
        &files.0,
        &searches,
        &document_id,
        expected_version,
        &history_id,
        &direction,
    )
}
pub(crate) fn close_document(registry: &NativeSearchRegistry, document_id: &str) {
    if let Ok(mut data) = registry.0.lock() {
        data.searches.retain(|_, s| s.document_id != document_id);
        data.replacements
            .retain(|_, s| s.document_id != document_id);
        data.histories.retain(|_, s| s.document_id != document_id);
        data.generations.remove(document_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(
        bytes: &[u8],
    ) -> (
        Arc<PrivateDir>,
        Mutex<HashMap<String, LargeFileRegistration>>,
        NativeSearchRegistry,
    ) {
        let dir = PrivateDir::new().unwrap();
        let path = dir.0.join("original.md");
        fs::write(&path, bytes).unwrap();
        let tree = PieceTree::open(&path, dir.0.join("original-add")).unwrap();
        let store = LargeFileRegistration {
            path: path.to_string_lossy().into(),
            size_bytes: tree.byte_len(),
            piece_tree: tree,
            disk_snapshot_hash: "original".into(),
            version: 0,
            saved_version: 0,
        };
        (
            dir,
            Mutex::new(HashMap::from([("doc".into(), store)])),
            NativeSearchRegistry::default(),
        )
    }
    fn start(
        files: &Mutex<HashMap<String, LargeFileRegistration>>,
        registry: &NativeSearchRegistry,
        query: &str,
        case_sensitive: bool,
        generation: usize,
    ) {
        let version = files.lock().unwrap()["doc"].version;
        begin(
            files,
            registry,
            SearchRequest {
                document_id: "doc".into(),
                expected_version: version,
                search_id: "search".into(),
                generation,
                query: query.into(),
                case_sensitive,
                ascii_fold_safe: true,
            },
        )
        .unwrap();
    }
    fn finish(
        files: &Mutex<HashMap<String, LargeFileRegistration>>,
        registry: &NativeSearchRegistry,
    ) {
        let stores = files.lock().unwrap();
        let mut data = registry.0.lock().unwrap();
        let search = data.searches.get_mut("search").unwrap();
        while !search.complete {
            let progress = search.step(&stores["doc"]).unwrap();
            assert!(progress.fallback.is_none());
        }
    }
    fn prepare(
        files: &Mutex<HashMap<String, LargeFileRegistration>>,
        registry: &NativeSearchRegistry,
        insert: &str,
        selected: Option<usize>,
    ) {
        let version = files.lock().unwrap()["doc"].version;
        replacement_begin(
            files,
            registry,
            ReplaceRequest {
                document_id: "doc".into(),
                expected_version: version,
                search_id: "search".into(),
                replacement_id: "replace".into(),
                insert: insert.into(),
                selected_index: selected,
            },
        )
        .unwrap();
        let stores = files.lock().unwrap();
        let mut data = registry.0.lock().unwrap();
        let prep = data.replacements.get_mut("replace").unwrap();
        while !prep.step(&stores["doc"]).unwrap().ready {}
    }
    fn saved(files: &Mutex<HashMap<String, LargeFileRegistration>>, dir: &PrivateDir) -> Vec<u8> {
        let path = dir.0.join("saved");
        files.lock().unwrap()["doc"]
            .piece_tree
            .write_to(&path)
            .unwrap();
        fs::read(path).unwrap()
    }
    #[test]
    fn complete_dense_search_pages_all_hits_without_materializing_them() {
        let (_dir, files, registry) =
            fixture(format!("{}\r\nlast x", "x".repeat(2 * STEP_BYTES)).as_bytes());
        start(&files, &registry, "x", false, 1);
        finish(&files, &registry);
        let stores = files.lock().unwrap();
        let data = registry.0.lock().unwrap();
        let search = &data.searches["search"];
        assert_eq!(search.index.count, 2 * STEP_BYTES + 1);
        assert_eq!(search.index.records, 2);
        let last = page(&stores["doc"], search, 2 * STEP_BYTES - 2).unwrap();
        assert_eq!(last.matches.len(), 3);
        assert_eq!(last.matches[2].line, 2);
        assert_eq!(last.matches[2].line_offset, 5);
        assert_eq!(last.matches[2].from, 2 * STEP_BYTES + 7);
    }
    #[test]
    fn unicode_fallback_validates_utf16_and_does_not_repeat_payload_on_ack() {
        let (_dir, files, registry) = fixture("😀İ\r\n中文İ\n".as_bytes());
        start(&files, &registry, "i", false, 1);
        let stores = files.lock().unwrap();
        let mut data = registry.0.lock().unwrap();
        let search = data.searches.get_mut("search").unwrap();
        let progress = search.step(&stores["doc"]).unwrap();
        assert_eq!(progress.fallback.unwrap().text, "😀İ\r\n中文İ\n");
        assert!(search
            .append_fallback(&stores["doc"], &[[2, 3, 1, 2]], false)
            .unwrap()
            .fallback
            .is_none());
        assert!(
            search
                .append_fallback(&stores["doc"], &[[7, 8, 2, 2]], true)
                .unwrap()
                .complete
        );
        let results = page(&stores["doc"], search, 0).unwrap();
        assert_eq!(results.matches[0].text, "İ");
        assert_eq!(results.matches[1].from, 7);
    }
    #[test]
    fn unicode_sensitive_batch_boundary_and_empty_query_results() {
        let text = format!("{}\r\n😀中文 hit\r\nend", "a".repeat(STEP_BYTES - 2));
        let (_dir, files, registry) = fixture(text.as_bytes());
        start(&files, &registry, "中文", true, 1);
        finish(&files, &registry);
        {
            let stores = files.lock().unwrap();
            let data = registry.0.lock().unwrap();
            let result = page(&stores["doc"], &data.searches["search"], 0).unwrap();
            assert_eq!(result.matches[0].from, STEP_BYTES + 2);
            assert_eq!(result.matches[0].line_offset, 2);
        }
        start(&files, &registry, "absent", true, 2);
        finish(&files, &registry);
        assert_eq!(registry.0.lock().unwrap().searches["search"].index.count, 0);
    }
    #[test]
    fn stale_queries_and_mutated_documents_never_publish_current_results() {
        let (_dir, files, registry) = fixture(b"abc abc");
        start(&files, &registry, "abc", false, 2);
        assert!(begin(
            &files,
            &registry,
            SearchRequest {
                document_id: "doc".into(),
                expected_version: 0,
                search_id: "old".into(),
                generation: 1,
                query: "abc".into(),
                case_sensitive: false,
                ascii_fold_safe: true
            }
        )
        .unwrap_err()
        .contains("superseded"));
        files.lock().unwrap().get_mut("doc").unwrap().version = 1;
        let stores = files.lock().unwrap();
        assert!(registry
            .0
            .lock()
            .unwrap()
            .searches
            .get_mut("search")
            .unwrap()
            .step(&stores["doc"])
            .unwrap_err()
            .contains("changed"));
    }
    #[test]
    fn replace_all_and_whole_history_preserve_utf16_encoding_and_crlf_disk_bytes() {
        let original = "😀 foo\r\nfoo 中文 foo";
        let bytes: Vec<u8> = [
            vec![0xff, 0xfe],
            original.encode_utf16().flat_map(u16::to_le_bytes).collect(),
        ]
        .concat();
        let (dir, files, registry) = fixture(&bytes);
        start(&files, &registry, "foo", true, 1);
        finish(&files, &registry);
        prepare(&files, &registry, "新😀", None);
        assert_eq!(fs::read(dir.0.join("original.md")).unwrap(), bytes);
        assert_eq!(saved(&files, &dir), bytes);
        let result = replacement_commit(&files, &registry, "replace").unwrap();
        assert_eq!(result.snapshot.version, 1);
        let expected: Vec<u8> = [
            vec![0xff, 0xfe],
            original
                .replace("foo", "新😀")
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect(),
        ]
        .concat();
        assert_eq!(saved(&files, &dir), expected);
        restore_history(&files, &registry, "doc", 1, "replace", "undo").unwrap();
        assert_eq!(saved(&files, &dir), bytes);
        restore_history(&files, &registry, "doc", 2, "replace", "redo").unwrap();
        assert_eq!(saved(&files, &dir), expected);
        assert!(restore_history(&files, &registry, "doc", 3, "replace", "redo").is_err());
    }
    #[test]
    fn selected_dense_member_and_empty_replacement_preserve_surrounding_text() {
        let (dir, files, registry) = fixture(b"xxxx\nxxx");
        start(&files, &registry, "x", false, 1);
        finish(&files, &registry);
        prepare(&files, &registry, "", Some(2));
        replacement_commit(&files, &registry, "replace").unwrap();
        assert_eq!(saved(&files, &dir), b"xxx\nxxx");
    }
    #[test]
    fn preparation_cancel_and_stale_commit_leave_document_unchanged() {
        let (dir, files, registry) = fixture(b"foo foo");
        start(&files, &registry, "foo", false, 1);
        finish(&files, &registry);
        prepare(&files, &registry, "bar", None);
        registry.0.lock().unwrap().replacements.remove("replace");
        assert!(replacement_commit(&files, &registry, "replace").is_err());
        assert_eq!(saved(&files, &dir), b"foo foo");
        prepare(&files, &registry, "bar", None);
        files.lock().unwrap().get_mut("doc").unwrap().version = 1;
        assert!(replacement_commit(&files, &registry, "replace").is_err());
        assert_eq!(saved(&files, &dir), b"foo foo");
    }
    #[test]
    fn oversized_line_fails_explicitly_and_close_removes_private_artifacts() {
        let (_dir, files, registry) = fixture("x".repeat(MAX_LINE_BYTES + 1).as_bytes());
        start(&files, &registry, "x", false, 1);
        let private = registry.0.lock().unwrap().searches["search"]._dir.0.clone();
        {
            let stores = files.lock().unwrap();
            let mut data = registry.0.lock().unwrap();
            let search = data.searches.get_mut("search").unwrap();
            assert!(search
                .step(&stores["doc"])
                .unwrap_err()
                .contains("incomplete"));
            assert!(!search.complete);
        }
        close_document(&registry, "doc");
        assert!(!private.exists());
    }
    #[test]
    fn disk_budget_and_preparation_io_failure_do_not_mutate_the_document() {
        let (dir, files, registry) = fixture(&vec![b'x'; 8192]);
        start(&files, &registry, "x", false, 1);
        finish(&files, &registry);
        let result = replacement_begin(
            &files,
            &registry,
            ReplaceRequest {
                document_id: "doc".into(),
                expected_version: 0,
                search_id: "search".into(),
                replacement_id: "too-big".into(),
                insert: "a".repeat(STEP_BYTES),
                selected_index: None,
            },
        );
        assert!(result.err().unwrap().contains("4 GiB"));
        assert_eq!(saved(&files, &dir), vec![b'x'; 8192]);
        replacement_begin(
            &files,
            &registry,
            ReplaceRequest {
                document_id: "doc".into(),
                expected_version: 0,
                search_id: "search".into(),
                replacement_id: "io-fail".into(),
                insert: "z".into(),
                selected_index: None,
            },
        )
        .unwrap();
        {
            let stores = files.lock().unwrap();
            let mut data = registry.0.lock().unwrap();
            let prep = data.replacements.get_mut("io-fail").unwrap();
            // The prepared output becomes unavailable before it can be indexed.
            prep.after.take();
            fs::remove_file(&prep.after_path).unwrap();
            assert!(prep.step(&stores["doc"]).is_err());
            assert!(prep.prepared.is_none());
        }
        assert!(replacement_commit(&files, &registry, "io-fail").is_err());
        assert_eq!(saved(&files, &dir), vec![b'x'; 8192]);
    }
    #[test]
    fn cancellation_and_document_close_release_preparations_indexes_and_history() {
        let (_dir, files, registry) = fixture(b"foo foo");
        start(&files, &registry, "foo", false, 1);
        finish(&files, &registry);
        prepare(&files, &registry, "bar", None);
        let cancelled = registry.0.lock().unwrap().replacements["replace"]
            .dir
            .0
            .clone();
        registry.0.lock().unwrap().replacements.remove("replace");
        assert!(!cancelled.exists());
        prepare(&files, &registry, "bar", None);
        replacement_commit(&files, &registry, "replace").unwrap();
        let (index, history) = {
            let data = registry.0.lock().unwrap();
            (
                data.searches["search"]._dir.0.clone(),
                data.histories["replace"].dir.0.clone(),
            )
        };
        assert!(history.join("before.utf8").exists());
        assert!(history.join("after.utf8").exists());
        files.lock().unwrap().clear();
        close_document(&registry, "doc");
        assert!(!index.exists());
        assert!(!history.exists());
        let data = registry.0.lock().unwrap();
        assert!(
            data.searches.is_empty()
                && data.histories.is_empty()
                && data.replacements.is_empty()
                && data.generations.is_empty()
        );
    }
    #[test]
    fn replacement_undo_restores_unsaved_piece_tree_edits_not_the_original_file() {
        let (dir, files, registry) = fixture(b"foo tail");
        {
            let mut stores = files.lock().unwrap();
            let store = stores.get_mut("doc").unwrap();
            store
                .piece_tree
                .apply_batch(&[(4, 8, "foo".into())])
                .unwrap();
            store.version = 1;
        }
        start(&files, &registry, "foo", false, 1);
        finish(&files, &registry);
        prepare(&files, &registry, "bar", None);
        replacement_commit(&files, &registry, "replace").unwrap();
        assert_eq!(saved(&files, &dir), b"bar bar");
        restore_history(&files, &registry, "doc", 2, "replace", "undo").unwrap();
        assert_eq!(saved(&files, &dir), b"foo foo");
        assert_eq!(fs::read(dir.0.join("original.md")).unwrap(), b"foo tail");
    }
}

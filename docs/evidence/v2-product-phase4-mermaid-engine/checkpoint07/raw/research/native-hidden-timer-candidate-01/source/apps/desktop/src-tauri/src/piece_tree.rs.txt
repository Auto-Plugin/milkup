use std::cell::RefCell;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const PIECE_BYTES: usize = 64 * 1024;
// Bound descriptor capture as well as the streaming buffer; never copy document text.
const MAX_SNAPSHOT_PIECES: usize = 65_536;

pub(crate) struct WorkingDirectory(pub(crate) PathBuf);
impl Drop for WorkingDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
struct WorkingFile(PathBuf, Option<Arc<WorkingDirectory>>);
impl Drop for WorkingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(crate) struct PieceSnapshot {
    // Independent opens, not try_clone: seek cursors must not race editor reads.
    base: File,
    add: File,
    _base_lifetime: Arc<WorkingFile>,
    _add_lifetime: Arc<WorkingFile>,
    pieces: Vec<Piece>,
    encoding: BaseEncoding,
}
impl PieceSnapshot {
    pub(crate) fn write_to(&mut self, path: &Path) -> Result<(), String> {
        self.write_with_progress(path, || Ok(()))
    }
    fn write_with_progress(
        &mut self,
        path: &Path,
        mut progress: impl FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        let mut output = BufWriter::with_capacity(PIECE_BYTES, file);
        match self.encoding {
            BaseEncoding::Utf8 => {}
            BaseEncoding::Utf16Le => output.write_all(&[0xff, 0xfe]).map_err(|e| e.to_string())?,
            BaseEncoding::Utf16Be => output.write_all(&[0xfe, 0xff]).map_err(|e| e.to_string())?,
        }
        let mut buffer = vec![0; PIECE_BYTES + 3];
        for piece in &self.pieces {
            let file = match piece.source {
                Source::Base => &mut self.base,
                Source::Add => &mut self.add,
            };
            let bytes = &mut buffer[..piece.byte_len as usize];
            file.seek(SeekFrom::Start(piece.byte_start))
                .map_err(|e| e.to_string())?;
            file.read_exact(bytes).map_err(|e| e.to_string())?;
            match self.encoding {
                BaseEncoding::Utf8 => output.write_all(bytes).map_err(|e| e.to_string())?,
                BaseEncoding::Utf16Le | BaseEncoding::Utf16Be => {
                    for unit in std::str::from_utf8(bytes)
                        .map_err(|e| e.to_string())?
                        .encode_utf16()
                    {
                        let bytes = if self.encoding == BaseEncoding::Utf16Le {
                            unit.to_le_bytes()
                        } else {
                            unit.to_be_bytes()
                        };
                        output.write_all(&bytes).map_err(|e| e.to_string())?;
                    }
                }
            }
            progress()?;
        }
        output.flush().map_err(|e| e.to_string())?;
        output.get_ref().sync_all().map_err(|e| e.to_string())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Source {
    Base,
    Add,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BaseEncoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Piece {
    source: Source,
    byte_start: u64,
    byte_len: u64,
    utf16_len: u64,
    newline_count: u64,
}

type Link = Option<Box<Node>>;

#[derive(Clone)]
struct Node {
    piece: Piece,
    priority: u64,
    left: Link,
    right: Link,
    byte_len: u64,
    utf16_len: u64,
    newline_count: u64,
}

impl Node {
    fn new(piece: Piece, priority: u64) -> Box<Self> {
        let mut node = Box::new(Self {
            piece,
            priority,
            left: None,
            right: None,
            byte_len: 0,
            utf16_len: 0,
            newline_count: 0,
        });
        refresh(&mut node);
        node
    }
}

pub(crate) struct PieceTree {
    base: Option<RefCell<File>>,
    base_path: PathBuf,
    base_encoding: BaseEncoding,
    normalized_base_path: Option<PathBuf>,
    base_lifetime: Option<Arc<WorkingFile>>,
    add_lifetime: Arc<WorkingFile>,
    pub(crate) add_path: PathBuf,
    add: Option<RefCell<File>>,
    root: Link,
    next_priority: u64,
}

impl PieceTree {
    pub(crate) fn open(base_path: &Path, add_path: PathBuf) -> Result<Self, String> {
        Self::open_from_file(
            base_path,
            File::open(base_path).map_err(|error| error.to_string())?,
            add_path,
        )
    }

    /// Workspace callers supply a verified descriptor and a private staging path.
    pub(crate) fn open_from_file(
        base_path: &Path,
        file: File,
        add_path: PathBuf,
    ) -> Result<Self, String> {
        Self::open_from_file_with_progress(base_path, file, add_path, || Ok(()))
    }

    pub(crate) fn open_from_file_with_progress(
        base_path: &Path,
        mut file: File,
        add_path: PathBuf,
        mut progress: impl FnMut() -> Result<(), String>,
    ) -> Result<Self, String> {
        let (indexed_path, base_encoding, normalized_base_path) =
            prepare_base_from_file(base_path, &mut file, &mut progress)?;
        let base_lifetime = normalized_base_path
            .clone()
            .map(|p| Arc::new(WorkingFile(p, None)));
        let base = open_immutable_base(&indexed_path)?;
        let add = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&add_path)
            .map_err(|error| error.to_string())?;
        let mut tree = Self {
            base: Some(RefCell::new(base)),
            base_path: indexed_path,
            base_encoding,
            base_lifetime,
            add_lifetime: Arc::new(WorkingFile(add_path.clone(), None)),
            normalized_base_path,
            add_path,
            add: Some(RefCell::new(add)),
            root: None,
            next_priority: 1,
        };
        tree.rebuild_base_index_with_progress(&mut progress)?;
        Ok(tree)
    }

    pub(crate) fn retain_working_directory(&mut self, directory: Arc<WorkingDirectory>) {
        if let Some(base) = self.base_lifetime.as_mut().and_then(Arc::get_mut) {
            base.1 = Some(directory.clone());
        }
        if let Some(add) = Arc::get_mut(&mut self.add_lifetime) {
            add.1 = Some(directory);
        }
    }

    pub(crate) fn encoding(&self) -> BaseEncoding {
        self.base_encoding
    }

    pub(crate) fn set_encoding(&mut self, encoding: BaseEncoding) {
        self.base_encoding = encoding;
    }

    pub(crate) fn byte_len(&self) -> usize {
        bytes(&self.root) as usize
    }

    pub(crate) fn utf16_len(&self) -> usize {
        utf16s(&self.root) as usize
    }

    pub(crate) fn line_count(&self) -> usize {
        newlines(&self.root) as usize + 1
    }

    pub(crate) fn read_range(&self, from: usize, to: usize) -> Result<String, String> {
        String::from_utf8(self.read_range_bytes(from, to)?).map_err(|error| error.to_string())
    }

    pub(crate) fn read_range_bytes(&self, from: usize, to: usize) -> Result<Vec<u8>, String> {
        if from > to || to > self.byte_len() {
            return Err(format!(
                "Invalid byte range: {from}-{to} for {} bytes",
                self.byte_len()
            ));
        }
        let mut output = Vec::with_capacity(to - from);
        self.read_node_range(self.root.as_deref(), 0, from as u64, to as u64, &mut output)?;
        Ok(output)
    }

    pub(crate) fn byte_to_utf16(&self, byte_offset: usize) -> Result<usize, String> {
        if byte_offset > self.byte_len() {
            return Err(format!("Invalid byte offset: {byte_offset}"));
        }
        let mut node = self.root.as_deref();
        let mut remaining = byte_offset as u64;
        let mut result = 0_u64;
        while let Some(current) = node {
            let left_bytes = bytes(&current.left);
            if remaining < left_bytes {
                node = current.left.as_deref();
            } else if remaining > left_bytes + current.piece.byte_len {
                remaining -= left_bytes + current.piece.byte_len;
                result += utf16s(&current.left) + current.piece.utf16_len;
                node = current.right.as_deref();
            } else {
                result += utf16s(&current.left);
                let local = (remaining - left_bytes) as usize;
                let bytes = self.read_piece_bytes(&current.piece, 0, local)?;
                let valid_prefix = utf8_prefix_len(&bytes);
                if valid_prefix != local {
                    return Err(format!(
                        "Byte offset {byte_offset} is not on a UTF-8 character boundary"
                    ));
                }
                let text = std::str::from_utf8(&bytes).map_err(|error| error.to_string())?;
                result += text.encode_utf16().count() as u64;
                return Ok(result as usize);
            }
        }
        Ok(result as usize)
    }

    pub(crate) fn utf16_to_byte(&self, utf16_offset: usize) -> Result<usize, String> {
        if utf16_offset > self.utf16_len() {
            return Err(format!(
                "UTF-16 offset {utf16_offset} exceeds document length {}",
                self.utf16_len()
            ));
        }
        self.utf16_to_byte_in_root(utf16_offset as u64)
            .map(|value| value as usize)
    }

    pub(crate) fn line_start_byte(&self, line: usize) -> Result<usize, String> {
        if line == 0 || line > self.line_count() {
            return Err(format!(
                "Invalid line: {line} for {} lines",
                self.line_count()
            ));
        }
        if line == 1 {
            return Ok(0);
        }
        self.byte_after_newline((line - 1) as u64)
            .map(|value| value as usize)
    }

    pub(crate) fn line_content_end_byte(&self, line: usize) -> Result<usize, String> {
        let raw_end = if line < self.line_count() {
            self.line_start_byte(line + 1)? - 1
        } else {
            self.byte_len()
        };
        if raw_end > 0 && self.read_range_bytes(raw_end - 1, raw_end)?.as_slice() == b"\r" {
            Ok(raw_end - 1)
        } else {
            Ok(raw_end)
        }
    }

    pub(crate) fn apply_batch(&mut self, changes: &[(usize, usize, String)]) -> Result<(), String> {
        let mut resolved = Vec::with_capacity(changes.len());
        for (from, to, insert) in changes {
            if from > to {
                return Err(format!("Invalid UTF-16 change range: {from}-{to}"));
            }
            resolved.push((
                self.utf16_to_byte(*from)?,
                self.utf16_to_byte(*to)?,
                *from,
                *to,
                insert.clone(),
            ));
        }
        resolved.sort_by_key(|(_, _, from, to, _)| (*from, *to));
        let mut cursor = 0;
        for (_, _, from, to, _) in &resolved {
            if *from < cursor {
                return Err("Large text file changes must not overlap".to_string());
            }
            cursor = *to;
        }

        for (from_byte, to_byte, _, _, insert) in resolved.into_iter().rev() {
            self.splice_bytes(from_byte, to_byte, &insert)?;
        }
        Ok(())
    }

    pub(crate) fn saved_byte_len(&self) -> u64 {
        match self.base_encoding {
            BaseEncoding::Utf8 => self.byte_len() as u64,
            BaseEncoding::Utf16Le | BaseEncoding::Utf16Be => 2 + 2 * self.utf16_len() as u64,
        }
    }

    pub(crate) fn write_to(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let file = File::create(path).map_err(|error| error.to_string())?;
        let mut output = BufWriter::with_capacity(PIECE_BYTES, file);
        match self.base_encoding {
            BaseEncoding::Utf8 => {}
            BaseEncoding::Utf16Le => output
                .write_all(&[0xff, 0xfe])
                .map_err(|error| error.to_string())?,
            BaseEncoding::Utf16Be => output
                .write_all(&[0xfe, 0xff])
                .map_err(|error| error.to_string())?,
        }
        let pieces = collect_pieces(&self.root);
        for piece in pieces {
            let bytes = self.read_piece_bytes(&piece, 0, piece.byte_len as usize)?;
            match self.base_encoding {
                BaseEncoding::Utf8 => output
                    .write_all(&bytes)
                    .map_err(|error| error.to_string())?,
                BaseEncoding::Utf16Le | BaseEncoding::Utf16Be => {
                    let text = std::str::from_utf8(&bytes).map_err(|error| error.to_string())?;
                    for unit in text.encode_utf16() {
                        let encoded = match self.base_encoding {
                            BaseEncoding::Utf16Le => unit.to_le_bytes(),
                            BaseEncoding::Utf16Be => unit.to_be_bytes(),
                            BaseEncoding::Utf8 => unreachable!(),
                        };
                        output
                            .write_all(&encoded)
                            .map_err(|error| error.to_string())?;
                    }
                }
            }
        }
        output.flush().map_err(|error| error.to_string())?;
        output
            .get_ref()
            .sync_all()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn snapshot(&self) -> Result<PieceSnapshot, String> {
        fn collect(node: Option<&Node>, pieces: &mut Vec<Piece>) -> Result<(), String> {
            if let Some(node) = node {
                collect(node.left.as_deref(), pieces)?;
                if pieces.len() == MAX_SNAPSHOT_PIECES
                    || node.piece.byte_len > (PIECE_BYTES + 3) as u64
                {
                    return Err("恢复分片描述超过有界预算；已有恢复点保留".into());
                }
                pieces.push(node.piece.clone());
                collect(node.right.as_deref(), pieces)?;
            }
            Ok(())
        }
        if self.base.is_none() || self.add.is_none() {
            return Err("Document working files are closed".into());
        }
        let mut pieces = Vec::new();
        collect(self.root.as_deref(), &mut pieces)?;
        Ok(PieceSnapshot {
            base: open_immutable_base(&self.base_path)?,
            add: File::open(&self.add_path).map_err(|e| e.to_string())?,
            _base_lifetime: self
                .base_lifetime
                .as_ref()
                .ok_or("Missing base lifetime")?
                .clone(),
            _add_lifetime: self.add_lifetime.clone(),
            pieces,
            encoding: self.base_encoding,
        })
    }

    pub(crate) fn rebase(&mut self, path: &Path) -> Result<(), String> {
        let (indexed_path, base_encoding, normalized_base_path) = prepare_base(path)?;
        let next_lifetime = normalized_base_path
            .clone()
            .map(|p| Arc::new(WorkingFile(p, None)));
        let next_base = open_immutable_base(&indexed_path)?;
        let next_add = if Arc::strong_count(&self.add_lifetime) > 1 {
            // Allocate before changing the live tree: failure must leave its sources intact.
            let next_path = session_base_path(path)?.with_extension("add.work");
            let next = OpenOptions::new()
                .create_new(true)
                .read(true)
                .write(true)
                .open(&next_path)
                .map_err(|e| e.to_string())?;
            Some((next_path, next))
        } else {
            None
        };
        self.base = Some(RefCell::new(next_base));
        self.base_lifetime = next_lifetime;
        self.base_path = indexed_path;
        self.base_encoding = base_encoding;
        self.normalized_base_path = normalized_base_path;
        if let Some((next_path, next)) = next_add {
            // A recovery writer owns the old append-only generation; never truncate it.
            self.add = Some(RefCell::new(next));
            self.add_lifetime = Arc::new(WorkingFile(next_path.clone(), None));
            self.add_path = next_path;
        } else {
            let add = self
                .add
                .as_mut()
                .ok_or("Large file add buffer is unavailable")?
                .get_mut();
            add.set_len(0).map_err(|e| e.to_string())?;
            add.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        }
        self.rebuild_base_index()
    }

    pub(crate) fn release_base_handle(&mut self) {
        self.base = None
    }

    pub(crate) fn close(&mut self) -> Result<(), String> {
        self.base = None;
        self.add = None;
        if Arc::strong_count(&self.add_lifetime) == 1 {
            remove_working_file(&self.add_path)?;
        }
        if let Some(path) = self.normalized_base_path.as_ref() {
            if self
                .base_lifetime
                .as_ref()
                .is_some_and(|p| Arc::strong_count(p) == 1)
            {
                remove_working_file(path)?;
            }
        }
        self.normalized_base_path = None;
        self.base_lifetime = None;
        Ok(())
    }

    pub(crate) fn restore_base_handle(&mut self) -> Result<(), String> {
        self.base = Some(RefCell::new(open_immutable_base(&self.base_path)?));
        Ok(())
    }

    fn rebuild_base_index(&mut self) -> Result<(), String> {
        self.rebuild_base_index_with_progress(&mut || Ok(()))
    }

    fn rebuild_base_index_with_progress(
        &mut self,
        progress: &mut impl FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        self.root = None;
        self.next_priority = 1;
        self.base
            .as_mut()
            .ok_or_else(|| "Large file base handle is unavailable".to_string())?
            .get_mut()
            .seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(
            self.base
                .as_mut()
                .ok_or_else(|| "Large file base handle is unavailable".to_string())?
                .get_mut()
                .try_clone()
                .map_err(|error| error.to_string())?,
        );
        let mut carry = Vec::new();
        let mut source_offset = 0_u64;
        loop {
            progress()?;
            let mut chunk = vec![0_u8; PIECE_BYTES];
            let read = reader.read(&mut chunk).map_err(|error| error.to_string())?;
            chunk.truncate(read);
            carry.extend_from_slice(&chunk);
            if read == 0 {
                if !carry.is_empty() {
                    let text = std::str::from_utf8(&carry).map_err(unsupported_text_encoding)?;
                    self.push_base_piece(source_offset, text);
                }
                break;
            }
            let split = utf8_prefix_len(&carry);
            if split == 0 {
                continue;
            }
            let tail = carry.split_off(split);
            let text = std::str::from_utf8(&carry).map_err(unsupported_text_encoding)?;
            self.push_base_piece(source_offset, text);
            source_offset += split as u64;
            carry = tail;
        }
        Ok(())
    }

    fn push_base_piece(&mut self, offset: u64, text: &str) {
        let piece = metadata(Source::Base, offset, text);
        let priority = self.priority();
        self.root = merge(self.root.take(), Some(Node::new(piece, priority)));
    }

    fn splice_bytes(&mut self, from: usize, to: usize, insert: &str) -> Result<(), String> {
        let root = self.root.take();
        let (left, tail) = self.split_bytes(root, from as u64)?;
        let (removed, right) = self.split_bytes(tail, (to - from) as u64)?;
        drop(removed);
        let inserted = self.append_insert(insert)?;
        self.root = merge(merge(left, inserted), right);
        Ok(())
    }

    fn append_insert(&mut self, text: &str) -> Result<Link, String> {
        if text.is_empty() {
            return Ok(None);
        }
        let start = self
            .add
            .as_mut()
            .ok_or_else(|| "Large file add buffer is unavailable".to_string())?
            .get_mut()
            .seek(SeekFrom::End(0))
            .map_err(|error| error.to_string())?;
        self.add
            .as_mut()
            .ok_or_else(|| "Large file add buffer is unavailable".to_string())?
            .get_mut()
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        let mut root = None;
        let mut local = 0;
        while local < text.len() {
            let mut end = (local + PIECE_BYTES).min(text.len());
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let piece = metadata(Source::Add, start + local as u64, &text[local..end]);
            let priority = self.priority();
            root = merge(root, Some(Node::new(piece, priority)));
            local = end;
        }
        Ok(root)
    }

    fn split_bytes(&mut self, root: Link, at: u64) -> Result<(Link, Link), String> {
        let Some(mut node) = root else {
            return Ok((None, None));
        };
        let left_len = bytes(&node.left);
        if at < left_len {
            let (left, right) = self.split_bytes(node.left.take(), at)?;
            node.left = right;
            refresh(&mut node);
            return Ok((left, Some(node)));
        }
        let piece_end = left_len + node.piece.byte_len;
        if at > piece_end {
            let (left, right) = self.split_bytes(node.right.take(), at - piece_end)?;
            node.right = left;
            refresh(&mut node);
            return Ok((Some(node), right));
        }
        if at == left_len {
            let left = node.left.take();
            refresh(&mut node);
            return Ok((left, Some(node)));
        }
        if at == piece_end {
            let right = node.right.take();
            refresh(&mut node);
            return Ok((Some(node), right));
        }
        let local_byte = (at - left_len) as usize;
        let text = self.read_piece(&node.piece, 0, node.piece.byte_len as usize)?;
        if !text.is_char_boundary(local_byte) {
            return Err(format!(
                "Byte offset {at} is not on a UTF-8 character boundary"
            ));
        }
        let left_piece = metadata(
            node.piece.source,
            node.piece.byte_start,
            &text[..local_byte],
        );
        let right_piece = metadata(
            node.piece.source,
            node.piece.byte_start + local_byte as u64,
            &text[local_byte..],
        );
        let left_priority = self.priority();
        let right_priority = self.priority();
        Ok((
            merge(node.left.take(), Some(Node::new(left_piece, left_priority))),
            merge(
                Some(Node::new(right_piece, right_priority)),
                node.right.take(),
            ),
        ))
    }

    fn utf16_to_byte_in_root(&self, offset: u64) -> Result<u64, String> {
        let mut node = self.root.as_deref();
        let mut remaining = offset;
        let mut bytes_before = 0_u64;
        while let Some(current) = node {
            let left_utf16 = utf16s(&current.left);
            if remaining < left_utf16 {
                node = current.left.as_deref();
            } else if remaining > left_utf16 + current.piece.utf16_len {
                remaining -= left_utf16 + current.piece.utf16_len;
                bytes_before += bytes(&current.left) + current.piece.byte_len;
                node = current.right.as_deref();
            } else {
                bytes_before += bytes(&current.left);
                let text = self.read_piece(&current.piece, 0, current.piece.byte_len as usize)?;
                return Ok(
                    bytes_before + utf16_to_byte(&text, (remaining - left_utf16) as usize)? as u64
                );
            }
        }
        Ok(bytes_before)
    }

    fn byte_after_newline(&self, target: u64) -> Result<u64, String> {
        let mut node = self.root.as_deref();
        let mut remaining = target;
        let mut bytes_before = 0_u64;
        while let Some(current) = node {
            let left_newlines = newlines(&current.left);
            if remaining <= left_newlines {
                node = current.left.as_deref();
                continue;
            }
            remaining -= left_newlines;
            bytes_before += bytes(&current.left);
            if remaining <= current.piece.newline_count {
                let data =
                    self.read_piece_bytes(&current.piece, 0, current.piece.byte_len as usize)?;
                let mut seen = 0;
                for (index, byte) in data.iter().enumerate() {
                    if *byte == b'\n' {
                        seen += 1;
                        if seen == remaining {
                            return Ok(bytes_before + index as u64 + 1);
                        }
                    }
                }
            }
            remaining -= current.piece.newline_count;
            bytes_before += current.piece.byte_len;
            node = current.right.as_deref();
        }
        Err(format!("Newline {target} was not found"))
    }

    fn read_node_range(
        &self,
        node: Option<&Node>,
        node_start: u64,
        from: u64,
        to: u64,
        output: &mut Vec<u8>,
    ) -> Result<(), String> {
        let Some(node) = node else {
            return Ok(());
        };
        let left_len = bytes(&node.left);
        let piece_start = node_start + left_len;
        let piece_end = piece_start + node.piece.byte_len;
        if from < piece_start {
            self.read_node_range(node.left.as_deref(), node_start, from, to, output)?;
        }
        let overlap_start = from.max(piece_start);
        let overlap_end = to.min(piece_end);
        if overlap_start < overlap_end {
            output.extend(self.read_piece_bytes(
                &node.piece,
                (overlap_start - piece_start) as usize,
                (overlap_end - piece_start) as usize,
            )?);
        }
        if to > piece_end {
            self.read_node_range(node.right.as_deref(), piece_end, from, to, output)?;
        }
        Ok(())
    }

    fn read_piece(&self, piece: &Piece, from: usize, to: usize) -> Result<String, String> {
        String::from_utf8(self.read_piece_bytes(piece, from, to)?)
            .map_err(|error| error.to_string())
    }

    fn read_piece_bytes(&self, piece: &Piece, from: usize, to: usize) -> Result<Vec<u8>, String> {
        let mut file = match piece.source {
            Source::Base => self
                .base
                .as_ref()
                .ok_or_else(|| "Large file base handle is unavailable".to_string())?
                .borrow_mut(),
            Source::Add => self
                .add
                .as_ref()
                .ok_or_else(|| "Large file add buffer is unavailable".to_string())?
                .borrow_mut(),
        };
        file.seek(SeekFrom::Start(piece.byte_start + from as u64))
            .map_err(|error| error.to_string())?;
        let mut data = vec![0; to - from];
        file.read_exact(&mut data)
            .map_err(|error| error.to_string())?;
        Ok(data)
    }

    fn priority(&mut self) -> u64 {
        let mut value = self.next_priority;
        self.next_priority += 1;
        value = value.wrapping_add(0x9e3779b97f4a7c15);
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        value ^ (value >> 31)
    }
}

impl Drop for PieceTree {
    fn drop(&mut self) {
        self.base = None;
        self.add = None;
        // WorkingFile leases clean up only after every snapshot closes its handles.
        self.base_lifetime = None;
    }
}

fn remove_working_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn prepare_base(path: &Path) -> Result<(PathBuf, BaseEncoding, Option<PathBuf>), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    prepare_base_from_file(path, &mut file, &mut || Ok(()))
}

fn prepare_base_from_file(
    path: &Path,
    file: &mut File,
    progress: &mut impl FnMut() -> Result<(), String>,
) -> Result<(PathBuf, BaseEncoding, Option<PathBuf>), String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut prefix = [0_u8; 2];
    let read = file.read(&mut prefix).map_err(|error| error.to_string())?;
    let Some(encoding) = detect_utf16_encoding(&prefix[..read]) else {
        let session_base = session_base_path(path)?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        let mut target = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&session_base)
            .map_err(|error| error.to_string())?;
        let copied = copy_with_progress(file, &mut target, progress);
        drop(target);
        if let Err(error) = copied {
            let _ = fs::remove_file(&session_base);
            return Err(error);
        }
        return Ok((session_base.clone(), BaseEncoding::Utf8, Some(session_base)));
    };

    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    copy_with_progress(file, &mut bytes, progress)?;
    let text = decode_utf16(&bytes, encoding)?;
    progress()?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let normalized = session_base_path_with_nonce(path, nonce)?;
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&normalized)
        .map_err(|error| error.to_string())?;
    let copied = copy_with_progress(&mut text.as_bytes(), &mut target, progress);
    drop(target);
    if let Err(error) = copied {
        let _ = fs::remove_file(&normalized);
        return Err(error);
    }
    Ok((normalized.clone(), encoding, Some(normalized)))
}

fn copy_with_progress(
    reader: &mut impl Read,
    writer: &mut impl Write,
    progress: &mut impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let mut buffer = [0; PIECE_BYTES];
    loop {
        progress()?;
        let count = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Ok(());
        }
        writer
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
    }
}

fn session_base_path(path: &Path) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    session_base_path_with_nonce(path, nonce)
}

fn session_base_path_with_nonce(path: &Path, nonce: u128) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    Ok(path.with_file_name(format!(
        ".{file_name}.milkup-large.{}.{}.base.work",
        std::process::id(),
        nonce
    )))
}

fn detect_utf16_encoding(bytes: &[u8]) -> Option<BaseEncoding> {
    match bytes.get(0..2) {
        Some([0xff, 0xfe]) => Some(BaseEncoding::Utf16Le),
        Some([0xfe, 0xff]) => Some(BaseEncoding::Utf16Be),
        _ => None,
    }
}

fn decode_utf16(bytes: &[u8], encoding: BaseEncoding) -> Result<String, String> {
    let payload = &bytes[2..];
    if payload.len() % 2 != 0 {
        return Err("UTF-16 file has an odd number of bytes".to_string());
    }
    let units = payload
        .chunks_exact(2)
        .map(|chunk| match encoding {
            BaseEncoding::Utf16Le => u16::from_le_bytes([chunk[0], chunk[1]]),
            BaseEncoding::Utf16Be => u16::from_be_bytes([chunk[0], chunk[1]]),
            BaseEncoding::Utf8 => unreachable!(),
        })
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|error| error.to_string())
}

fn unsupported_text_encoding(_: std::str::Utf8Error) -> String {
    "Unsupported text encoding; use UTF-8 or UTF-16 with a byte-order mark".to_string()
}

fn metadata(source: Source, byte_start: u64, text: &str) -> Piece {
    Piece {
        source,
        byte_start,
        byte_len: text.len() as u64,
        utf16_len: text.encode_utf16().count() as u64,
        newline_count: text.bytes().filter(|byte| *byte == b'\n').count() as u64,
    }
}

fn bytes(link: &Link) -> u64 {
    link.as_ref().map_or(0, |node| node.byte_len)
}
fn utf16s(link: &Link) -> u64 {
    link.as_ref().map_or(0, |node| node.utf16_len)
}
fn newlines(link: &Link) -> u64 {
    link.as_ref().map_or(0, |node| node.newline_count)
}

fn refresh(node: &mut Node) {
    node.byte_len = bytes(&node.left) + node.piece.byte_len + bytes(&node.right);
    node.utf16_len = utf16s(&node.left) + node.piece.utf16_len + utf16s(&node.right);
    node.newline_count = newlines(&node.left) + node.piece.newline_count + newlines(&node.right);
}

fn merge(left: Link, right: Link) -> Link {
    match (left, right) {
        (None, right) => right,
        (left, None) => left,
        (Some(mut left), Some(mut right)) => {
            if left.priority >= right.priority {
                left.right = merge(left.right.take(), Some(right));
                refresh(&mut left);
                Some(left)
            } else {
                right.left = merge(Some(left), right.left.take());
                refresh(&mut right);
                Some(right)
            }
        }
    }
}

fn collect_pieces(root: &Link) -> Vec<Piece> {
    fn walk(node: Option<&Node>, output: &mut Vec<Piece>) {
        if let Some(node) = node {
            walk(node.left.as_deref(), output);
            output.push(node.piece.clone());
            walk(node.right.as_deref(), output);
        }
    }
    let mut output = Vec::new();
    walk(root.as_deref(), &mut output);
    output
}

fn utf16_to_byte(text: &str, offset: usize) -> Result<usize, String> {
    let mut utf16 = 0;
    for (byte, character) in text.char_indices() {
        if utf16 == offset {
            return Ok(byte);
        }
        let next = utf16 + character.len_utf16();
        if offset < next {
            return Err(format!(
                "UTF-16 offset {offset} does not align to a Unicode scalar boundary"
            ));
        }
        utf16 = next;
    }
    if utf16 == offset {
        Ok(text.len())
    } else {
        Err(format!(
            "UTF-16 offset {offset} exceeds piece length {utf16}"
        ))
    }
}

fn utf8_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(error) => error.valid_up_to(),
    }
}

#[cfg(windows)]
fn open_immutable_base(path: &Path) -> Result<File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .share_mode(1 | 4)
        .open(path)
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn open_immutable_base(path: &Path) -> Result<File, String> {
    File::open(path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(text: &str) -> (PathBuf, PieceTree) {
        let root = std::env::temp_dir().join(format!(
            "milkup-piece-tree-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let base = root.join("base.md");
        fs::write(&base, text).unwrap();
        let tree = PieceTree::open(&base, root.join("add.buf")).unwrap();
        (root, tree)
    }

    #[test]
    fn streaming_snapshot_survives_concurrent_edit_save_and_close() {
        use std::sync::mpsc;
        use std::time::Duration;
        let text = "中文👩🏽‍💻\r\n".repeat(20000);
        let (root, mut tree) = fixture(&text);
        tree.apply_batch(&[(0, 0, "PREFIX".into())]).unwrap();
        let expected = format!("PREFIX{text}").into_bytes();
        let mut snapshot = tree.snapshot().unwrap();
        let pinned_add = tree.add_path.clone();
        let pinned_base = tree.base_path.clone();
        let target = root.join("snapshot.md");
        let (ready_tx, ready_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let writer = std::thread::spawn(move || {
            let mut first = true;
            snapshot
                .write_with_progress(&target, || {
                    if first {
                        first = false;
                        ready_tx.send(()).unwrap();
                        resume_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    }
                    Ok(())
                })
                .unwrap();
            fs::read(target).unwrap()
        });
        ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        for _ in 0..25 {
            assert_eq!(tree.read_range(0, 6).unwrap(), "PREFIX");
            tree.apply_batch(&[(tree.utf16_len(), tree.utf16_len(), "TAIL".into())])
                .unwrap();
        }
        let saved = root.join("saved.md");
        tree.write_to(&saved).unwrap();
        tree.rebase(&saved).unwrap();
        assert_ne!(tree.add_path, pinned_add);
        tree.apply_batch(&[(0, 6, String::new())]).unwrap();
        tree.close().unwrap();
        drop(tree);
        assert!(pinned_add.exists());
        assert!(pinned_base.exists());
        resume_tx.send(()).unwrap();
        assert_eq!(writer.join().unwrap(), expected);
        assert!(!pinned_add.exists());
        assert!(!pinned_base.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_descriptor_budget_is_checked_before_copying_text() {
        let (root, mut tree) = fixture("x");
        tree.root = None;
        for _ in 0..MAX_SNAPSHOT_PIECES {
            tree.push_base_piece(0, "x");
        }
        let snapshot = tree.snapshot().unwrap();
        assert_eq!(snapshot.pieces.len(), MAX_SNAPSHOT_PIECES);
        assert!(snapshot.pieces.capacity() * std::mem::size_of::<Piece>() <= 3 * 1024 * 1024);
        drop(snapshot);
        tree.push_base_piece(0, "x");
        assert!(tree.snapshot().err().unwrap().contains("预算"));
        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn edits_unicode_and_reads_lines_without_materializing_document() {
        let (root, mut tree) = fixture("a😀中\r\nsecond\nlast");
        tree.apply_batch(&[(1, 3, "emoji".into()), (4, 4, "!".into())])
            .unwrap();
        assert_eq!(
            tree.read_range(0, tree.byte_len()).unwrap(),
            "aemoji中!\r\nsecond\nlast"
        );
        assert_eq!(tree.line_count(), 3);
        let from = tree.line_start_byte(2).unwrap();
        let to = tree.line_content_end_byte(2).unwrap();
        assert_eq!(tree.read_range(from, to).unwrap(), "second");
        assert!(tree.apply_batch(&[(2, 3, "bad".into())]).is_ok());
        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_surrogate_boundaries_and_overlapping_batches_atomically() {
        let (root, mut tree) = fixture("a😀bc");
        assert!(tree.apply_batch(&[(2, 3, "x".into())]).is_err());
        assert!(tree
            .apply_batch(&[(0, 3, "x".into()), (2, 4, "y".into())])
            .is_err());
        assert_eq!(tree.read_range(0, tree.byte_len()).unwrap(), "a😀bc");
        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_utf8_boundary_errors_without_decoding_partial_prefixes() {
        let (root, tree) = fixture("é\n```js\nx\n```");
        let error = tree.byte_to_utf16(1).unwrap_err();

        assert!(error.contains("UTF-8 character boundary"));
        assert!(!error.contains("invalid utf-8 sequence"));
        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_line_windows_after_newline_insertion_and_deletion() {
        let (root, mut tree) = fixture("alpha\nbeta");

        tree.apply_batch(&[(2, 2, "\n".into())]).unwrap();
        assert_eq!(tree.line_count(), 3);
        assert_eq!(read_line(&tree, 1), "al");
        assert_eq!(read_line(&tree, 2), "pha");
        assert_eq!(read_line(&tree, 3), "beta");

        tree.apply_batch(&[(2, 3, "".into())]).unwrap();
        assert_eq!(tree.line_count(), 2);
        assert_eq!(read_line(&tree, 1), "alpha");
        assert_eq!(read_line(&tree, 2), "beta");

        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_line_ending_after_a_multibyte_character() {
        let (root, tree) = fixture("- 中文\nnext");

        let to = tree.line_content_end_byte(1).unwrap();
        assert_eq!(tree.read_range(0, to).unwrap(), "- 中文");

        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn utf16_checkpoints_flush_multiple_buffers_and_preserve_bom_and_crlf() {
        let root = std::env::temp_dir().join(format!(
            "milkup-utf16-buffer-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let original = "中文😀 abcdefghijklmnopqrstuvwxyz\r\n".repeat(40000);
        for big_endian in [false, true] {
            let encode = |text: &str| {
                let mut bytes = if big_endian {
                    vec![0xfe, 0xff]
                } else {
                    vec![0xff, 0xfe]
                };
                for unit in text.encode_utf16() {
                    bytes.extend_from_slice(&if big_endian {
                        unit.to_be_bytes()
                    } else {
                        unit.to_le_bytes()
                    });
                }
                bytes
            };
            let base = root.join("base.md");
            fs::write(&base, encode(&original)).unwrap();
            let mut tree = PieceTree::open(&base, root.join("add.buf")).unwrap();
            tree.apply_batch(&[(0, 0, "CHECKPOINT17".into())]).unwrap();
            let saved = root.join("saved.md");
            tree.write_to(&saved).unwrap();
            assert_eq!(
                fs::read(saved).unwrap(),
                encode(&format!("CHECKPOINT17{original}"))
            );
            assert_eq!(fs::read(base).unwrap(), encode(&original));
            drop(tree);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn edits_and_saves_utf16le_bom_files_without_changing_the_encoding() {
        let root = std::env::temp_dir().join(format!(
            "milkup-piece-tree-utf16-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let base = root.join("base.md");
        fs::write(&base, utf16le_bytes("alpha\nbeta")).unwrap();
        let mut tree = PieceTree::open(&base, root.join("add.buf")).unwrap();

        tree.apply_batch(&[(2, 2, "\n".into()), (6, 7, "B".into())])
            .unwrap();
        let saved = root.join("saved.md");
        tree.write_to(&saved).unwrap();

        let bytes = fs::read(saved).unwrap();
        assert_eq!(&bytes[..2], &[0xff, 0xfe]);
        assert_eq!(
            decode_utf16(&bytes, BaseEncoding::Utf16Le).unwrap(),
            "al\npha\nBeta"
        );

        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn closes_session_files_before_cleanup() {
        let (root, mut tree) = fixture("hello");
        let add_path = tree.add_path.clone();
        let base_path = tree
            .normalized_base_path
            .clone()
            .expect("session base copy");

        tree.close().expect("close working files");

        assert!(!add_path.exists());
        assert!(!base_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn randomized_edits_match_a_string_reference() {
        let (root, mut tree) = fixture("head\r\n中文😀\n\nlast");
        let mut reference = "head\r\n中文😀\n\nlast".to_string();
        let inserts = ["", "x", "界", "😀", "\n", "\r\n", "abc"];
        let mut seed = 0x1234_5678_u64;

        for _ in 0..300 {
            let boundaries = utf16_boundaries(&reference);
            seed = lcg(seed);
            let first = seed as usize % boundaries.len();
            seed = lcg(seed);
            let second = seed as usize % boundaries.len();
            let (from_index, to_index) = if first <= second {
                (first, second)
            } else {
                (second, first)
            };
            seed = lcg(seed);
            let insert = inserts[seed as usize % inserts.len()];
            let from_utf16 = boundaries[from_index].0;
            let to_utf16 = boundaries[to_index].0;
            let from_byte = boundaries[from_index].1;
            let to_byte = boundaries[to_index].1;

            tree.apply_batch(&[(from_utf16, to_utf16, insert.to_string())])
                .unwrap();
            reference.replace_range(from_byte..to_byte, insert);

            assert_eq!(tree.byte_len(), reference.len());
            assert_eq!(tree.utf16_len(), reference.encode_utf16().count());
            assert_eq!(
                tree.line_count(),
                reference.bytes().filter(|byte| *byte == b'\n').count() + 1
            );
            assert_eq!(tree.read_range(0, tree.byte_len()).unwrap(), reference);
        }

        let output = root.join("saved.md");
        tree.write_to(&output).unwrap();
        assert_eq!(fs::read_to_string(output).unwrap(), reference);
        drop(tree);
        fs::remove_dir_all(root).unwrap();
    }

    fn utf16_boundaries(text: &str) -> Vec<(usize, usize)> {
        let mut result = vec![(0, 0)];
        let mut utf16 = 0;
        for (byte, character) in text.char_indices() {
            utf16 += character.len_utf16();
            result.push((utf16, byte + character.len_utf8()));
        }
        result
    }

    fn read_line(tree: &PieceTree, line: usize) -> String {
        tree.read_range(
            tree.line_start_byte(line).unwrap(),
            tree.line_content_end_byte(line).unwrap(),
        )
        .unwrap()
    }

    fn utf16le_bytes(text: &str) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xfe];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes
    }

    fn lcg(value: u64) -> u64 {
        value
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407)
    }
}

//! Read-only, bounded PE VERSIONINFO inspection. This checks the signed outer
//! installer resource; it does not decompress NSIS or attest its embedded app.
//! See Microsoft's PE format, VS_VERSIONINFO and String structure references.
use std::collections::BTreeSet;

const INVALID: &str = "Windows 更新包的版本资源缺失、损坏或不受支持";
type Result<T> = std::result::Result<T, &'static str>;

fn slice(bytes: &[u8], offset: usize, len: usize) -> Result<&[u8]> {
    bytes
        .get(offset..offset.checked_add(len).ok_or(INVALID)?)
        .ok_or(INVALID)
}
fn u16_at(bytes: &[u8], offset: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        slice(bytes, offset, 2)?.try_into().map_err(|_| INVALID)?,
    ))
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        slice(bytes, offset, 4)?.try_into().map_err(|_| INVALID)?,
    ))
}
fn aligned(offset: usize) -> Result<usize> {
    offset.checked_add(3).map(|v| v & !3).ok_or(INVALID)
}
fn utf16(bytes: &[u8]) -> Result<String> {
    if bytes.len() % 2 != 0 || bytes.len() > 512 {
        return Err(INVALID);
    }
    let units = bytes
        .chunks_exact(2)
        .map(|p| u16::from_le_bytes([p[0], p[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|_| INVALID)
}

struct Block<'a> {
    key: String,
    kind: u16,
    value: &'a [u8],
    children: &'a [u8],
    length: usize,
}
fn block(bytes: &[u8]) -> Result<Block<'_>> {
    let length = u16_at(bytes, 0)? as usize;
    let bytes = slice(bytes, 0, length)?;
    let value_length = u16_at(bytes, 2)? as usize;
    let kind = u16_at(bytes, 4)?;
    if kind > 1 {
        return Err(INVALID);
    }
    let mut end = 6;
    while u16_at(bytes, end)? != 0 {
        end += 2;
        if end > 518 {
            return Err(INVALID);
        }
    }
    let key = utf16(slice(bytes, 6, end - 6)?)?;
    let start = aligned(end + 2)?;
    if start > bytes.len() && value_length == 0 && end + 2 == bytes.len() {
        return Ok(Block {
            key,
            kind,
            value: &[],
            children: &[],
            length,
        });
    }
    if slice(bytes, end + 2, start - end - 2)?
        .iter()
        .any(|b| *b != 0)
    {
        return Err(INVALID);
    }
    let size = value_length
        .checked_mul(if kind == 1 { 2 } else { 1 })
        .ok_or(INVALID)?;
    let value = slice(bytes, start, size)?;
    let end = start + size;
    let child_start = aligned(end)?;
    let children = if end == bytes.len() {
        &[]
    } else {
        if slice(bytes, end, child_start - end)?
            .iter()
            .any(|b| *b != 0)
        {
            return Err(INVALID);
        }
        bytes.get(child_start..).ok_or(INVALID)?
    };
    Ok(Block {
        key,
        kind,
        value,
        children,
        length,
    })
}
fn children(mut bytes: &[u8], mut visit: impl FnMut(Block<'_>) -> Result<()>) -> Result<()> {
    let mut count = 0;
    while !bytes.is_empty() {
        count += 1;
        if count > 128 {
            return Err(INVALID);
        }
        let item = block(bytes)?;
        let length = item.length;
        if length < 6 {
            return Err(INVALID);
        }
        visit(item)?;
        if length == bytes.len() {
            break;
        }
        let next = aligned(length)?;
        if slice(bytes, length, next - length)?.iter().any(|b| *b != 0) {
            return Err(INVALID);
        }
        bytes = bytes.get(next..).ok_or(INVALID)?;
    }
    Ok(())
}
fn check_version_resource(bytes: &[u8], declared: &semver::Version) -> Result<()> {
    let root = block(bytes)?;
    if root.key != "VS_VERSION_INFO"
        || root.kind != 0
        || root.length != bytes.len()
        || root.value.len() != 52
        || u32_at(root.value, 0)? != 0xfeef04bd
        || u32_at(root.value, 4)? != 0x10000
    {
        return Err(INVALID);
    }
    // File and product numeric versions must agree with the release core. The
    // fourth component cannot encode SemVer prerelease; ProductVersion below
    // must retain the complete exact canonical string, including prerelease.
    for start in [8, 16] {
        let ms = u32_at(root.value, start)?;
        let ls = u32_at(root.value, start + 4)?;
        if (ms >> 16) as u64 != declared.major
            || (ms & 0xffff) as u64 != declared.minor
            || (ls >> 16) as u64 != declared.patch
        {
            return Err("Windows 安装器数字版本与签名声明不一致");
        }
    }
    let mut infos = 0;
    let mut tables = 0;
    children(root.children, |info| match info.key.as_str() {
        "VarFileInfo" => Ok(()),
        "StringFileInfo" => {
            infos += 1;
            if infos > 1 || !info.value.is_empty() {
                return Err(INVALID);
            }
            let mut names = BTreeSet::new();
            children(info.children, |table| {
                tables += 1;
                if tables > 32
                    || table.key.len() != 8
                    || !table.key.bytes().all(|b| b.is_ascii_hexdigit())
                    || !names.insert(table.key.clone())
                    || !table.value.is_empty()
                {
                    return Err(INVALID);
                }
                let mut product = 0;
                let mut keys = BTreeSet::new();
                children(table.children, |entry| {
                    if !keys.insert(entry.key.clone()) {
                        return Err(INVALID);
                    }
                    if entry.key == "ProductVersion" {
                        product += 1;
                        if entry.kind != 1 || !entry.children.is_empty() {
                            return Err(INVALID);
                        }
                        let text = utf16(entry.value)?;
                        if text.strip_suffix('\0') != Some(declared.to_string().as_str()) {
                            return Err("Windows 安装器 ProductVersion 与签名声明不一致");
                        }
                    }
                    Ok(())
                })?;
                if product != 1 {
                    return Err(INVALID);
                }
                Ok(())
            })
        }
        _ => Err(INVALID),
    })?;
    if infos != 1 || tables == 0 {
        return Err(INVALID);
    }
    Ok(())
}

struct Section {
    rva: u32,
    length: u32,
    virtual_length: u32,
    file: u32,
}
fn rva_slice<'a>(image: &'a [u8], sections: &[Section], rva: u32, length: u32) -> Result<&'a [u8]> {
    let mut result = None;
    for section in sections {
        if let Some(offset) = rva.checked_sub(section.rva) {
            if offset
                .checked_add(length)
                .is_some_and(|end| end <= section.length)
            {
                if result.is_some() {
                    return Err(INVALID);
                }
                result = Some(slice(
                    image,
                    section.file.checked_add(offset).ok_or(INVALID)? as usize,
                    length as usize,
                )?);
            }
        }
    }
    result.ok_or(INVALID)
}
fn directory(
    bytes: &[u8],
    offset: usize,
    visited: &mut BTreeSet<usize>,
) -> Result<Vec<(u32, u32)>> {
    if offset % 4 != 0 || !visited.insert(offset) {
        return Err(INVALID);
    }
    let count = u16_at(bytes, offset + 12)? as usize + u16_at(bytes, offset + 14)? as usize;
    if count > 4096 {
        return Err(INVALID);
    }
    let entries = slice(bytes, offset + 16, count * 8)?;
    let mut ids = BTreeSet::new();
    let mut result = Vec::new();
    for entry in entries.chunks_exact(8) {
        let id = u32_at(entry, 0)?;
        if !ids.insert(id) {
            return Err(INVALID);
        }
        result.push((id, u32_at(entry, 4)?));
    }
    Ok(result)
}
fn subdirectory(value: u32) -> Result<usize> {
    if value & 0x80000000 == 0 {
        return Err(INVALID);
    }
    Ok((value & 0x7fffffff) as usize)
}

pub(super) fn verify(image: &[u8], declared: &str) -> std::result::Result<(), String> {
    verify_inner(image, declared).map_err(str::to_owned)
}
fn verify_inner(image: &[u8], declared: &str) -> Result<()> {
    let declared = semver::Version::parse(declared).map_err(|_| INVALID)?;
    if slice(image, 0, 2)? != b"MZ" {
        return Err(INVALID);
    }
    let pe = u32_at(image, 0x3c)? as usize;
    if pe < 0x40 || slice(image, pe, 4)? != b"PE\0\0" {
        return Err(INVALID);
    }
    let count = u16_at(image, pe + 6)? as usize;
    if count == 0 || count > 96 {
        return Err(INVALID);
    }
    let optional_len = u16_at(image, pe + 20)? as usize;
    let optional = slice(image, pe + 24, optional_len)?;
    let data = match u16_at(optional, 0)? {
        0x10b => 96,
        0x20b => 112,
        _ => return Err(INVALID),
    };
    if u32_at(optional, data - 4)? < 3 {
        return Err(INVALID);
    }
    let resource_rva = u32_at(optional, data + 16)?;
    let resource_len = u32_at(optional, data + 20)?;
    if resource_len == 0 || resource_len > 16 * 1024 * 1024 {
        return Err(INVALID);
    }
    let headers = slice(image, pe + 24 + optional_len, count * 40)?;
    let mut sections = Vec::new();
    for entry in headers.chunks_exact(40) {
        let section = Section {
            rva: u32_at(entry, 12)?,
            length: u32_at(entry, 16)?,
            virtual_length: u32_at(entry, 8)?.max(u32_at(entry, 16)?),
            file: u32_at(entry, 20)?,
        };
        slice(image, section.file as usize, section.length as usize)?;
        let end = section.file.checked_add(section.length).ok_or(INVALID)?;
        let virtual_end = section
            .rva
            .checked_add(section.virtual_length)
            .ok_or(INVALID)?;
        if section.length != 0 && (section.file as usize) < pe + 24 + optional_len + count * 40 {
            return Err(INVALID);
        }
        for old in &sections {
            let old: &Section = old;
            if (section.length != 0
                && old.length != 0
                && section.file < old.file + old.length
                && old.file < end)
                || (section.virtual_length != 0
                    && old.virtual_length != 0
                    && section.rva < old.rva + old.virtual_length
                    && old.rva < virtual_end)
            {
                return Err(INVALID);
            }
        }
        sections.push(section);
    }
    let resources = rva_slice(image, &sections, resource_rva, resource_len)?;
    let mut visited = BTreeSet::new();
    let roots = directory(resources, 0, &mut visited)?;
    let type_entry = roots
        .into_iter()
        .find(|(id, _)| *id == 16)
        .ok_or(INVALID)?
        .1;
    let names = directory(resources, subdirectory(type_entry)?, &mut visited)?;
    if names.is_empty() || names.len() > 32 {
        return Err(INVALID);
    }
    let mut versions = 0;
    for (_, child) in names {
        let languages = directory(resources, subdirectory(child)?, &mut visited)?;
        if languages.is_empty() || languages.len() > 32 {
            return Err(INVALID);
        }
        for (_, leaf) in languages {
            versions += 1;
            if versions > 32 || leaf & 0x80000000 != 0 {
                return Err(INVALID);
            }
            let leaf = slice(resources, leaf as usize, 16)?;
            let data_rva = u32_at(leaf, 0)?;
            let size = u32_at(leaf, 4)?;
            if size == 0 || size > 64 * 1024 {
                return Err(INVALID);
            }
            let offset = data_rva.checked_sub(resource_rva).ok_or(INVALID)?;
            let version = slice(resources, offset as usize, size as usize)?;
            check_version_resource(version, &declared)?;
        }
    }
    Ok(())
}

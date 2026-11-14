use crate::{Result, MAX_OUTPUT};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Cursor;
fn png_crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & (0u32.wrapping_sub(crc & 1)));
        }
    }
    !crc
}
fn validate_complete_png(png: &[u8]) -> Result<()> {
    let mut offset = 8usize;
    let mut seen_header = false;
    let mut seen_data = false;
    let mut data_ended = false;
    while offset < png.len() {
        let header_end = offset.checked_add(8).ok_or("PNG chunk overflow")?;
        if header_end > png.len() {
            return Err("Truncated PNG chunk header".into());
        }
        let length = u32::from_be_bytes(png[offset..offset + 4].try_into()?) as usize;
        let end = header_end
            .checked_add(length)
            .and_then(|n| n.checked_add(4))
            .filter(|n| *n <= png.len())
            .ok_or("Truncated PNG chunk payload/CRC")?;
        let kind = &png[offset + 4..header_end];
        if !kind.iter().all(u8::is_ascii_alphabetic) || !kind[2].is_ascii_uppercase() {
            return Err("Invalid PNG chunk type".into());
        }
        let crc = u32::from_be_bytes(png[end - 4..end].try_into()?);
        if crc != png_crc32(&png[offset + 4..end - 4]) {
            return Err("PNG chunk CRC mismatch".into());
        }
        match kind {
            b"IHDR" if !seen_header && offset == 8 && length == 13 => seen_header = true,
            b"IHDR" => return Err("Duplicate/misplaced PNG header".into()),
            b"IDAT" if seen_header && !data_ended => seen_data |= length > 0,
            b"IDAT" => return Err("Nonconsecutive PNG image data".into()),
            b"IEND" if seen_header && seen_data && length == 0 && end == png.len() => return Ok(()),
            b"IEND" => return Err("Invalid PNG end or trailing data".into()),
            b"acTL" | b"fcTL" | b"fdAT" => return Err("Animated PNG not accepted".into()),
            b"PLTE" if seen_header && !seen_data => {}
            _ if kind[0].is_ascii_lowercase() && seen_header => {
                if seen_data {
                    data_ended = true;
                }
            }
            _ => return Err("Unknown/misplaced critical PNG chunk".into()),
        }
        offset = end;
    }
    Err("PNG missing complete IEND".into())
}
pub(crate) fn validate_png(metadata: &Value, png: &[u8]) -> Result<Value> {
    if png.len() > MAX_OUTPUT
        || png.len() < 33
        || !png.starts_with(b"\x89PNG\r\n\x1a\n")
        || &png[8..16] != b"\0\0\0\rIHDR"
        || metadata["pngBytes"] != png.len() as u64
    {
        return Err("Invalid PNG header or length".into());
    }
    validate_complete_png(png)?;
    let width = u32::from_be_bytes(png[16..20].try_into()?);
    let height = u32::from_be_bytes(png[20..24].try_into()?);
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 16_777_216
        || metadata["width"] != width
        || metadata["height"] != height
    {
        return Err("PNG dimensions exceed budget or disagree with metadata".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(png), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode()?;
    if decoded.width() != width || decoded.height() != height {
        return Err("Decoded dimension mismatch".into());
    }
    // Convert each inspected pixel on the stack; do not allocate a second RGBA
    // image outside ImageReader's allocation budget.
    use image::GenericImageView;
    let mut pixels = decoded.pixels();
    let first = pixels.next().ok_or("No pixels")?.2;
    let non_uniform = pixels.any(|(_, _, pixel)| pixel != first);
    if !non_uniform {
        return Err("Uniform image: hidden screenshot may be blank".into());
    }
    Ok(
        json!({"decoded":true,"width":width,"height":height,"nonUniform":true,
        "sha256":format!("{:x}",Sha256::digest(png)),"visualFullInkVerified":false}),
    )
}

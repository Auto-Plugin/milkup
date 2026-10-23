//! Isolated experiment; never linked into Milk up or its plugin delivery artifacts.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Cursor;
#[cfg(windows)]
use std::path::Path;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const MAX_OUTPUT: usize = 262_144;
#[cfg(windows)]
mod engine;
#[cfg(windows)]
mod launcher;
#[cfg(windows)]
mod stream;

fn validate_input(input: &Value) -> Result<()> {
    let obj = input.as_object().ok_or("Input must be an object")?;
    if obj.len() != 7
        || !obj.keys().all(|key| {
            [
                "protocol",
                "requestId",
                "source",
                "width",
                "theme",
                "fixtureId",
                "look",
            ]
            .contains(&key.as_str())
        })
    {
        return Err("Unexpected input fields; code/config/path/URL inputs are not accepted".into());
    }
    let id = input["requestId"].as_str().ok_or("Missing request ID")?;
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || input["fixtureId"] != id
    {
        return Err("Invalid request identity".into());
    }
    let source = input["source"].as_str().ok_or("Missing source")?;
    if source.encode_utf16().count() > 50_000
        || source.split('\n').count() > 256
        || input["protocol"] != 1
        || input["width"] != 1280
        || input["theme"] != "default"
        || !matches!(input["look"].as_str(), Some("classic" | "neo"))
        || serde_json::to_vec(input)?.len() > 65_536
    {
        return Err("Fixed request budget/configuration rejected".into());
    }
    Ok(())
}
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
fn execute_matrix<'a>(
    fixtures: impl Iterator<Item = &'a Value>,
    mut run_case: impl FnMut(&Value) -> Result<Value>,
    mut save_case: impl FnMut(&Value) -> Result<()>,
) -> Result<(Vec<Value>, bool)> {
    let mut records = Vec::new();
    let mut any_failure = false;
    for fixture in fixtures {
        let record = run_case(fixture)?;
        // Save the failing case before stopping; never dispatch another helper
        // after IPC/process/profile cleanup becomes uncertain.
        save_case(&record)?;
        let stop = record["launcher"]["stopMatrixAfterThisCase"] == true;
        let observation = record["observationOnly"] == true;
        any_failure |= stop
            || if observation {
                record["executionFailure"] != false
            } else {
                record["ok"] != true
            };
        records.push(record);
        if stop {
            break;
        }
    }
    Ok((records, any_failure))
}

fn validate_png(metadata: &Value, png: &[u8]) -> Result<Value> {
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

#[cfg(windows)]
fn run(args: &[String]) -> Result<()> {
    if args.first().map(String::as_str) == Some("--render-child") && args.len() == 3 {
        return engine::run(Path::new(&args[1]), Path::new(&args[2]));
    }
    if std::env::var("MILKUP_MERMAID_PROTOTYPE_AUTHORIZED").as_deref()
        != Ok("fixed-official-data-only-temporary-test")
    {
        return Err("Missing bounded prototype execution marker".into());
    }
    if args.len() < 4 || args.len() > 5 || args[0] != "--run" {
        return Err("Usage: --run <existing-runtime-directory> <fixtures-manifest.json> <new-output-directory> [fixture-id]".into());
    }
    let runtime = Path::new(&args[1]).canonicalize()?;
    if !runtime.join("msedgewebview2.exe").is_file() {
        return Err("Existing WebView2 Runtime required; no install fallback".into());
    }
    let manifest_path = Path::new(&args[2]).canonicalize()?;
    let base = manifest_path.parent().ok_or("No manifest directory")?;
    let bytes = std::fs::read(&manifest_path)?;
    if bytes.len() > 262144 {
        return Err("Fixture manifest exceeds budget".into());
    }
    let manifest: Value = serde_json::from_slice(&bytes)?;
    if manifest["engine"]["version"] != "12.2.0" {
        return Err("Unexpected engine version".into());
    }
    let output = Path::new(&args[3]);
    std::fs::create_dir(output)?;
    let fixtures = manifest["fixtures"].as_array().ok_or("Missing fixtures")?;
    let selected = fixtures
        .iter()
        .filter(|fixture| args.len() != 5 || fixture["id"] == args[4]);
    let (records, any_failure) = execute_matrix(
        selected,
        |fixture| {
            let id = fixture["id"].as_str().ok_or("Missing fixture ID")?;
            let path = fixture["path"].as_str().ok_or("Missing fixture path")?;
            if !(path.starts_with("fixtures/") || path.starts_with("fixtures-negative/"))
                || Path::new(path)
                    .components()
                    .any(|c| !matches!(c, std::path::Component::Normal(_)))
            {
                return Err("Fixture path outside reviewed directory".into());
            }
            let source = std::fs::read(base.join(path))?;
            if fixture["sha256"] != format!("{:x}", Sha256::digest(&source)) {
                return Err("Fixture digest mismatch".into());
            }
            let input = json!({"protocol":1,"requestId":id,"fixtureId":id,"source":String::from_utf8(source)?,"width":1280,"theme":"default","look":"classic"});
            let mut input = input;
            if fixture["initializeOverrides"]["look"] == "neo" {
                input["look"] = json!("neo");
            }
            validate_input(&input)?;
            let result = launcher::run(&runtime, &input);
            let record = match result {
                Ok(result) => {
                    let validation_started = std::time::Instant::now();
                    let decoded = validate_png(&result.metadata, &result.png);
                    let validation_elapsed_ms = validation_started.elapsed().as_millis();
                    let expected = &fixture["expectedRegistrationId"];
                    let registration_matches =
                        result.metadata["rendered"]["diagramType"] == *expected;
                    let raw_render_succeeded = result.metadata["status"] == "ok"
                        && decoded.is_ok()
                        && registration_matches
                        && result.report["success"] == true
                        && result.report["stopMatrixAfterThisCase"] != true;
                    let observation_only =
                        fixture.get("expectedFailure").is_some_and(Value::is_null);
                    let expected_rejection = fixture["expectedFailure"] == true;
                    let native_error = &result.report["rendererMetadata"]["engineMessage"];
                    let matched_rejection = expected_rejection
                        && native_error["phase"] == "error"
                        && fixture["expectedErrorContains"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .is_some_and(|expected| {
                                native_error["message"]
                                    .as_str()
                                    .is_some_and(|actual| actual.contains(expected))
                            })
                        && result.report["cleanupErrors"]
                            .as_array()
                            .is_some_and(Vec::is_empty)
                        && result.report["stopMatrixAfterThisCase"] == false;
                    let static_link = fixture["tags"]
                        .as_array()
                        .is_some_and(|tags| tags.iter().any(|tag| tag == "navigation-disabled"));
                    let link_stripped = !static_link
                        || (result.metadata["captureObservation"]["activeLinkElements"] == 0
                            && result.metadata["captureObservation"]["executableElements"] == 0);
                    let ok = !observation_only
                        && if expected_rejection {
                            matched_rejection
                        } else {
                            raw_render_succeeded && link_stripped
                        };
                    if raw_render_succeeded {
                        std::fs::write(output.join(format!("{id}.png")), &result.png)?;
                    }
                    let observation_controls_valid = result.report["browserProcessInOwnedJob"]
                        == true
                        && result.report["ready"]["engine"] == "12.2.0"
                        && result.report["jobActiveAfterStop"] == 0
                        && result.report["profileDeletedAndFolderAbsent"] == true
                        && result.report["privateTreeRemoved"] == true
                        && result.report["cleanupErrors"]
                            .as_array()
                            .is_some_and(Vec::is_empty)
                        && result.report["stopMatrixAfterThisCase"] == false;
                    let result_status = if observation_only {
                        "observation-recorded"
                    } else if ok {
                        "assertion-passed"
                    } else {
                        "assertion-failed"
                    };
                    json!({"fixture":id,"expectedRegistrationId":expected,"ok":if observation_only { Value::Null } else { json!(ok) },
                    "status":result_status,"acceptedAssertions":if observation_only {0} else {u8::from(ok)},
                    "executionFailure":observation_only && !observation_controls_valid,"registrationMatches":registration_matches,
                    "launcher":result.report,"metadata":result.metadata,"expectedRejection":expected_rejection,
                    "matchedExpectedRejection":matched_rejection,"observationOnly":observation_only,"rawRenderSucceeded":raw_render_succeeded,
                    "staticLinksStripped":link_stripped,"interactionAttempted":false,"pngValidationElapsedMs":validation_elapsed_ms,
                    "pngValidation":decoded.unwrap_or_else(|e|json!({"error":e.to_string()}))})
                }
                Err(error) => {
                    json!({"fixture":id,"ok":false,"executionFailure":true,"error":error.to_string()})
                }
            };
            Ok(record)
        },
        |record| {
            let id = record["fixture"]
                .as_str()
                .ok_or("Missing result identity")?;
            std::fs::write(
                output.join(format!("{id}.json")),
                serde_json::to_vec_pretty(record)?,
            )?;
            Ok(())
        },
    )?;
    if records.is_empty() {
        return Err("No matching reviewed fixture".into());
    }
    let report = json!({"engine":"12.2.0","officialBundleSha256":"a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f",
        "sourceBaseline":"b7f9cdecfc02c2f0710fc9d6b71c12419364e644","prototypeOnly":true,
        "osAllNetworkDenied":false,"standardUserResultRequiresTokenEvidence":true,
        "visualFullInkVerified":false,
        "assertedCases":records.iter().filter(|r| r["observationOnly"] != true).count(),
        "observations":records.iter().filter(|r| r["observationOnly"] == true).count(),
        "acceptedAssertions":records.iter().filter(|r| r["ok"] == true).count(),"records":records});
    std::fs::write(
        output.join("report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    if any_failure {
        return Err("One or more fixtures failed; inspect preserved per-case evidence".into());
    }
    Ok(())
}
fn main() {
    #[cfg(windows)]
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("Fixed Mermaid prototype failed: {error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("Windows execution required; this build supports offline validation tests only.");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn data_contract_rejects_code_config_and_oversize() {
        let mut input = json!({"protocol":1,"requestId":"flowchart-v2","fixtureId":"flowchart-v2","source":"flowchart LR\n A-->B","width":1280,"theme":"default","look":"classic"});
        assert!(validate_input(&input).is_ok());
        input["script"] = json!("alert(1)");
        assert!(validate_input(&input).is_err());
        input.as_object_mut().unwrap().remove("script");
        input["source"] = json!("x".repeat(50001));
        assert!(validate_input(&input).is_err());
    }
    #[test]
    fn png_validation_decodes_and_rejects_blank_truncated_and_dimension_lies() {
        let mut pixels = image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 255, 255, 255]));
        pixels.put_pixel(1, 1, image::Rgba([0, 0, 0, 255]));
        let mut encoded = Cursor::new(Vec::new());
        pixels
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        let png = encoded.into_inner();
        let mut metadata = json!({"pngBytes":png.len(),"width":2,"height":2});
        assert!(validate_png(&metadata, &png).is_ok());
        metadata["width"] = json!(3);
        assert!(validate_png(&metadata, &png).is_err());
        metadata["width"] = json!(2);
        assert!(validate_png(&metadata, &png[..png.len() - 12]).is_err());
        let mut truncated = png[..png.len() - 1].to_vec();
        metadata["pngBytes"] = json!(truncated.len());
        assert!(validate_png(&metadata, &truncated).is_err());
        truncated.extend_from_slice(b"extra");
        metadata["pngBytes"] = json!(truncated.len());
        assert!(validate_png(&metadata, &truncated).is_err());
        let mut trailing = png.clone();
        trailing.extend_from_slice(b"garbage");
        metadata["pngBytes"] = json!(trailing.len());
        assert!(validate_png(&metadata, &trailing).is_err());
        let mut corrupt = png.clone();
        let last = corrupt.len() - 1;
        corrupt[last] ^= 1;
        metadata["pngBytes"] = json!(corrupt.len());
        assert!(validate_png(&metadata, &corrupt).is_err());
        metadata["pngBytes"] = json!(png.len());
        let oversized = vec![0u8; MAX_OUTPUT + 1];
        metadata["pngBytes"] = json!(oversized.len());
        assert!(validate_png(&metadata, &oversized).is_err());
        metadata["pngBytes"] = json!(png.len());
        let mut bomb = png.clone();
        bomb[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(validate_png(&metadata, &bomb).is_err());
        let blank = image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 255, 255, 255]));
        let mut encoded = Cursor::new(Vec::new());
        blank
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        let png = encoded.into_inner();
        metadata["pngBytes"] = json!(png.len());
        assert!(validate_png(&metadata, &png).is_err());
    }
    #[test]
    fn cleanup_failure_saves_result_then_stops_before_next_helper() {
        let fixtures = [json!("first"), json!("uncertain"), json!("must-not-launch")];
        let events = std::cell::RefCell::new(Vec::new());
        let (records, failed) = execute_matrix(fixtures.iter(), |fixture| {
            let id = fixture.as_str().unwrap(); events.borrow_mut().push(format!("run:{id}"));
            Ok(json!({"fixture":id,"ok":true,"launcher":{"stopMatrixAfterThisCase":id=="uncertain"}}))
        }, |record| { events.borrow_mut().push(format!("save:{}", record["fixture"].as_str().unwrap())); Ok(()) }).unwrap();
        assert!(failed);
        assert_eq!(records.len(), 2);
        assert_eq!(
            *events.borrow(),
            ["run:first", "save:first", "run:uncertain", "save:uncertain"]
        );
    }
    #[test]
    fn observation_is_neutral_for_assertions_but_control_failure_is_fatal() {
        let fixtures = [json!("observe")];
        let (records, failed) = execute_matrix(
            fixtures.iter(),
            |_| {
                Ok(json!({
            "ok":null,"status":"observation-recorded","observationOnly":true,
            "acceptedAssertions":0,"executionFailure":false,
            "launcher":{"stopMatrixAfterThisCase":false}}))
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(!failed);
        assert_eq!(records[0]["acceptedAssertions"], 0);
        assert!(records[0]["ok"].is_null());
        let (_, failed) = execute_matrix(
            fixtures.iter(),
            |_| {
                Ok(json!({
            "ok":null,"observationOnly":true,"executionFailure":true,
            "launcher":{"stopMatrixAfterThisCase":false}}))
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(failed);
    }
}

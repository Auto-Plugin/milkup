use super::*;
use std::{sync::mpsc, thread};
fn request(name: &str) -> Request {
    Request {
        request_id: name.into(),
        owner_id: "owner-a".into(),
        source: "flowchart LR\nA-->B".into(),
        width: 640,
        theme: "default".into(),
        look: "classic".into(),
        remaining_ms: 5000,
    }
}
fn output() -> Rendered {
    let mut image = image::RgbaImage::from_pixel(8, 8, image::Rgba([255, 255, 255, 255]));
    image.put_pixel(3, 3, image::Rgba([0, 0, 0, 255]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    Rendered {
        png: bytes.into_inner(),
        width: 8,
        height: 8,
    }
}
#[test]
fn closed_text_contract_rejects_code_options_and_malformed_input() {
    let value = request("r1").input().unwrap();
    assert!(validate_input(&value).is_ok());
    for (field, value) in [
        ("url", json!("https://evil.invalid")),
        ("width", json!(8193)),
        ("theme", json!("custom")),
        ("protocol", json!(2)),
        ("fixtureId", json!("other")),
    ] {
        let mut bad = request("r1").input().unwrap();
        bad[field] = value;
        assert!(validate_input(&bad).is_err(), "{field}");
    }
    let mut many = request("r1");
    many.source = "a\n".repeat(256);
    assert!(many.input().is_err());
    let mut unicode = request("r1");
    unicode.source = "𐀀".repeat(25_001);
    assert!(unicode.input().is_err());
    assert!(serde_json::from_value::<Request>(json!({"requestId":"r1","ownerId":"o1","source":"x","width":160,"theme":"default","look":"classic","remainingMs":100,"config":{}})).is_err());
}
#[test]
fn complete_png_validation_rejects_truncation_trailing_bytes_and_crc() {
    let output = output();
    let metadata = json!({"width":8,"height":8,"pngBytes":output.png.len()});
    assert!(png::validate_png(&metadata, &output.png).is_ok());
    for change in [0, 1, 2] {
        let mut bytes = output.png.clone();
        match change {
            0 => {
                bytes.pop();
            }
            1 => bytes.push(0),
            _ => {
                bytes[29] ^= 1;
            }
        }
        let meta = json!({"width":8,"height":8,"pngBytes":bytes.len()});
        assert!(png::validate_png(&meta, &bytes).is_err());
    }
}
#[test]
fn leases_are_owned_and_released_without_cross_scope_or_owner() {
    let registry = Registry::default();
    let lease = registry
        .render_with("main", request("r1"), |_, _| Ok(output()))
        .unwrap();
    assert!(!registry
        .release("plugin", "owner-a", &lease.lease_id)
        .unwrap());
    assert!(!registry
        .release("main", "owner-b", &lease.lease_id)
        .unwrap());
    assert_eq!(registry.state.lock().unwrap().leases.len(), 1);
    assert!(registry
        .release("main", "owner-a", &lease.lease_id)
        .unwrap());
    assert_eq!(registry.state.lock().unwrap().leases.len(), 0);
    assert!(registry
        .render_with("main", request("r1"), |_, _| panic!(
            "reused identity must not run"
        ))
        .is_err());
}
#[test]
fn cancel_before_start_and_retired_owner_cannot_publish_or_launch() {
    let registry = Registry::default();
    registry.cancel("main", "owner-a", "r1").unwrap();
    assert!(registry
        .render_with("main", request("r1"), |_, _| panic!(
            "pre-cancelled request must not launch"
        ))
        .is_err());
    let lease = registry
        .render_with("main", request("r2"), |_, _| Ok(output()))
        .unwrap();
    registry.retire_owner("main", "owner-a").unwrap();
    assert!(!registry
        .release("main", "owner-a", &lease.lease_id)
        .unwrap());
    assert!(registry
        .render_with("main", request("r3"), |_, _| panic!(
            "retired owner must not launch"
        ))
        .is_err());
}
#[test]
fn cancellation_rejects_late_result_and_original_deadline_includes_queue() {
    let registry = Arc::new(Registry::default());
    let first = registry.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let thread = thread::spawn(move || {
        first.render_with("main", request("first"), |_, _| {
            started_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            Ok(output())
        })
    });
    started_rx.recv().unwrap();
    let second = registry.clone();
    let queued = thread::spawn(move || {
        let mut request = request("queued");
        request.remaining_ms = 25;
        second.render_with("main", request, |_, _| {
            panic!("expired queued request must not launch")
        })
    });
    assert!(queued.join().unwrap().unwrap_err().contains("deadline"));
    registry.cancel("plugin", "owner-a", "first").unwrap();
    assert!(!registry
        .state
        .lock()
        .unwrap()
        .jobs
        .values()
        .next()
        .unwrap()
        .cancelled
        .load(Ordering::Acquire));
    registry.cancel("main", "owner-a", "first").unwrap();
    resume_tx.send(()).unwrap();
    assert!(thread.join().unwrap().unwrap_err().contains("cancelled"));
    assert!(registry.state.lock().unwrap().leases.is_empty());
    assert!(registry
        .render_with("main", request("next"), |_, _| Ok(output()))
        .is_ok());
}
#[test]
fn uncertain_cleanup_prevents_later_jobs_and_budget_counts_old_plus_new() {
    let registry = Registry::default();
    assert!(registry
        .render_with("main", request("failure"), |_, control| {
            control.mark_cleanup_uncertain();
            Err("cleanup failed".into())
        })
        .is_err());
    assert!(registry
        .render_with("main", request("next"), |_, _| panic!(
            "uncertain cleanup must stop launches"
        ))
        .is_err());
    let registry = Registry::default();
    let mut leases = Vec::new();
    for n in 0..MAX_LEASES {
        leases.push(
            registry
                .render_with("main", request(&format!("r{n}")), |_, _| Ok(output()))
                .unwrap(),
        );
    }
    assert!(registry
        .render_with("main", request("over"), |_, _| Ok(output()))
        .unwrap_err()
        .contains("lease budget"));
    registry
        .release("main", "owner-a", &leases[0].lease_id)
        .unwrap();
    assert!(registry
        .render_with("main", request("after-release"), |_, _| Ok(output()))
        .is_ok());
}

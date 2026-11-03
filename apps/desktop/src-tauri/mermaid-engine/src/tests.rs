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

#[test]
fn shutdown_closes_admission_cancels_and_waits_for_owned_backend_cleanup() {
    let registry = Arc::new(Registry::default());
    let (started_tx, started_rx) = mpsc::channel();
    let (cancelled_tx, cancelled_rx) = mpsc::channel();
    let (cleanup_tx, cleanup_rx) = mpsc::channel();
    let rendering = registry.clone();
    let renderer = thread::spawn(move || {
        rendering.render_with("main", request("active"), |_, control| {
            started_tx.send(control.deadline).unwrap();
            while control.checkpoint().is_ok() {
                thread::yield_now();
            }
            cancelled_tx.send(control.deadline).unwrap();
            cleanup_rx.recv().unwrap();
            Ok(output())
        })
    });
    let original_deadline = started_rx.recv().unwrap();
    let queued_registry = registry.clone();
    let queued = thread::spawn(move || {
        queued_registry.render_with("main", request("queued-at-close"), |_, _| {
            panic!("queued work must be cancelled before starting its backend")
        })
    });
    let queue_observation_deadline = Instant::now() + Duration::from_secs(1);
    while registry.state.lock().unwrap().jobs.len() != 2 {
        assert!(Instant::now() < queue_observation_deadline);
        thread::yield_now();
    }
    let closing = registry.clone();
    let (settled_tx, settled_rx) = mpsc::channel();
    let shutdown = thread::spawn(move || {
        settled_tx.send(closing.shutdown_and_wait()).unwrap();
    });
    assert_eq!(cancelled_rx.recv().unwrap(), original_deadline);
    assert!(queued.join().unwrap().unwrap_err().contains("cancelled"));
    assert!(registry
        .render_with("main", request("late"), |_, _| {
            panic!("closing service must reject new work before backend admission")
        })
        .unwrap_err()
        .contains("closing"));
    assert!(
        settled_rx.recv_timeout(Duration::from_millis(20)).is_err(),
        "Cancellation acknowledgement must not stand in for backend cleanup"
    );
    cleanup_tx.send(()).unwrap();
    assert!(renderer.join().unwrap().unwrap_err().contains("cancelled"));
    settled_rx
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    shutdown.join().unwrap();
    let state = registry.state.lock().unwrap();
    assert!(state.jobs.is_empty() && state.leases.is_empty() && !state.active);
}

#[test]
fn shutdown_retry_does_not_extend_deadline_or_hide_unsettled_work() {
    let registry = Arc::new(Registry::default());
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let rendering = registry.clone();
    let renderer = thread::spawn(move || {
        rendering.render_with("main", request("held"), |_, _| {
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            Ok(output())
        })
    });
    started_rx.recv().unwrap();
    registry.stop_all();
    let expired = Instant::now() - Duration::from_millis(1);
    registry.state.lock().unwrap().shutdown_deadline = Some(expired);
    for _ in 0..2 {
        assert!(registry
            .shutdown_and_wait()
            .unwrap_err()
            .contains("unsettled"));
        let state = registry.state.lock().unwrap();
        assert_eq!(state.shutdown_deadline, Some(expired));
        assert_eq!(state.jobs.len(), 1);
    }
    release_tx.send(()).unwrap();
    assert!(renderer.join().unwrap().is_err());
    registry.shutdown_and_wait().unwrap();
    assert_eq!(
        registry.state.lock().unwrap().shutdown_deadline,
        Some(expired)
    );
}

#[test]
fn shutdown_never_accepts_uncertain_cleanup_and_clears_completed_leases() {
    let registry = Registry::default();
    registry
        .render_with("main", request("rendered"), |_, _| Ok(output()))
        .unwrap();
    registry.shutdown_and_wait().unwrap();
    assert!(registry.state.lock().unwrap().leases.is_empty());
    assert!(registry
        .render_with("main", request("after-close"), |_, _| {
            panic!("shutdown is permanent even after all work settled")
        })
        .is_err());

    let registry = Registry::default();
    assert!(registry
        .render_with("main", request("uncertain"), |_, control| {
            control.mark_cleanup_uncertain();
            Err("owned cleanup could not be established".into())
        })
        .is_err());
    assert!(registry
        .shutdown_and_wait()
        .unwrap_err()
        .contains("uncertain"));
    assert!(registry
        .shutdown_and_wait()
        .unwrap_err()
        .contains("uncertain"));
}

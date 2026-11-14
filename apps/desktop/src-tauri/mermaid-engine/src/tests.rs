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

fn released_native_report(request_id: &str) -> Value {
    json!({
        "requestId":request_id,"stopMatrixAfterThisCase":true,
        "ownedJobCreated":true,"profileCreated":true,"pinnedFilesCreated":true,
        "pinsReleased":true,"preStopJob":{"active":2},"jobActiveAfterStop":0,
        "ipcStreamsStarted":["stdout","stdin","stderr"],"ipcThreadsCompleted":true,
        "ipcThreadCleanup":[
            {"stream":"stdout","finished":true,"panicked":false},
            {"stream":"stdin","finished":true,"panicked":false},
            {"stream":"stderr","finished":true,"panicked":false}],
        "profileDeleteApiSucceeded":true,"profileDeletedAndFolderAbsent":true,
        "privateTreeRemoved":true,"privateTreeCleanup":{
            "terminalPhase":"complete","absenceChecked":true,"absent":true,
            "attempts":1,"finalOsError":null}
    })
}

#[test]
fn historical_995_facts_allow_exit_after_release_without_reopening_rendering() {
    // The immutable original audit records the actual failure and completed
    // resource cleanup. It predates the new explicit created-resource fields;
    // the report below is a labelled test reconstruction, not a recovered raw
    // launcher report or retroactive acceptance of the old failed run.
    let log = include_str!(concat!(env!("CARGO_MANIFEST_DIR"),
        "/../../../../docs/evidence/mermaid-windows-trial-beta9-2026-11-03/attempt-41708284083/extracted/installed/pure-standard/ordinary-product.log"));
    let records: Vec<Value> = log
        .lines()
        .filter_map(|line| line.strip_prefix("MILKUP_MERMAID_NATIVE_AUDIT "))
        .map(|line| serde_json::from_str(line).unwrap())
        .filter(|value: &Value| value["phase"] == "finished")
        .collect();
    assert_eq!(records.len(), 1);
    let original = &records[0];
    assert_eq!(original["requestId"], "7b60396d899c44c39ed512d12f3a68c8");
    assert_eq!(original["successful"], false);
    assert_eq!(original["pngBytes"], 0);
    assert_eq!(original["cleanupUncertain"], true);
    assert_eq!(original["stdoutFailure"]["win32Error"], 995);
    assert_eq!(original["stderrFailure"]["win32Error"], 995);
    assert_eq!(original["ownedJobCreated"], true);
    assert_eq!(original["profileCreated"], true);
    assert_eq!(original["profileDeleted"], true);
    assert!(original["cleanupTimeline"]["pinsReleasedMs"].is_u64());

    let request_id = original["requestId"].as_str().unwrap();
    let mut report = released_native_report(request_id);
    for field in [
        "jobActiveAfterStop",
        "ipcThreadsCompleted",
        "ipcThreadCleanup",
        "privateTreeRemoved",
        "privateTreeCleanup",
        "stdoutFailure",
        "stderrFailure",
    ] {
        report[field] = original[field].clone();
    }
    assert!(owned_native_resources_released(request_id, &report));
    let registry = Registry::default();
    let failure = registry
        .render_with("main", request(request_id), |_, control| {
            control.mark_native_failure(request_id, &report);
            Err("Original protocol 995 remains a failed render".into())
        })
        .unwrap_err();
    assert!(failure.contains("995"));
    assert!(registry.unhealthy.load(Ordering::Acquire));
    assert!(!registry.cleanup_uncertain.load(Ordering::Acquire));
    assert!(registry.state.lock().unwrap().leases.is_empty());
    assert!(registry
        .render_with("main", request("later"), |_, _| {
            panic!("Released resources do not authorize another native render")
        })
        .is_err());
    registry.shutdown_and_wait().unwrap();
    registry.shutdown_and_wait().unwrap();
}

#[test]
fn release_proof_rejects_missing_nonboolean_and_contradictory_resource_facts() {
    let report = released_native_report("r");
    for field in [
        "requestId",
        "ownedJobCreated",
        "profileCreated",
        "pinnedFilesCreated",
        "pinsReleased",
        "preStopJob",
        "jobActiveAfterStop",
        "ipcStreamsStarted",
        "ipcThreadsCompleted",
        "ipcThreadCleanup",
        "profileDeleteApiSucceeded",
        "profileDeletedAndFolderAbsent",
        "privateTreeRemoved",
        "privateTreeCleanup",
    ] {
        let mut missing = report.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(
            !owned_native_resources_released("r", &missing),
            "missing {field}"
        );
        for value in [Value::Null, json!(false), json!("true")] {
            let mut invalid = report.clone();
            invalid[field] = value;
            assert!(
                !owned_native_resources_released("r", &invalid),
                "invalid {field}"
            );
        }
    }
    for (pointer, value) in [
        ("/ipcStreamsStarted/1", json!("stdout")),
        ("/ipcStreamsStarted/1", json!("other")),
        ("/ipcThreadCleanup/1/stream", json!("stdout")),
        ("/ipcThreadCleanup/1/finished", json!(false)),
        ("/ipcThreadCleanup/1/panicked", json!(true)),
        ("/ipcThreadCleanup/1/panicked", Value::Null),
        ("/privateTreeCleanup/terminalPhase", json!("remove")),
        ("/privateTreeCleanup/absenceChecked", json!(false)),
        ("/privateTreeCleanup/absent", json!(false)),
        ("/privateTreeCleanup/finalOsError", json!(5)),
        ("/privateTreeCleanup/attempts", json!(0)),
        ("/jobActiveAfterStop", json!(1)),
    ] {
        let mut invalid = report.clone();
        *invalid.pointer_mut(pointer).unwrap() = value;
        assert!(!owned_native_resources_released("r", &invalid), "{pointer}");
    }
    let mut missing_thread = report.clone();
    missing_thread["ipcThreadCleanup"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(!owned_native_resources_released("r", &missing_thread));
    let mut missing_absence_error = report.clone();
    missing_absence_error["privateTreeCleanup"]
        .as_object_mut()
        .unwrap()
        .remove("finalOsError");
    assert!(!owned_native_resources_released(
        "r",
        &missing_absence_error
    ));
}

#[test]
fn explicitly_uncreated_resources_need_no_fabricated_cleanup_but_reject_contradictions() {
    let report = json!({"requestId":"early","ownedJobCreated":false,"profileCreated":false,
        "pinnedFilesCreated":false,"pinsReleased":true,"ipcStreamsStarted":[],
        "ipcThreadCleanup":[],"ipcThreadsCompleted":true,"privateTreeRemoved":true,
        "privateTreeCleanup":{"terminalPhase":"complete","absenceChecked":true,
            "absent":true,"attempts":1,"finalOsError":null}});
    assert!(owned_native_resources_released("early", &report));
    for (field, value) in [
        ("helperProcessId", json!(42)),
        ("preStopJob", json!({"active":0})),
        ("jobActiveAfterStop", json!(0)),
        ("profileFolder", json!("created-folder")),
        ("appContainerSid", json!("created-sid")),
        ("privateExecutableBytes", json!(128)),
        ("profileDeleteApiSucceeded", json!(true)),
    ] {
        let mut invalid = report.clone();
        invalid[field] = value;
        assert!(
            !owned_native_resources_released("early", &invalid),
            "{field}"
        );
    }
}

#[test]
fn partially_initialized_launcher_requires_release_of_only_the_resources_it_created() {
    for (job_created, pins_created) in [(false, false), (false, true), (true, true)] {
        let mut report = released_native_report("partial");
        report["ownedJobCreated"] = json!(job_created);
        report["pinnedFilesCreated"] = json!(pins_created);
        report["ipcStreamsStarted"] = json!([]);
        report["ipcThreadCleanup"] = json!([]);
        if !job_created {
            report.as_object_mut().unwrap().remove("preStopJob");
            report.as_object_mut().unwrap().remove("jobActiveAfterStop");
        }
        assert!(owned_native_resources_released("partial", &report));
        // A profile exists even when later initialization did not reach a
        // helper or any IPC threads; both deletion observations remain required.
        report["profileDeletedAndFolderAbsent"] = json!(false);
        let registry = Registry::default();
        assert!(registry
            .render_with("main", request("partial"), |_, control| {
                control.mark_native_failure("partial", &report);
                Err("Profile folder remains after partial initialization".into())
            })
            .is_err());
        assert!(registry
            .shutdown_and_wait()
            .unwrap_err()
            .contains("uncertain"));
    }
}

#[test]
fn another_requests_proof_and_later_clean_report_cannot_clear_uncertain_ownership() {
    for unknown_first in [false, true] {
        let registry = Registry::default();
        assert!(registry
            .render_with("main", request("this-request"), |_, control| {
                if unknown_first {
                    control.mark_cleanup_uncertain();
                } else {
                    control.mark_native_failure(
                        "this-request",
                        &released_native_report("other-request"),
                    );
                }
                control
                    .mark_native_failure("this-request", &released_native_report("this-request"));
                Err("Uncertainty cannot be repaired by another report".into())
            })
            .is_err());
        assert!(registry.unhealthy.load(Ordering::Acquire));
        assert!(registry.cleanup_uncertain.load(Ordering::Acquire));
        assert!(registry
            .shutdown_and_wait()
            .unwrap_err()
            .contains("uncertain"));
    }
}

#[test]
fn protocol_failure_after_inflight_cancel_still_waits_for_actual_release_before_exit() {
    let registry = Arc::new(Registry::default());
    let rendering = registry.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (cancelled_tx, cancelled_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let renderer = thread::spawn(move || {
        rendering.render_with("main", request("inflight"), |_, control| {
            started_tx.send(()).unwrap();
            while control.checkpoint().is_ok() {
                thread::yield_now();
            }
            cancelled_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            control.mark_native_failure("inflight", &released_native_report("inflight"));
            Err("Protocol remains failed after checked release".into())
        })
    });
    started_rx.recv().unwrap();
    let closing = registry.clone();
    let (closed_tx, closed_rx) = mpsc::channel();
    let closer = thread::spawn(move || closed_tx.send(closing.shutdown_and_wait()).unwrap());
    cancelled_rx.recv().unwrap();
    assert!(closed_rx.recv_timeout(Duration::from_millis(20)).is_err());
    release_tx.send(()).unwrap();
    assert!(renderer.join().unwrap().is_err());
    closed_rx
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    closer.join().unwrap();
    assert!(registry.unhealthy.load(Ordering::Acquire));
    assert!(!registry.cleanup_uncertain.load(Ordering::Acquire));
}

#[test]
fn panicked_backend_remains_an_unresolved_resource_failure() {
    let registry = Registry::default();
    assert!(registry
        .render_with("main", request("panic"), |_, _| {
            panic!("Unknown ownership at a backend panic")
        })
        .unwrap_err()
        .contains("panicked"));
    assert!(registry.cleanup_uncertain.load(Ordering::Acquire));
    assert!(registry
        .shutdown_and_wait()
        .unwrap_err()
        .contains("uncertain"));
}

// SPDX-License-Identifier: Apache-2.0 OR MIT
// Milkup diagnostic only: no request/response, URI, headers or authority changes.
use std::{
  fmt::Write as _,
  io::Write as _,
  sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
  },
  time::{Instant, SystemTime, UNIX_EPOCH},
};

const REQUEST_LIMIT: u64 = 16;
const STAGE_LIMIT: usize = 24;
static ENABLED: OnceLock<bool> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
pub(super) enum Stage {
  CallbackEntered,
  RequestAcquired,
  UriRead,
  RequestPrepared,
  PrepareFailed,
  DeferralAcquired,
  DeferralUnavailable,
  HandlerCalled,
  HandlerReturned,
  ResponderReceived,
  DispatchQueued,
  ResponseHandlerEntered,
  ResponseBuilt,
  ResponseBuildFailed,
  ResponseSet,
  ResponseSetFailed,
  ErrorResponseSet,
  ErrorResponseSetFailed,
  DeferralCompleted,
  DeferralFailed,
}
impl Stage {
  fn name(self) -> &'static str {
    match self {
      Self::CallbackEntered => "callback-entered",
      Self::RequestAcquired => "request-acquired",
      Self::UriRead => "uri-read",
      Self::RequestPrepared => "request-prepared",
      Self::PrepareFailed => "prepare-failed",
      Self::DeferralAcquired => "deferral-acquired",
      Self::DeferralUnavailable => "deferral-unavailable",
      Self::HandlerCalled => "handler-called",
      Self::HandlerReturned => "handler-returned",
      Self::ResponderReceived => "responder-received",
      Self::DispatchQueued => "dispatch-queued",
      Self::ResponseHandlerEntered => "response-handler-entered",
      Self::ResponseBuilt => "response-built",
      Self::ResponseBuildFailed => "response-build-failed",
      Self::ResponseSet => "response-set",
      Self::ResponseSetFailed => "response-set-failed",
      Self::ErrorResponseSet => "error-response-set",
      Self::ErrorResponseSetFailed => "error-response-set-failed",
      Self::DeferralCompleted => "deferral-completed",
      Self::DeferralFailed => "deferral-failed",
    }
  }
}

pub(super) struct RequestStart {
  start: Instant,
  unix_ms: u128,
  request_us: u128,
}
impl RequestStart {
  pub(super) fn capture() -> Option<Self> {
    Self::enabled(
      *ENABLED.get_or_init(|| std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1")),
    )
  }
  fn enabled(enabled: bool) -> Option<Self> {
    enabled.then(|| Self {
      start: Instant::now(),
      unix_ms: SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis(),
      request_us: 0,
    })
  }
  pub(super) fn request_acquired(&mut self) {
    self.request_us = self.start.elapsed().as_micros();
  }
  pub(super) fn classify(self, uri: &str) -> Option<Arc<Trace>> {
    if !is_main(uri) {
      return None;
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    if id >= REQUEST_LIMIT {
      if id == REQUEST_LIMIT {
        let _ = writeln!(std::io::stderr().lock(), "MILKUP_WRY_STARTUP_TIMING {{\"schema\":1,\"pid\":{},\"limitReached\":true,\"limit\":{}}}", std::process::id(), REQUEST_LIMIT);
      }
      return None;
    }
    Some(Arc::new(self.trace(id)))
  }
  fn trace(self, id: u64) -> Trace {
    Trace {
      id,
      start: self.start,
      unix_ms: self.unix_ms,
      data: Mutex::new(Data {
        stages: vec![
          (Stage::CallbackEntered, 0),
          (Stage::RequestAcquired, self.request_us),
          (Stage::UriRead, self.start.elapsed().as_micros()),
        ],
        truncated: false,
      }),
    }
  }
}
fn is_main(uri: &str) -> bool {
  matches!(
    uri,
    "http://tauri.localhost/"
      | "http://tauri.localhost/index.html"
      | "https://tauri.localhost/"
      | "https://tauri.localhost/index.html"
  )
}
struct Data {
  stages: Vec<(Stage, u128)>,
  truncated: bool,
}
pub(super) struct Trace {
  id: u64,
  start: Instant,
  unix_ms: u128,
  data: Mutex<Data>,
}
impl Trace {
  fn mark(&self, stage: Stage) {
    let Ok(mut data) = self.data.lock() else {
      return;
    };
    if data.stages.len() == STAGE_LIMIT {
      data.truncated = true;
      return;
    }
    data.stages.push((stage, self.start.elapsed().as_micros()));
  }
  fn json(&self) -> Option<String> {
    let data = self.data.lock().ok()?;
    let mut out = format!("{{\"schema\":1,\"pid\":{},\"id\":{},\"startedUnixMs\":{},\"durationUs\":{},\"truncated\":{},\"stages\":[", std::process::id(), self.id, self.unix_ms, self.start.elapsed().as_micros(), data.truncated);
    for (index, (stage, us)) in data.stages.iter().enumerate() {
      if index > 0 {
        out.push(',');
      }
      // Stage names are a closed enum, never user-provided strings.
      let _ = write!(
        out,
        "{{\"stage\":\"{}\",\"elapsedUs\":{}}}",
        stage.name(),
        us
      );
    }
    out.push_str("]}");
    Some(out)
  }
}
impl Drop for Trace {
  fn drop(&mut self) {
    if let Some(json) = self.json() {
      let _ = writeln!(
        std::io::stderr().lock(),
        "MILKUP_WRY_STARTUP_TIMING {}",
        json
      );
    }
  }
}
pub(super) fn mark(trace: &Option<Arc<Trace>>, stage: Stage) {
  if let Some(trace) = trace {
    trace.mark(stage);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn disabled_capture_does_not_create_a_trace() {
    assert!(RequestStart::enabled(false).is_none());
  }
  #[test]
  fn only_exact_main_documents_are_recorded() {
    for uri in [
      "http://tauri.localhost/",
      "https://tauri.localhost/index.html",
    ] {
      assert!(is_main(uri));
    }
    for uri in [
      "http://tauri.localhost/private.md",
      "http://tauri.localhost/?secret",
      "http://ipc.localhost/a",
      "http://milkup-mermaid.localhost/",
      "https://tauri.localhost.evil/",
    ] {
      assert!(!is_main(uri));
    }
  }
  #[test]
  fn retains_cross_thread_order_and_bounds_output() {
    let trace = Arc::new(RequestStart::enabled(true).unwrap().trace(0));
    let other = trace.clone();
    std::thread::spawn(move || other.mark(Stage::ResponderReceived))
      .join()
      .unwrap();
    trace.mark(Stage::ResponseHandlerEntered);
    for _ in 0..40 {
      trace.mark(Stage::ResponseSet);
    }
    let data = trace.data.lock().unwrap();
    assert_eq!(data.stages.len(), STAGE_LIMIT);
    assert!(data.truncated);
    assert!(data.stages.windows(2).all(|p| p[0].1 <= p[1].1));
    drop(data);
    let json = trace.json().unwrap();
    assert!(json.len() < 4096);
    assert!(json.contains("\"truncated\":true"));
    assert!(!json.contains("http"));
    assert!(
      json.find("responder-received").unwrap() < json.find("response-handler-entered").unwrap()
    );
  }
}

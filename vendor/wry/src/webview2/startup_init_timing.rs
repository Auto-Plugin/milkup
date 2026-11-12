// SPDX-License-Identifier: Apache-2.0 OR MIT
// Opt-in creation timing only. No profile paths, arguments, HWNDs or permissions.
// Collect in memory; write one bounded record when the constructor returns.
use std::{
  fmt::Write as _,
  io::Write as _,
  sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
  },
  time::{Instant, SystemTime, UNIX_EPOCH},
};
const LIMIT: u64 = 16;
const STAGES: usize = 32;
static ENABLED: OnceLock<bool> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
pub(super) enum Stage {
  Enter,
  ComInitialized,
  ContainerCreated,
  EnvironmentBegin,
  EnvironmentOptionsReady,
  EnvironmentCall,
  EnvironmentCallReturned,
  EnvironmentCallback,
  EnvironmentWaitReturned,
  ReusedEnvironment,
  ControllerBegin,
  ControllerCall,
  ControllerCallReturned,
  ControllerCallback,
  ControllerWaitReturned,
  SettingsBegin,
  SettingsFinished,
  BoundsFinished,
}
impl Stage {
  fn name(self) -> &'static str {
    match self {
      Self::Enter => "constructor-enter",
      Self::ComInitialized => "com-initialized",
      Self::ContainerCreated => "container-created",
      Self::EnvironmentBegin => "environment-begin",
      Self::EnvironmentOptionsReady => "environment-options-ready",
      Self::EnvironmentCall => "environment-call",
      Self::EnvironmentCallReturned => "environment-call-returned",
      Self::EnvironmentCallback => "environment-callback",
      Self::EnvironmentWaitReturned => "environment-wait-returned",
      Self::ReusedEnvironment => "environment-reused",
      Self::ControllerBegin => "controller-begin",
      Self::ControllerCall => "controller-call",
      Self::ControllerCallReturned => "controller-call-returned",
      Self::ControllerCallback => "controller-callback",
      Self::ControllerWaitReturned => "controller-wait-returned",
      Self::SettingsBegin => "settings-begin",
      Self::SettingsFinished => "settings-finished",
      Self::BoundsFinished => "bounds-finished",
    }
  }
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
pub(super) type Handle = Option<Arc<Trace>>;
pub(super) struct Scope {
  pub(super) handle: Handle,
  success: bool,
}
impl Scope {
  pub(super) fn capture() -> Self {
    if !*ENABLED.get_or_init(|| std::env::var("MILKUP_MERMAID_NATIVE_AUDIT").as_deref() == Ok("1"))
    {
      return Self {
        handle: None,
        success: false,
      };
    }
    Self::numbered(NEXT.fetch_add(1, Ordering::Relaxed))
  }
  fn numbered(id: u64) -> Self {
    // The seventeenth scope emits only a limit marker at its end; later scopes
    // are silent. No logging is done inside environment/controller callbacks.
    Self {
      handle: (id <= LIMIT).then(|| {
        Arc::new(Trace {
          id,
          start: Instant::now(),
          unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
          data: Mutex::new(Data {
            stages: vec![(Stage::Enter, 0)],
            truncated: false,
          }),
        })
      }),
      success: false,
    }
  }
  pub(super) fn succeeded(&mut self) {
    self.success = true;
  }
  fn json(&self) -> Option<String> {
    let trace = self.handle.as_ref()?;
    if trace.id == LIMIT {
      return Some(format!(
        "{{\"schema\":1,\"pid\":{},\"limitReached\":true,\"limit\":{}}}",
        std::process::id(),
        LIMIT
      ));
    }
    let Ok(data) = trace.data.lock() else {
      return Some(format!(
        "{{\"schema\":1,\"pid\":{},\"id\":{},\"collectionFailed\":true}}",
        std::process::id(),
        trace.id
      ));
    };
    let mut out=format!("{{\"schema\":1,\"pid\":{},\"id\":{},\"startedUnixMs\":{},\"durationUs\":{},\"success\":{},\"truncated\":{},\"stages\":[",std::process::id(),trace.id,trace.unix_ms,trace.start.elapsed().as_micros(),self.success,data.truncated);
    for (i, (stage, us)) in data.stages.iter().enumerate() {
      if i > 0 {
        out.push(',');
      }
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
impl Drop for Scope {
  fn drop(&mut self) {
    if let Some(json) = self.json() {
      let _ = writeln!(std::io::stderr().lock(), "MILKUP_WRY_INIT_TIMING {}", json);
    }
  }
}
pub(super) fn mark(handle: &Handle, stage: Stage) {
  if let Some(trace) = handle {
    if trace.id >= LIMIT {
      return;
    }
    if let Ok(mut data) = trace.data.lock() {
      if data.stages.len() == STAGES {
        data.truncated = true;
      } else {
        data.stages.push((stage, trace.start.elapsed().as_micros()));
      }
    }
  }
}
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn disabled_and_exhausted_are_silent() {
    assert!(Scope {
      handle: None,
      success: false
    }
    .json()
    .is_none());
    assert!(Scope::numbered(LIMIT + 1).json().is_none());
    assert!(Scope::numbered(LIMIT)
      .json()
      .unwrap()
      .contains("limitReached"));
  }
  #[test]
  fn callback_order_is_collected_without_emitting_or_waiting() {
    let mut scope = Scope::numbered(0);
    let callback = scope.handle.clone();
    mark(&scope.handle, Stage::EnvironmentCall);
    std::thread::spawn(move || mark(&callback, Stage::EnvironmentCallback))
      .join()
      .unwrap();
    mark(&scope.handle, Stage::EnvironmentWaitReturned);
    scope.succeeded();
    let json = scope.json().unwrap();
    assert!(json.contains("\"success\":true"));
    assert!(json.find("environment-call\"").unwrap() < json.find("environment-callback").unwrap());
    let trace = scope.handle.as_ref().unwrap();
    let data = trace.data.lock().unwrap();
    assert!(data.stages.windows(2).all(|s| s[0].1 <= s[1].1));
  }
  #[test]
  fn early_failure_and_stage_overflow_are_explicit() {
    let scope = Scope::numbered(0);
    for _ in 0..100 {
      mark(&scope.handle, Stage::ControllerCall);
    }
    let json = scope.json().unwrap();
    assert!(json.contains("\"success\":false"));
    assert!(json.contains("\"truncated\":true"));
    assert!(json.len() < 4096);
  }
}

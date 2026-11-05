//! Product-private, fixed-code Mermaid engine. No plugin module/code/config path
//! crosses this boundary. The desktop host alone authorizes renderer identities.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use std::time::{Duration, Instant};

mod frontend_trace;
pub use frontend_trace::{record_frontend_trace, FrontendTrace};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub const MAX_OUTPUT: usize = 16 * 1024 * 1024;
const MAX_JOBS: usize = 8;
const MAX_LEASES: usize = 32;
const MAX_RETAINED_BYTES: usize = 128 * 1024 * 1024;
const MAX_RETAINED_PIXELS: u64 = 32 * 1024 * 1024;
const MAX_IDENTITIES: usize = 65_536;
const LEASE_TTL: Duration = Duration::from_secs(60);
// Existing native teardown has a two-second Job stop, bounded IPC joins and
// three-second owned-tree retries. This wait never changes a render deadline.
const SHUTDOWN_CLEANUP_ALLOWANCE: Duration = Duration::from_secs(6);
#[cfg(any(windows, test))]
mod audit;
#[cfg(any(windows, test))]
mod cleanup;
#[cfg(windows)]
mod engine;
#[cfg(any(windows, test))]
mod ipc_observation;
#[cfg(windows)]
mod launcher;
mod png;
#[cfg(windows)]
mod protocol_handles;
#[cfg(windows)]
mod stream;
#[cfg(test)]
mod token_diagnostic_format;
#[cfg(any(windows, test))]
mod token_policy;
#[cfg(any(windows, test))]
mod token_ready;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub request_id: String,
    pub owner_id: String,
    pub source: String,
    pub width: u32,
    pub theme: String,
    pub look: String,
    pub remaining_ms: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub lease_id: String,
    pub request_id: String,
    pub owner_id: String,
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub sha256: String,
    pub engine: &'static str,
}
pub struct Rendered {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone)]
pub struct Control {
    cancelled: Arc<AtomicBool>,
    deadline: Instant,
    // A native failure stops future rendering, even when all owned resources
    // were released. Unresolved ownership separately prevents process exit.
    unhealthy: Arc<AtomicBool>,
    cleanup_uncertain: Arc<AtomicBool>,
}
impl Control {
    pub fn checkpoint(&self) -> std::result::Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("Mermaid request cancelled".into())
        } else if Instant::now() >= self.deadline {
            Err("Mermaid original deadline expired".into())
        } else {
            Ok(())
        }
    }
    pub fn remaining(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }
    pub fn mark_cleanup_uncertain(&self) {
        self.cleanup_uncertain.store(true, Ordering::Release);
        self.unhealthy.store(true, Ordering::Release);
    }

    #[cfg(any(windows, test))]
    fn mark_native_failure(&self, request_id: &str, report: &Value) {
        // Neither latch is reset. A later or reused complete report cannot
        // excuse an earlier unknown/panicked backend or unresolved resource.
        if !owned_native_resources_released(request_id, report) {
            self.cleanup_uncertain.store(true, Ordering::Release);
        }
        self.unhealthy.store(true, Ordering::Release);
    }
}

/// A protocol failure is still a failed render. This narrowly establishes only
/// that the fixed launcher's owned resources for this request have been released
/// so that a stopped service need not trap an otherwise clean application exit.
/// The report is produced in-process by the fixed launcher, never accepted from
/// a plugin or from a remembered/externally supplied audit record.
#[cfg(any(windows, test))]
fn owned_native_resources_released(request_id: &str, report: &Value) -> bool {
    if report["requestId"].as_str() != Some(request_id)
        || !id(request_id)
        || report["ipcThreadsCompleted"] != true
        || report["pinsReleased"] != true
        || report["privateTreeRemoved"] != true
    {
        return false;
    }
    let (Some(job_created), Some(profile_created), Some(pins_created)) = (
        report["ownedJobCreated"].as_bool(),
        report["profileCreated"].as_bool(),
        report["pinnedFilesCreated"].as_bool(),
    ) else {
        return false;
    };
    let (Some(started), Some(completed)) = (
        report["ipcStreamsStarted"].as_array(),
        report["ipcThreadCleanup"].as_array(),
    ) else {
        return false;
    };
    if started.len() > 3 || started.len() != completed.len() {
        return false;
    }
    let mut streams = HashSet::new();
    for stream in started {
        let Some(name @ ("stdout" | "stdin" | "stderr")) = stream.as_str() else {
            return false;
        };
        if !streams.insert(name) {
            return false;
        }
    }
    for observation in completed {
        let Some(name) = observation["stream"].as_str() else {
            return false;
        };
        if !streams.remove(name)
            || observation["finished"] != true
            || observation["panicked"] != false
        {
            return false;
        }
    }
    if !streams.is_empty() {
        return false;
    }
    if job_created {
        if !profile_created
            || !pins_created
            || !report["preStopJob"].is_object()
            || report["jobActiveAfterStop"].as_u64() != Some(0)
        {
            return false;
        }
    } else if !started.is_empty()
        || !report["preStopJob"].is_null()
        || !report["jobActiveAfterStop"].is_null()
        || !report["helperProcessId"].is_null()
    {
        return false;
    }
    if profile_created {
        if report["profileDeleteApiSucceeded"] != true
            || report["profileDeletedAndFolderAbsent"] != true
        {
            return false;
        }
    } else if job_created
        || pins_created
        || !started.is_empty()
        || report["profileDeleteApiSucceeded"] == true
        || report["profileDeletedAndFolderAbsent"] == true
        || !report["profileFolder"].is_null()
        || !report["appContainerSid"].is_null()
    {
        return false;
    }
    if !pins_created && !report["privateExecutableBytes"].is_null() {
        return false;
    }
    let tree = &report["privateTreeCleanup"];
    tree["terminalPhase"] == "complete"
        && tree["absenceChecked"] == true
        && tree["absent"] == true
        && tree.get("finalOsError").is_some_and(Value::is_null)
        && tree["attempts"]
            .as_u64()
            .is_some_and(|n| (1..=31).contains(&n))
}
#[derive(Hash, PartialEq, Eq, Clone)]
struct Owner {
    scope: String,
    owner: String,
}
#[derive(Hash, PartialEq, Eq, Clone)]
struct JobKey {
    owner: Owner,
    request: String,
}
struct Retained {
    owner: Owner,
    request: String,
    png: Vec<u8>,
    pixels: u64,
    expires: Instant,
}
#[derive(Default)]
struct State {
    jobs: HashMap<JobKey, Control>,
    seen: HashSet<JobKey>,
    retired: HashSet<Owner>,
    leases: HashMap<String, Retained>,
    active: bool,
    next_lease: u64,
    closing: bool,
    shutdown_deadline: Option<Instant>,
}
#[derive(Default)]
pub struct Registry {
    state: Mutex<State>,
    wake: Condvar,
    unhealthy: Arc<AtomicBool>,
    cleanup_uncertain: Arc<AtomicBool>,
}

fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
}
pub(crate) fn validate_input(input: &Value) -> Result<()> {
    let obj = input.as_object().ok_or("Input must be an object")?;
    if obj.len() != 7
        || !obj.keys().all(|key| {
            [
                "protocol",
                "requestId",
                "fixtureId",
                "source",
                "width",
                "theme",
                "look",
            ]
            .contains(&key.as_str())
        })
    {
        return Err("Only the fixed text data contract is accepted".into());
    }
    let request = input["requestId"].as_str().ok_or("Missing request ID")?;
    let source = input["source"].as_str().ok_or("Missing source")?;
    if request.is_empty()
        || request.len() > 80
        || !request
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || input["fixtureId"] != request
        || input["protocol"] != 1
        || source.encode_utf16().count() > 50_000
        || source.split('\n').count() > 256
        || !input["width"]
            .as_u64()
            .is_some_and(|w| (160..=8192).contains(&w))
        || !matches!(input["theme"].as_str(), Some("default" | "dark"))
        || !matches!(input["look"].as_str(), Some("classic" | "neo"))
        || serde_json::to_vec(input)?.len() > 65_536
    {
        return Err("Fixed Mermaid input exceeds its data/configuration budget".into());
    }
    Ok(())
}
impl Request {
    fn input(&self) -> std::result::Result<Value, String> {
        if !id(&self.owner_id) || !(1..=30_000).contains(&self.remaining_ms) {
            return Err("Invalid Mermaid owner or original deadline remainder".into());
        }
        let input = json!({"protocol":1,"requestId":self.request_id,"fixtureId":self.request_id,"source":self.source,"width":self.width,"theme":self.theme,"look":self.look});
        validate_input(&input).map_err(|e| e.to_string())?;
        Ok(input)
    }
}
impl Registry {
    pub fn render_with(
        &self,
        scope: &str,
        request: Request,
        backend: impl FnOnce(&Value, &Control) -> std::result::Result<Rendered, String>,
    ) -> std::result::Result<Lease, String> {
        // Start before validation and queue admission, never reset at ready/render.
        let received = Instant::now();
        let input = request.input()?;
        let key = JobKey {
            owner: Owner {
                scope: scope.into(),
                owner: request.owner_id.clone(),
            },
            request: request.request_id.clone(),
        };
        let control = Control {
            cancelled: Arc::new(AtomicBool::new(false)),
            deadline: received + Duration::from_millis(request.remaining_ms),
            unhealthy: self.unhealthy.clone(),
            cleanup_uncertain: self.cleanup_uncertain.clone(),
        };
        {
            let mut state = self.state.lock().map_err(|e| e.to_string())?;
            Self::reap(&mut state);
            if state.closing {
                return Err("Mermaid service is closing; new rendering is stopped".into());
            }
            if self.unhealthy.load(Ordering::Acquire) {
                return Err(
                    "Mermaid service stopped after a native failure; restart required".into(),
                );
            }
            if state.retired.contains(&key.owner) || state.seen.contains(&key) {
                return Err("Mermaid owner retired or request already cancelled/used".into());
            }
            if state.jobs.len() >= MAX_JOBS || state.seen.len() >= MAX_IDENTITIES {
                return Err("Mermaid native job/identity budget exceeded".into());
            }
            state.seen.insert(key.clone());
            state.jobs.insert(key.clone(), control.clone());
            while state.active {
                if let Err(error) = control.checkpoint() {
                    state.jobs.remove(&key);
                    return Err(error);
                }
                state = self
                    .wake
                    .wait_timeout(state, control.remaining().min(Duration::from_millis(20)))
                    .map_err(|e| e.to_string())?
                    .0;
            }
            if let Err(error) = control.checkpoint() {
                state.jobs.remove(&key);
                return Err(error);
            }
            if self.unhealthy.load(Ordering::Acquire) {
                state.jobs.remove(&key);
                return Err("Mermaid service stopped after a native failure".into());
            }
            // Reserve the maximum new PNG and decode pixels while old outputs
            // remain owned. Reject before starting another browser, not after
            // temporarily exceeding the aggregate old-plus-new budget.
            Self::reap(&mut state);
            if state.leases.len() >= MAX_LEASES
                || state.leases.values().map(|v| v.png.len()).sum::<usize>() + MAX_OUTPUT
                    > MAX_RETAINED_BYTES
                || state.leases.values().map(|v| v.pixels).sum::<u64>() + 16_777_216
                    > MAX_RETAINED_PIXELS
            {
                state.jobs.remove(&key);
                return Err("Mermaid native lease budget cannot reserve the next output".into());
            }
            state.active = true;
        }
        let rendered=std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            control.checkpoint()?;
            let rendered=backend(&input,&control)?;
            control.checkpoint()?;
            let metadata=json!({"width":rendered.width,"height":rendered.height,"pngBytes":rendered.png.len()});
            let info=png::validate_png(&metadata,&rendered.png).map_err(|e|e.to_string())?;
            control.checkpoint()?;
            Ok::<_,String>((rendered,info))
        })).unwrap_or_else(|_| {control.mark_cleanup_uncertain();Err("Mermaid backend panicked; native cleanup is uncertain".into())});
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        state.jobs.remove(&key);
        state.active = false;
        self.wake.notify_all();
        let (rendered, info) = rendered?;
        control.checkpoint()?;
        if state.retired.contains(&key.owner) {
            return Err("Mermaid owner retired before publication".into());
        }
        Self::reap(&mut state);
        let pixels = u64::from(rendered.width) * u64::from(rendered.height);
        if state.leases.len() >= MAX_LEASES
            || state.leases.values().map(|v| v.png.len()).sum::<usize>() + rendered.png.len()
                > MAX_RETAINED_BYTES
            || state.leases.values().map(|v| v.pixels).sum::<u64>() + pixels > MAX_RETAINED_PIXELS
        {
            return Err(
                "Mermaid native lease budget exceeded (old and new outputs counted)".into(),
            );
        }
        state.next_lease = state
            .next_lease
            .checked_add(1)
            .ok_or("Mermaid lease sequence exhausted")?;
        let lease_id = format!("mermaid-{}-{}", std::process::id(), state.next_lease);
        let result = Lease {
            lease_id: lease_id.clone(),
            request_id: request.request_id,
            owner_id: request.owner_id,
            png_base64: base64::engine::general_purpose::STANDARD.encode(&rendered.png),
            width: rendered.width,
            height: rendered.height,
            sha256: info["sha256"].as_str().unwrap_or_default().into(),
            engine: "12.2.0",
        };
        state.leases.insert(
            lease_id,
            Retained {
                owner: key.owner,
                request: key.request,
                png: rendered.png,
                pixels,
                expires: Instant::now() + LEASE_TTL,
            },
        );
        Ok(result)
    }
    fn reap(state: &mut State) {
        state
            .leases
            .retain(|_, lease| lease.expires > Instant::now());
    }
    pub fn cancel(
        &self,
        scope: &str,
        owner: &str,
        request: &str,
    ) -> std::result::Result<bool, String> {
        if !id(owner) || !id(request) {
            return Err("Invalid Mermaid cancellation identity".into());
        }
        let key = JobKey {
            owner: Owner {
                scope: scope.into(),
                owner: owner.into(),
            },
            request: request.into(),
        };
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.seen.len() >= MAX_IDENTITIES && !state.seen.contains(&key) {
            return Err("Mermaid cancellation identity budget exceeded".into());
        }
        state.seen.insert(key.clone());
        if let Some(control) = state.jobs.get(&key) {
            control.cancelled.store(true, Ordering::Release);
        }
        state
            .leases
            .retain(|_, lease| lease.owner != key.owner || lease.request != key.request);
        self.wake.notify_all();
        Ok(true)
    }
    pub fn release(
        &self,
        scope: &str,
        owner: &str,
        lease: &str,
    ) -> std::result::Result<bool, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        let matched = state
            .leases
            .get(lease)
            .is_some_and(|value| value.owner.scope == scope && value.owner.owner == owner);
        if matched {
            state.leases.remove(lease);
        }
        Ok(matched)
    }
    pub fn retire_owner(&self, scope: &str, owner: &str) -> std::result::Result<bool, String> {
        if !id(owner) {
            return Err("Invalid Mermaid owner".into());
        }
        let owner = Owner {
            scope: scope.into(),
            owner: owner.into(),
        };
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.retired.len() >= MAX_IDENTITIES && !state.retired.contains(&owner) {
            return Err("Mermaid owner identity budget exceeded".into());
        }
        state.retired.insert(owner.clone());
        for (key, control) in &state.jobs {
            if key.owner == owner {
                control.cancelled.store(true, Ordering::Release);
            }
        }
        state.leases.retain(|_, lease| lease.owner != owner);
        self.wake.notify_all();
        Ok(true)
    }
    fn close_admission(state: &mut State) {
        state.closing = true;
        if state.shutdown_deadline.is_none() {
            let now = Instant::now();
            state.shutdown_deadline = Some(
                state
                    .jobs
                    .values()
                    .map(|control| control.deadline)
                    .max()
                    .unwrap_or(now)
                    .max(now)
                    + SHUTDOWN_CLEANUP_ALLOWANCE,
            );
        }
        for control in state.jobs.values() {
            control.cancelled.store(true, Ordering::Release);
        }
        state.leases.clear();
    }
    pub fn stop_all(&self) {
        if let Ok(mut state) = self.state.lock() {
            Self::close_admission(&mut state);
        }
        self.wake.notify_all();
    }
    /// Stop admission under the same lock as render registration, cancel every
    /// owned job, and await its actual backend teardown before process exit.
    /// Repeated close attempts retain the first wait deadline. A later retry
    /// may succeed once a pending backend has settled; it cannot revive rendering.
    pub fn shutdown_and_wait(&self) -> std::result::Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        Self::close_admission(&mut state);
        self.wake.notify_all();
        let deadline = state
            .shutdown_deadline
            .expect("closed admission has a deadline");
        while !state.jobs.is_empty() || state.active {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Mermaid shutdown still has unsettled native jobs".into());
            }
            state = self
                .wake
                .wait_timeout(state, remaining.min(Duration::from_millis(20)))
                .map_err(|e| e.to_string())?
                .0;
        }
        drop(state);
        if self.cleanup_uncertain.load(Ordering::Acquire) {
            return Err("Mermaid native cleanup is uncertain; window must remain open".into());
        }
        #[cfg(windows)]
        audit::flush(Duration::from_secs(2))?;
        Ok(())
    }
}
impl Drop for Registry {
    fn drop(&mut self) {
        self.stop_all();
    }
}

/// Dispatch only before initializing Tauri; the child verifies its own token.
pub fn run_helper_if_requested() -> bool {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--milkup-fixed-mermaid-child") {
        return false;
    }
    #[cfg(windows)]
    {
        let outcome = if args.len() == 3 {
            engine::run(
                std::path::Path::new(&args[1]),
                std::path::Path::new(&args[2]),
            )
        } else {
            Err("Invalid fixed helper invocation".into())
        };
        if let Err(error) = outcome {
            eprintln!("Fixed Mermaid helper: {error}");
            std::process::exit(23);
        }
    }
    #[cfg(not(windows))]
    {
        std::process::exit(23);
    }
    #[allow(unreachable_code)]
    true
}
#[cfg(windows)]
pub fn render_native(input: &Value, control: &Control) -> std::result::Result<Rendered, String> {
    let render_entry_tick = ipc_observation::diagnostic_tick_ms();
    let remaining_at_entry = control.remaining().as_millis().min(u64::MAX as u128) as u64;
    control.checkpoint()?;
    let runtime = installed_runtime()?;
    let runtime_ready_tick = ipc_observation::diagnostic_tick_ms();
    let request_id = input["requestId"].as_str().unwrap_or_default();
    // The launcher reports admission only after CREATE_NEW establishes owned
    // native resources. Read-only preflight failures have nothing to tear down.
    let mut output = launcher::run(&runtime, input, control).map_err(|error| error.to_string())?;
    output.report["nativeDiagnosticTimeline"]["renderEntryTickMs"] = json!(render_entry_tick);
    output.report["nativeDiagnosticTimeline"]["runtimeReadyTickMs"] = json!(runtime_ready_tick);
    output.report["nativeDiagnosticTimeline"]["remainingAtRenderEntryMs"] =
        json!(remaining_at_entry);
    if audit::enabled() {
        audit::emit(&audit::finished(
            request_id,
            &output.report,
            &output.png,
            control.cancelled.load(Ordering::Acquire),
            control.remaining().is_zero(),
        ));
    }
    if audit::enabled() {
        audit::emit_diagnostic(&audit::native_diagnostics(request_id, &output.report));
    }
    if output.report["stopMatrixAfterThisCase"] == true {
        control.mark_native_failure(request_id, &output.report);
        // Stopping the service never makes a failed protocol frame publishable,
        // even if a future launcher bug accidentally returns an ok metadata tag.
        return Err(output.metadata["message"]
            .as_str()
            .unwrap_or("Fixed Mermaid render stopped after a native failure")
            .into());
    }
    if output.metadata["status"] != "ok" {
        return Err(output.metadata["message"]
            .as_str()
            .unwrap_or("Fixed Mermaid render failed")
            .into());
    }
    Ok(Rendered {
        width: output.metadata["width"]
            .as_u64()
            .ok_or("Missing PNG width")? as u32,
        height: output.metadata["height"]
            .as_u64()
            .ok_or("Missing PNG height")? as u32,
        png: output.png,
    })
}
#[cfg(windows)]
fn installed_runtime() -> std::result::Result<std::path::PathBuf, String> {
    // Existing Evergreen installations only. No caller-supplied path or Fixed
    // Runtime override, installation, registry mutation or download fallback.
    let mut candidates = Vec::new();
    for name in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        let Some(root) = std::env::var_os(name) else {
            continue;
        };
        let root = std::path::PathBuf::from(root).join("Microsoft/EdgeWebView/Application");
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let version: Option<Vec<u32>> = name.split('.').map(|p| p.parse().ok()).collect();
                if let Some(version) = version.filter(|v| v.len() == 4) {
                    if entry.path().join("msedgewebview2.exe").is_file() {
                        candidates.push((version, entry.path()));
                    }
                }
            }
        }
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    candidates
        .pop()
        .map(|(_, path)| path)
        .ok_or("Existing Evergreen WebView2 Runtime unavailable".into())
}
#[cfg(test)]
mod tests;

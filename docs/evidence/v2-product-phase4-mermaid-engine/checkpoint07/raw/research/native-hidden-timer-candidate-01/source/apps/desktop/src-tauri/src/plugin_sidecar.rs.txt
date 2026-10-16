//! Native ownership of a sidecar and its document-render deadline.
//! The WebView event loop never arbitrates completion versus timeout.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

const RENDER_PROTOCOL: &str = "milkup.plugin.document-render.v1";
// Keep identical to DOCUMENT_PRESENTATION_LIMITS.timeoutMs. This is not configurable.
const RENDER_DEADLINE: Duration = Duration::from_millis(2000);
static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarEvent {
    pub plugin_id: String,
    pub instance_id: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStarted {
    pub instance_id: String,
}

type Emit = Arc<dyn Fn(SidecarEvent) + Send + Sync>;

#[derive(Default)]
pub struct SidecarRegistry(Mutex<HashMap<String, Arc<Instance>>>);

struct Instance {
    plugin_id: String,
    id: String,
    child: Mutex<Child>,
    // Blocking pipe I/O MUST NOT own either the registry or control mutex.
    stdin: Mutex<ChildStdin>,
    control: Mutex<Control>,
    wake: Condvar,
    emit: Emit,
}

#[derive(Default)]
struct Control {
    stopped: bool,
    active: Option<Render>,
}

struct Render {
    id: String,
    deadline: Instant,
}

impl SidecarRegistry {
    pub fn start(
        &self,
        plugin_id: String,
        mut command: Command,
        emit: Emit,
    ) -> Result<SidecarStarted, String> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let stdin = child.stdin.take().expect("piped sidecar stdin");
        let stdout = child.stdout.take().expect("piped sidecar stdout");
        let id = format!("sidecar_{}", NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed));
        let instance = Arc::new(Instance {
            plugin_id: plugin_id.clone(),
            id: id.clone(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            control: Mutex::new(Control::default()),
            wake: Condvar::new(),
            emit,
        });
        let previous = self
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .insert(plugin_id, instance.clone());
        if let Some(previous) = previous {
            if let Err(error) = previous.stop() {
                let _ = self.stop(&instance.plugin_id, &id);
                return Err(error);
            }
        }
        let reader_instance = instance.clone();
        thread::spawn(move || {
            // Existing line transport retained; global stdout quotas are separate work.
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Ok(message) = serde_json::from_str::<Value>(&line) {
                    reader_instance.receive(message);
                }
            }
            reader_instance.fail("Plugin sidecar stdout closed".into());
        });
        thread::spawn(move || instance.watch_deadline());
        Ok(SidecarStarted { instance_id: id })
    }

    pub async fn send(
        &self,
        plugin_id: &str,
        instance_id: &str,
        message: Value,
    ) -> Result<(), String> {
        let instance = self.get(plugin_id, instance_id)?;
        tauri::async_runtime::spawn_blocking(move || instance.send(message))
            .await
            .map_err(|error| error.to_string())?
    }

    pub fn stop(&self, plugin_id: &str, instance_id: &str) -> Result<(), String> {
        let instance = {
            let mut instances = self.0.lock().map_err(|error| error.to_string())?;
            if instances
                .get(plugin_id)
                .is_some_and(|instance| instance.id == instance_id)
            {
                instances.remove(plugin_id)
            } else {
                None
            }
        };
        if let Some(instance) = instance {
            instance.stop()?;
        }
        Ok(())
    }

    fn get(&self, plugin_id: &str, instance_id: &str) -> Result<Arc<Instance>, String> {
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .get(plugin_id)
            .filter(|instance| instance.id == instance_id)
            .cloned()
            .ok_or_else(|| "Unknown plugin sidecar instance".into())
    }
}

impl Drop for SidecarRegistry {
    fn drop(&mut self) {
        if let Ok(instances) = self.0.get_mut() {
            for (_, instance) in instances.drain() {
                let _ = instance.stop();
            }
        }
    }
}

impl Instance {
    fn event(&self, kind: &'static str) -> SidecarEvent {
        SidecarEvent {
            plugin_id: self.plugin_id.clone(),
            instance_id: self.id.clone(),
            kind,
            message: None,
            request_id: None,
            error: None,
        }
    }

    fn send(&self, message: Value) -> Result<(), String> {
        {
            let mut control = self.control.lock().map_err(|error| error.to_string())?;
            if control.stopped {
                return Err("Plugin sidecar instance was revoked".into());
            }
            if message.get("protocol").and_then(Value::as_str) == Some(RENDER_PROTOCOL)
                && message.get("type").and_then(Value::as_str) == Some("render")
            {
                let id = valid_id(&message).ok_or("Invalid document render request ID")?;
                if control.active.is_some() {
                    return Err("Plugin document renderer is busy".into());
                }
                control.active = Some(Render {
                    id: id.into(),
                    deadline: Instant::now() + RENDER_DEADLINE,
                });
                self.wake.notify_one();
            }
            // A cancel is cooperative and never clears or extends the deadline.
        }
        let result = (|| {
            let mut stdin = self.stdin.lock().map_err(|error| error.to_string())?;
            if self
                .control
                .lock()
                .map_err(|error| error.to_string())?
                .stopped
            {
                return Err("Plugin sidecar instance was revoked".into());
            }
            serde_json::to_writer(&mut *stdin, &message).map_err(|error| error.to_string())?;
            stdin.write_all(b"\n").map_err(|error| error.to_string())?;
            stdin.flush().map_err(|error| error.to_string())
        })();
        if let Err(error) = &result {
            self.fail(error.clone());
        }
        result
    }

    fn receive(&self, message: Value) {
        let expired = {
            let Ok(mut control) = self.control.lock() else {
                return;
            };
            if control.stopped {
                return;
            }
            if let Some(active) = &control.active {
                if Instant::now() >= active.deadline {
                    let id = active.id.clone();
                    control.stopped = true;
                    control.active = None;
                    Some(id)
                } else {
                    if is_result(&message, &active.id) {
                        control.active = None;
                        self.wake.notify_one();
                    }
                    None
                }
            } else {
                None
            }
        };
        if let Some(id) = expired {
            self.finish_timeout(id);
            return;
        }
        let mut event = self.event("message");
        event.message = Some(message);
        (self.emit)(event);
    }

    fn watch_deadline(&self) {
        let Ok(mut control) = self.control.lock() else {
            return;
        };
        loop {
            if control.stopped {
                return;
            }
            if let Some(active) = &control.active {
                let now = Instant::now();
                if now >= active.deadline {
                    let id = active.id.clone();
                    control.stopped = true;
                    control.active = None;
                    drop(control);
                    self.finish_timeout(id);
                    return;
                }
                let remaining = active.deadline - now;
                let Ok((next, _)) = self.wake.wait_timeout(control, remaining) else {
                    return;
                };
                control = next;
            } else {
                let Ok(next) = self.wake.wait(control) else {
                    return;
                };
                control = next;
            }
        }
    }

    fn finish_timeout(&self, request_id: String) {
        self.wake.notify_all();
        let mut event = self.event("document-render-timeout");
        event.request_id = Some(request_id);
        if let Err(error) = self.kill() {
            event.kind = "error";
            event.error = Some(error);
        }
        // The child is killed/reaped before the UI can receive the timeout decision.
        (self.emit)(event);
    }

    fn fail(&self, error: String) {
        let Ok(mut control) = self.control.lock() else {
            return;
        };
        if control.stopped {
            return;
        }
        control.stopped = true;
        control.active = None;
        drop(control);
        self.wake.notify_all();
        let mut event = self.event("error");
        event.error = Some(match self.kill() {
            Ok(()) => error,
            Err(kill_error) => format!("{error}; {kill_error}"),
        });
        (self.emit)(event);
    }

    fn stop(&self) -> Result<(), String> {
        let mut control = self.control.lock().map_err(|error| error.to_string())?;
        control.stopped = true;
        control.active = None;
        drop(control);
        self.wake.notify_all();
        self.kill()
    }

    fn kill(&self) -> Result<(), String> {
        let mut child = self.child.lock().map_err(|error| error.to_string())?;
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(());
        }
        child
            .kill()
            .map_err(|error| format!("Could not stop plugin sidecar: {error}"))?;
        child.wait().map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn valid_id(message: &Value) -> Option<&str> {
    message.get("id").and_then(Value::as_str).filter(|id| {
        !id.is_empty()
            && id.len() <= 80
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

fn is_result(message: &Value, request_id: &str) -> bool {
    let Some(object) = message.as_object() else {
        return false;
    };
    if object
        .keys()
        .any(|key| !["protocol", "type", "id", "ok", "value", "error"].contains(&key.as_str()))
        || message.get("protocol").and_then(Value::as_str) != Some(RENDER_PROTOCOL)
        || message.get("type").and_then(Value::as_str) != Some("result")
        || valid_id(message) != Some(request_id)
    {
        return false;
    }
    match message.get("ok").and_then(Value::as_bool) {
        Some(true) => object.contains_key("value") && !object.contains_key("error"),
        Some(false) => {
            !object.contains_key("value")
                && message
                    .get("error")
                    .and_then(Value::as_str)
                    .is_some_and(|error| {
                        [
                            "invalid-input",
                            "invalid-output",
                            "revoked",
                            "aborted",
                            "busy",
                            "timeout",
                            "unavailable",
                        ]
                        .contains(&error)
                    })
        }
        None => false,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};

    // Real owned processes; no mocked clock or externally managed server.
    const FIXTURE: &str = r#"
import sys,json,time
mode=sys.argv[1]
print(json.dumps({'ready':True}),flush=True)
if mode=='blocked':
    while True: time.sleep(1)
for line in sys.stdin:
    value=json.loads(line)
    if value.get('type')!='render':
        print(json.dumps({'echo':value}),flush=True)
        continue
    if mode=='exit': sys.exit(3)
    if mode=='busy':
        while True: pass
    if mode=='forged':
        print(json.dumps({'protocol':'milkup.plugin.document-render.v1','type':'result','id':'wrong','ok':True,'value':{}}),flush=True)
        print(json.dumps({'kind':'document-render-timeout','requestId':value['id']}),flush=True)
        print(json.dumps({'protocol':'milkup.plugin.document-render.v1','type':'result','id':value['id'],'ok':False,'error':['timeout']}),flush=True)
        print(json.dumps({'protocol':'milkup.plugin.document-render.v1','type':'result','id':value['id'],'ok':True,'value':{},'extra':True}),flush=True)
        continue
    if mode=='late': time.sleep(2.2)
    print(json.dumps({'protocol':'milkup.plugin.document-render.v1','type':'result','id':value['id'],'ok':True,'value':{'nodes':[]}}),flush=True)
"#;

    fn start(
        registry: &SidecarRegistry,
        plugin: &str,
        mode: &str,
    ) -> (String, Receiver<SidecarEvent>) {
        let (tx, rx) = channel();
        let mut command = Command::new("python3");
        command.args(["-u", "-c", FIXTURE, mode]);
        let started = registry
            .start(
                plugin.into(),
                command,
                Arc::new(move |event| {
                    let _ = tx.send(event);
                }),
            )
            .unwrap();
        let ready = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("fixture ready");
        assert_eq!(ready.message, Some(serde_json::json!({"ready":true})));
        (started.instance_id, rx)
    }

    fn render(id: &str) -> Value {
        serde_json::json!({"protocol":RENDER_PROTOCOL,"type":"render","id":id,"payload":{}})
    }

    fn await_timeout(rx: &Receiver<SidecarEvent>) -> SidecarEvent {
        loop {
            let event = rx
                .recv_timeout(Duration::from_secs(5))
                .expect("native terminal event");
            if event.kind != "message" {
                return event;
            }
        }
    }

    #[test]
    fn fast_result_survives_ui_delivery_stall_and_keeps_process_alive() {
        let registry = SidecarRegistry::default();
        let (id, rx) = start(&registry, "fast", "fast");
        let instance = registry.get("fast", &id).unwrap();
        instance.send(render("render_1")).unwrap();
        // Native stdout is drained even while the consumer does not process events.
        thread::sleep(Duration::from_millis(2400));
        let event = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(event.kind, "message");
        assert!(is_result(event.message.as_ref().unwrap(), "render_1"));
        assert!(
            rx.try_recv().is_err(),
            "no false timeout during stalled UI delivery"
        );
        assert!(instance.child.lock().unwrap().try_wait().unwrap().is_none());
        instance.send(render("render_2")).unwrap();
        assert!(is_result(
            rx.recv_timeout(Duration::from_secs(1))
                .unwrap()
                .message
                .as_ref()
                .unwrap(),
            "render_2"
        ));
    }

    #[test]
    fn busy_process_is_reaped_before_timeout_notification_even_without_ui_polling() {
        let registry = SidecarRegistry::default();
        let (id, rx) = start(&registry, "busy", "busy");
        let instance = registry.get("busy", &id).unwrap();
        let began = Instant::now();
        instance.send(render("render_1")).unwrap();
        let event = await_timeout(&rx);
        assert_eq!(event.kind, "document-render-timeout");
        assert_eq!(event.request_id.as_deref(), Some("render_1"));
        assert!(began.elapsed() >= RENDER_DEADLINE);
        assert!(began.elapsed() < Duration::from_secs(4));
        assert!(instance.child.lock().unwrap().try_wait().unwrap().is_some());
        assert!(instance.send(render("render_2")).is_err());
    }

    #[test]
    fn blocked_stdin_cannot_block_watchdog_or_another_process() {
        let registry = SidecarRegistry::default();
        let (id, rx) = start(&registry, "blocked", "blocked");
        let instance = registry.get("blocked", &id).unwrap();
        let writer = instance.clone();
        let blocked = thread::spawn(move || {
            writer.send(serde_json::json!({"fill":"x".repeat(2 * 1024 * 1024)}))
        });
        // Wait until the first writer owns the pipe mutex, not a guessed sleep.
        let waiting = Instant::now();
        while instance.stdin.try_lock().is_ok() {
            assert!(waiting.elapsed() < Duration::from_secs(2));
            thread::yield_now();
        }
        let renderer = instance.clone();
        let pending = thread::spawn(move || renderer.send(render("render_1")));
        let (other_id, other_rx) = start(&registry, "other", "fast");
        registry
            .get("other", &other_id)
            .unwrap()
            .send(render("render_1"))
            .unwrap();
        assert_eq!(
            other_rx.recv_timeout(Duration::from_secs(1)).unwrap().kind,
            "message"
        );
        let event = await_timeout(&rx);
        assert_eq!(event.kind, "document-render-timeout");
        assert!(blocked.join().unwrap().is_err());
        assert!(pending.join().unwrap().is_err());
        assert!(instance.child.lock().unwrap().try_wait().unwrap().is_some());
    }

    #[test]
    fn cancellation_and_forged_messages_do_not_clear_or_extend_deadline() {
        let registry = SidecarRegistry::default();
        let (id, rx) = start(&registry, "forged", "forged");
        let instance = registry.get("forged", &id).unwrap();
        let began = Instant::now();
        instance.send(render("render_1")).unwrap();
        let wrong = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(wrong.kind, "message");
        let forged = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(
            forged.kind, "message",
            "child cannot author trusted outer control"
        );
        instance
            .send(serde_json::json!({"protocol":RENDER_PROTOCOL,"type":"cancel","id":"render_1"}))
            .unwrap();
        assert_eq!(await_timeout(&rx).kind, "document-render-timeout");
        assert!(began.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn old_stop_and_old_stdout_cannot_reach_replacement_instance() {
        let registry = SidecarRegistry::default();
        let (old_id, old_rx) = start(&registry, "same", "busy");
        let old = registry.get("same", &old_id).unwrap();
        old.send(render("render_1")).unwrap();
        let (new_id, new_rx) = start(&registry, "same", "fast");
        assert_ne!(old_id, new_id);
        registry.stop("same", &old_id).unwrap();
        old.receive(serde_json::json!({"late":true}));
        assert!(old_rx.try_recv().is_err());
        assert!(registry.get("same", &old_id).is_err());
        let current = registry.get("same", &new_id).unwrap();
        current.send(render("render_1")).unwrap();
        assert_eq!(
            new_rx
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .instance_id,
            new_id
        );
        assert!(current.child.lock().unwrap().try_wait().unwrap().is_none());
    }

    #[test]
    fn result_after_native_deadline_cannot_win_the_race() {
        let registry = SidecarRegistry::default();
        let (id, rx) = start(&registry, "late", "late");
        registry
            .get("late", &id)
            .unwrap()
            .send(render("render_1"))
            .unwrap();
        assert_eq!(await_timeout(&rx).kind, "document-render-timeout");
        thread::sleep(Duration::from_millis(300));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn process_exit_revokes_pending_work_without_waiting_for_deadline() {
        let registry = SidecarRegistry::default();
        let (id, rx) = start(&registry, "exit", "exit");
        let instance = registry.get("exit", &id).unwrap();
        instance.send(render("render_1")).unwrap();
        let event = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(event.kind, "error");
        assert!(instance.send(render("render_2")).is_err());
        assert!(instance.child.lock().unwrap().try_wait().unwrap().is_some());
    }

    #[test]
    fn result_envelope_matches_the_frontend_rpc_validation() {
        let valid = serde_json::json!({"protocol":RENDER_PROTOCOL,"type":"result","id":"r1","ok":false,"error":"aborted"});
        assert!(is_result(&valid, "r1"));
        assert!(!is_result(
            &serde_json::json!({"protocol":RENDER_PROTOCOL,"type":"result","id":"r1","ok":true}),
            "r1"
        ));
        for error in [
            serde_json::json!(["timeout"]),
            serde_json::json!({"toString":"timeout"}),
            Value::Null,
            serde_json::json!("unknown"),
        ] {
            let mut message = valid.clone();
            message["error"] = error;
            assert!(!is_result(&message, "r1"));
        }
        for (key, value) in [
            ("ok", serde_json::json!(1)),
            ("value", Value::Null),
            ("extra", Value::Null),
            ("id", serde_json::json!("r2")),
        ] {
            let mut message = valid.clone();
            message[key] = value;
            assert!(!is_result(&message, "r1"));
        }
    }
}

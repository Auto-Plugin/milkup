//! Opt-in metadata only. The writer never receives Mermaid text or renders.
use serde_json::Value;
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::Duration;

enum Message {
    Line(String),
    Barrier(mpsc::SyncSender<bool>),
}
pub struct Writer {
    sender: mpsc::SyncSender<Message>,
    failed: Arc<AtomicBool>,
}
impl Writer {
    pub fn start() -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel::<Message>(32);
        let failed = Arc::new(AtomicBool::new(false));
        let failure = failed.clone();
        std::thread::Builder::new()
            .name("frontend-mermaid-audit".into())
            .spawn(move || {
                let mut output = std::io::stderr();
                for message in receiver {
                    match message {
                        Message::Line(line) => {
                            if writeln!(output, "MILKUP_MERMAID_FRONTEND_AUDIT {line}").is_err() {
                                failure.store(true, Ordering::Release);
                            }
                        }
                        Message::Barrier(reply) => {
                            if output.flush().is_err() {
                                failure.store(true, Ordering::Release);
                            }
                            let _ = reply.try_send(!failure.load(Ordering::Acquire));
                        }
                    }
                }
            })
            .map_err(|_| "Frontend audit writer unavailable")?;
        Ok(Self { sender, failed })
    }
    pub fn emit(&self, value: &Value) -> Result<(), String> {
        let mut event = value.clone();
        event["timestampUnixMs"] = serde_json::json!(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Audit clock unavailable")?
            .as_millis() as u64);
        event["productPid"] = serde_json::json!(std::process::id());
        event["renderer"] = serde_json::json!("frontend-mermaid-12.2.0");
        let line = event.to_string();
        if line.len() > 2048 || self.sender.try_send(Message::Line(line)).is_err() {
            self.failed.store(true, Ordering::Release);
        }
        self.check()
    }
    pub fn check(&self) -> Result<(), String> {
        if self.failed.load(Ordering::Acquire) {
            Err("Frontend audit is incomplete".into())
        } else {
            Ok(())
        }
    }
    pub fn flush(&self) -> Result<(), String> {
        let (sender, receiver) = mpsc::sync_channel(1);
        self.sender
            .try_send(Message::Barrier(sender))
            .map_err(|_| "Frontend audit barrier unavailable")?;
        match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(true) => self.check(),
            _ => Err("Frontend audit flush was not proven".into()),
        }
    }
}

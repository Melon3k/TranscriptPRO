use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub level: String,
    pub source: String,
    pub message: String,
    pub timestamp: u64,
}

pub fn emit(app: &AppHandle, level: &str, source: &str, message: impl Into<String>) {
    let entry = LogEntry {
        level: level.into(),
        source: source.into(),
        message: message.into(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    };
    let _ = app.emit("app-log", entry);
}

pub fn info(app: &AppHandle, source: &str, message: impl Into<String>) {
    emit(app, "info", source, message);
}

pub fn error(app: &AppHandle, source: &str, message: impl Into<String>) {
    emit(app, "error", source, message);
}

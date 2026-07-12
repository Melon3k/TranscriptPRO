use crate::logger;
use crate::subtitle::types::{AppError, TranslationProgress};
use crate::LocalLlm;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// TranslateGemma 4B instruction-tuned, Q4_K_M quant, fetched from an ungated
/// community mirror (Google's official repos are license-gated, so they can't be
/// downloaded anonymously from inside the app).
pub const MODEL_FILE: &str = "translategemma-4b-it.Q4_K_M.gguf";
pub const MODEL_URL: &str = "https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf";
/// Pinned size and SHA-256 of the exact GGUF this app targets. If the mirror ever
/// republishes the file, the download fails loudly instead of silently switching
/// to an unvetted model.
pub const MODEL_SIZE_BYTES: u64 = 2_489_909_760;
pub const MODEL_SHA256: &str = "81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330";

/// TranslateGemma was tuned and evaluated on ~2K-token inputs; a larger window
/// costs RAM without improving quality (model card: "total input context of 2K").
const CTX_SIZE: &str = "2048";
/// How long to wait for llama-server to load the model before giving up.
const STARTUP_TIMEOUT_SECS: u64 = 120;

pub fn model_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::Other(e.to_string()))?
        .join("models")
        .join(MODEL_FILE))
}

/// App language code → (English name, ISO code) as TranslateGemma's prompt format
/// expects. The model has no auto-detect, so only codes listed here are usable.
fn lang(code: &str) -> Result<(&'static str, &'static str), AppError> {
    Ok(match code.to_ascii_uppercase().as_str() {
        "EN" => ("English", "en"),
        "PL" => ("Polish", "pl"),
        "DE" => ("German", "de"),
        "FR" => ("French", "fr"),
        "ES" => ("Spanish", "es"),
        "IT" => ("Italian", "it"),
        "PT" => ("Portuguese", "pt"),
        "NL" => ("Dutch", "nl"),
        "JA" => ("Japanese", "ja"),
        "KO" => ("Korean", "ko"),
        "ZH" => ("Chinese", "zh"),
        "RU" => ("Russian", "ru"),
        "UK" => ("Ukrainian", "uk"),
        other => {
            return Err(AppError::TranslationApiError(format!(
                "The local model does not support language '{}'",
                other
            )))
        }
    })
}

fn free_port() -> Result<u16, AppError> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| AppError::TranslationApiError(format!("No free local port: {}", e)))
}

async fn health_ok(client: &reqwest::Client, port: u16) -> bool {
    client
        .get(format!("http://127.0.0.1:{}/health", port))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Return the port of a healthy llama-server, starting one if needed. The server is
/// kept warm across translations (model stays loaded) and killed on app exit.
async fn ensure_server(
    app: &AppHandle,
    llm: &LocalLlm,
    client: &reqwest::Client,
) -> Result<u16, AppError> {
    // One startup at a time — a concurrent caller waits here, then finds the
    // healthy server on the fast path instead of spawning a duplicate.
    let _startup = llm.startup.lock().await;

    let existing = llm.port.lock().ok().and_then(|g| *g);
    if let Some(port) = existing {
        if health_ok(client, port).await {
            return Ok(port);
        }
        // Server died or got stuck — clear it and start fresh.
        if let Ok(mut g) = llm.child.lock() {
            if let Some(child) = g.take() {
                let _ = child.kill();
            }
        }
        if let Ok(mut g) = llm.port.lock() {
            *g = None;
        }
    }

    let model = model_path(app)?;
    if !model.exists() {
        return Err(AppError::ModelNotFound("TranslateGemma (local translation)".into()));
    }

    let port = free_port()?;
    logger::info(
        app,
        "translate",
        format!("Starting local translation server (port {})", port),
    );

    let sidecar = app.shell().sidecar("llama-server").map_err(|e| {
        AppError::TranslationApiError(format!("llama-server sidecar unavailable: {}", e))
    })?;
    let (mut rx, child) = sidecar
        .args([
            "-m",
            &model.to_string_lossy(),
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "-c",
            CTX_SIZE,
            "-ngl",
            "99",
            "--no-webui",
            // TranslateGemma's GGUF ships a chat template llama.cpp can't parse
            // (upstream #20305) and the server aborts on it at startup. We build
            // prompts by hand and only use /completion, so jinja is dead weight.
            "--no-jinja",
        ])
        .spawn()
        .map_err(|e: tauri_plugin_shell::Error| {
            AppError::TranslationApiError(format!("Failed to start llama-server: {}", e))
        })?;

    if let Ok(mut g) = llm.child.lock() {
        *g = Some(child);
    }
    if let Ok(mut g) = llm.port.lock() {
        *g = Some(port);
    }

    // Drain server output so the event channel never backs up (llama-server logs
    // every request). Keep a stderr tail + died flag for a useful startup error.
    let died = Arc::new(AtomicBool::new(false));
    let stderr_tail = Arc::new(std::sync::Mutex::new(String::new()));
    {
        let died = died.clone();
        let stderr_tail = stderr_tail.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                        if let Ok(mut tail) = stderr_tail.lock() {
                            tail.push_str(&String::from_utf8_lossy(&bytes));
                            let len = tail.len();
                            if len > 600 {
                                *tail = tail.split_off(len - 600);
                            }
                        }
                    }
                    CommandEvent::Terminated(_) => died.store(true, Ordering::Relaxed),
                    _ => {}
                }
            }
        });
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECS);
    while std::time::Instant::now() < deadline && !died.load(Ordering::Relaxed) {
        if health_ok(client, port).await {
            logger::info(app, "translate", "Local translation server ready");
            return Ok(port);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // Startup failed — clean up and surface the tail of the server log.
    if let Ok(mut g) = llm.child.lock() {
        if let Some(child) = g.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut g) = llm.port.lock() {
        *g = None;
    }
    let tail = stderr_tail.lock().map(|t| t.clone()).unwrap_or_default();
    logger::error(app, "translate", format!("llama-server failed to start: {}", tail));
    Err(AppError::TranslationApiError(format!(
        "Local translation server failed to start: {}",
        crate::translation::truncate_chars(tail.trim(), 200)
    )))
}

#[derive(Debug, Deserialize)]
struct CompletionResponse {
    content: String,
}

/// Translate texts with the local TranslateGemma model via llama-server.
/// One request per subtitle cue: output stays perfectly aligned with input (no
/// batch-parsing risk), internal newlines survive, and llama-server's prompt
/// cache absorbs the repeated instruction prefix.
pub async fn translate(
    app: &AppHandle,
    llm: &LocalLlm,
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    cancel: &AtomicBool,
    on_progress: &Channel<TranslationProgress>,
) -> Result<Vec<String>, AppError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let src = source_lang.ok_or_else(|| {
        AppError::TranslationApiError(
            "Source language is required for local translation (TranslateGemma has no auto-detect)"
                .into(),
        )
    })?;
    let (src_name, src_iso) = lang(src)?;
    let (tgt_name, tgt_iso) = lang(target_lang)?;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        // One cue on a slow, GPU-less CPU can legitimately take a while.
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("HTTP client error: {}", e))
        })?;

    let port = ensure_server(app, llm, &client).await?;
    let url = format!("http://127.0.0.1:{}/completion", port);

    let mut out: Vec<String> = Vec::with_capacity(texts.len());
    for text in texts {
        // Cancelled — return what's translated so far (partial), like the cloud providers.
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if text.trim().is_empty() {
            out.push(text.clone());
            continue;
        }

        // The plain-text prompt from the TranslateGemma tech report (Fig. 3), wrapped
        // in Gemma turn markers — the GGUF chat template is unusable (see above).
        let prompt = format!(
            "<start_of_turn>user\nYou are a professional {src_name} ({src_iso}) to {tgt_name} ({tgt_iso}) translator. Produce only the {tgt_name} translation, without any additional explanations or commentary. Please translate the following {src_name} text into {tgt_name}:\n\n\n{text}<end_of_turn>\n<start_of_turn>model\n"
        );
        // Generous output budget relative to the cue length; cues are short, so the
        // cap only guards against runaway generation.
        let n_predict = (text.chars().count() as u64 / 2 + 64).min(768);

        let body = serde_json::json!({
            "prompt": prompt,
            "n_predict": n_predict,
            "temperature": 0,
            "cache_prompt": true,
            "stop": ["<end_of_turn>"],
        });

        let response = client.post(&url).json(&body).send().await.map_err(
            |e: reqwest::Error| {
                AppError::TranslationApiError(format!("Local translation request failed: {}", e))
            },
        )?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            return Err(AppError::TranslationApiError(format!(
                "Local translation server error {}: {}",
                status,
                crate::translation::truncate_chars(&body_text, 200)
            )));
        }

        let parsed: CompletionResponse = response.json().await.map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("Local translation parse error: {}", e))
        })?;

        out.push(parsed.content.trim().to_string());
        let _ = on_progress.send(TranslationProgress {
            done: out.len() as u32,
            total: texts.len() as u32,
        });
    }

    Ok(out)
}

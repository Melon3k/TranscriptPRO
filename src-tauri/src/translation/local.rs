use crate::logger;
use crate::subtitle::types::{AppError, TranslationProgress};
use crate::translation::TranslateOutcome;
use crate::LocalLlm;
use aes_gcm::aead::rand_core::RngCore;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
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
/// Shut the warm server down after this long with no translation, to free the
/// ~2.5 GB the loaded model holds. A new translation just restarts it.
const IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Random bearer token, regenerated per server start. llama-server binds only
/// 127.0.0.1, but with no auth any other local process (or a malicious page in
/// the user's browser POSTing to the port) could drive the model; the token
/// closes that. Passed via the LLAMA_API_KEY env var, not argv, so it doesn't
/// show up in `ps`.
fn gen_token() -> String {
    let mut b = [0u8; 24];
    aes_gcm::aead::OsRng.fill_bytes(&mut b);
    hex::encode(b)
}

fn touch_last_used(llm: &LocalLlm) {
    if let Ok(mut g) = llm.last_used.lock() {
        *g = Some(Instant::now());
    }
}

/// Resolves as soon as the cancel flag is set. Used to race against an in-flight
/// request so Cancel takes effect promptly instead of waiting out the 300 s timeout.
async fn wait_for_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub fn model_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::Other(e.to_string()))?
        .join("models")
        .join(MODEL_FILE))
}

// ── Crash-orphan reaping ──────────────────────────────────────────────────────
// Graceful quit kills the sidecar via kill_local_llm; a hard kill / crash of the
// app orphans the ~2.5 GB server. We record the server's PID in a file on spawn
// and reap it at next startup — but only after confirming the PID still belongs
// to a llama-server (guard against PID reuse handing us an unrelated process).

fn pidfile_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("llama-server.pid"))
}

fn write_pidfile(app: &AppHandle, pid: u32) {
    if let Some(p) = pidfile_path(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&p, pid.to_string());
    }
}

pub fn remove_pidfile(app: &AppHandle) {
    if let Some(p) = pidfile_path(app) {
        let _ = std::fs::remove_file(p);
    }
}

/// True if `pid` is a live process that is *our* llama-server, not some other
/// program that merely happens to hold this PID after reuse. On unix we match the
/// model-file name in the full command line (`ps -o command=` shows args), which is
/// app-specific enough to not hit a developer's own llama.cpp. On Windows tasklist
/// only exposes the image name, so we match the target-triple-suffixed sidecar exe
/// name (still narrower than a bare "llama-server").
fn pid_is_llama_server(pid: u32) -> bool {
    #[cfg(unix)]
    {
        std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(MODEL_FILE))
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .to_lowercase()
                    .contains("llama-server-")
            })
            .unwrap_or(false)
    }
}

/// Reap a llama-server orphaned by a previous hard-killed/crashed session. Runs
/// once at startup (before any translation), so it never races a live server.
pub fn cleanup_stale_server(app: &AppHandle) {
    let Some(p) = pidfile_path(app) else { return };
    let Ok(contents) = std::fs::read_to_string(&p) else { return };
    let _ = std::fs::remove_file(&p);
    let Ok(pid) = contents.trim().parse::<u32>() else { return };
    if !pid_is_llama_server(pid) {
        return; // dead already, or the PID was recycled by something else
    }
    #[cfg(unix)]
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status();
    logger::info(app, "translate", "Reaped an orphaned local translation server");
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

async fn health_ok(client: &reqwest::Client, port: u16, token: &str) -> bool {
    client
        .get(format!("http://127.0.0.1:{}/health", port))
        .bearer_auth(token)
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Background task: once the warm server has sat unused past IDLE_TIMEOUT, kill it
/// and free the model. Exits early if the server it was watching was already
/// replaced (port changed) or gone.
fn spawn_idle_watchdog(app: &AppHandle, port: u16) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let Some(llm) = app.try_state::<LocalLlm>() else { return };
            // Superseded by a newer server (or already shut down) — stop watching.
            if llm.port.lock().ok().and_then(|g| *g) != Some(port) {
                return;
            }
            let idle = llm
                .last_used
                .lock()
                .ok()
                .and_then(|g| *g)
                .map(|t| t.elapsed())
                .unwrap_or(Duration::ZERO);
            if idle >= IDLE_TIMEOUT {
                if let Ok(mut g) = llm.child.lock() {
                    if let Some(child) = g.take() {
                        let _ = child.kill();
                    }
                }
                if let Ok(mut g) = llm.port.lock() {
                    *g = None;
                }
                if let Ok(mut g) = llm.token.lock() {
                    *g = None;
                }
                remove_pidfile(&app);
                logger::info(&app, "translate", "Local translation server shut down (idle)");
                return;
            }
        }
    });
}

/// Return the (port, token) of a healthy llama-server, starting one if needed. The
/// server is kept warm across translations (model stays loaded), shut down when
/// idle, and killed on app exit.
async fn ensure_server(
    app: &AppHandle,
    llm: &LocalLlm,
    client: &reqwest::Client,
    cancel: &AtomicBool,
) -> Result<(u16, String), AppError> {
    // One startup at a time — a concurrent caller waits here, then finds the
    // healthy server on the fast path instead of spawning a duplicate.
    let _startup = llm.startup.lock().await;

    let existing = llm.port.lock().ok().and_then(|g| *g);
    let existing_token = llm.token.lock().ok().and_then(|g| g.clone());
    if let (Some(port), Some(token)) = (existing, existing_token) {
        if health_ok(client, port, &token).await {
            return Ok((port, token));
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
        if let Ok(mut g) = llm.token.lock() {
            *g = None;
        }
    }

    let model = model_path(app)?;
    if !model.exists() {
        return Err(AppError::ModelNotFound("TranslateGemma (local translation)".into()));
    }

    let port = free_port()?;
    let token = gen_token();
    logger::info(
        app,
        "translate",
        format!("Starting local translation server (port {})", port),
    );

    let sidecar = app
        .shell()
        .sidecar("llama-server")
        .map_err(|e| {
            AppError::TranslationApiError(format!("llama-server sidecar unavailable: {}", e))
        })?
        // Token via env, not argv, so it isn't visible in `ps`. llama-server reads
        // LLAMA_API_KEY and requires it on /completion.
        .env("LLAMA_API_KEY", &token);
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

    write_pidfile(app, child.pid());
    if let Ok(mut g) = llm.child.lock() {
        *g = Some(child);
    }
    if let Ok(mut g) = llm.port.lock() {
        *g = Some(port);
    }
    if let Ok(mut g) = llm.token.lock() {
        *g = Some(token.clone());
    }
    touch_last_used(llm);

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

    let deadline = Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECS);
    while Instant::now() < deadline && !died.load(Ordering::Relaxed) {
        // Let the user abort a slow model load instead of waiting out the deadline.
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if health_ok(client, port, &token).await {
            logger::info(app, "translate", "Local translation server ready");
            touch_last_used(llm);
            spawn_idle_watchdog(app, port);
            return Ok((port, token));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // Startup failed (or was cancelled) — clean up and surface the tail of the log.
    if let Ok(mut g) = llm.child.lock() {
        if let Some(child) = g.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut g) = llm.port.lock() {
        *g = None;
    }
    if let Ok(mut g) = llm.token.lock() {
        *g = None;
    }
    // The child was killed above, so its recorded PID is dead — drop the pidfile so
    // a cancelled/failed start doesn't leave a stale PID for the next launch to chase.
    remove_pidfile(app);
    if cancel.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
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
) -> Result<TranslateOutcome, AppError> {
    if texts.is_empty() {
        return Ok(TranslateOutcome::complete(Vec::new()));
    }

    // Pre-flight failures (bad source language, no server) are fatal → Err.
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

    let (port, token) = ensure_server(app, llm, &client, cancel).await?;
    let url = format!("http://127.0.0.1:{}/completion", port);

    // Once the server is up, a mid-run failure is NON-fatal: keep the cues done
    // so far (hours of CPU work) and report the error via the outcome.
    let mut out: Vec<String> = Vec::with_capacity(texts.len());
    let mut run_error: Option<String> = None;
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

        // Race the request against the cancel flag so a hung request (up to the
        // 300 s timeout) doesn't leave Cancel unresponsive. `None` = cancelled.
        // Not `biased`: if the request already resolved this tick, prefer keeping
        // its result rather than discarding a cue that actually finished.
        let outcome = tokio::select! {
            r = translate_one(&client, &url, &token, &body) => Some(r),
            _ = wait_for_cancel(cancel) => None,
        };
        match outcome {
            None => break, // cancelled mid-request — keep the partial result
            Some(Ok(text)) => {
                out.push(text);
                touch_last_used(llm);
                let _ = on_progress.send(TranslationProgress {
                    done: out.len() as u32,
                    total: texts.len() as u32,
                });
            }
            Some(Err(e)) => {
                logger::error(app, "translate", format!("Local translation stopped: {}", e));
                run_error = Some(e.detail().to_string());
                break;
            }
        }
    }

    touch_last_used(llm);
    Ok(TranslateOutcome {
        texts: out,
        error: run_error,
    })
}

/// One /completion request. Errors are returned (not `?`-propagated out of the run)
/// so the caller can keep partial results.
async fn translate_one(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: &serde_json::Value,
) -> Result<String, AppError> {
    let response = client
        .post(url)
        .bearer_auth(token)
        .json(body)
        .send()
        .await
        .map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!(
                "Local translation request failed: {}",
                e.without_url()
            ))
        })?;

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

    Ok(parsed.content.trim().to_string())
}

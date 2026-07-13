use crate::logger;
use crate::subtitle::types::{AppError, TranscriptionProgress, WhisperModelInfo};
use crate::{TranscriptionCancel, WhisperCache};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// Reject model names that could escape the models directory via path traversal or
/// aren't a plain model identifier. The frontend only ever sends known names
/// (tiny / small / medium / large-v3 / large-v3-turbo), so this never rejects
/// legitimate input — it just closes an IPC path-injection vector.
fn validate_model_name(name: &str) -> Result<(), AppError> {
    if !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        Ok(())
    } else {
        Err(AppError::Other(format!("Invalid model name: {}", name)))
    }
}

/// List all available Whisper models (bundled + downloaded)
#[tauri::command]
pub async fn list_models(app: AppHandle) -> Result<Vec<WhisperModelInfo>, AppError> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::Other(e.to_string()))?
        .join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

    let available = vec![
        ("tiny", 75u64, false),
        ("small", 466, true),   // bundled with app
        ("medium", 1500, false),
        ("large-v3", 3100, false),
        ("large-v3-turbo", 1600, false),
    ];

    let mut result = Vec::new();
    for (name, size_mb, bundled) in available {
        let path = models_dir.join(format!("ggml-{}.bin", name));
        let downloaded = path.exists();
        result.push(WhisperModelInfo {
            name: name.to_string(),
            size_mb,
            downloaded,
            path: if downloaded {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            },
            bundled,
        });
    }

    Ok(result)
}

/// Download a Whisper model from HuggingFace.
/// Streams to a temporary `.part` file and atomically renames it into place only on
/// success, so an interrupted download never leaves a truncated file that later looks
/// "downloaded". Streams progress via Channel<f32> (0.0 to 1.0).
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_name: String,
    on_progress: Channel<f32>,
) -> Result<(), AppError> {
    validate_model_name(&model_name)?;

    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::Other(e.to_string()))?
        .join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model_name
    );

    let output_path = models_dir.join(format!("ggml-{}.bin", model_name));
    let temp_path = models_dir.join(format!("ggml-{}.bin.part", model_name));

    logger::info(&app, "model", format!("Downloading {} from HuggingFace", model_name));

    // Stream into the temp file; on any failure remove it so a partial download is
    // never mistaken for a complete model by list_models/transcribe_audio.
    match download_to_temp(&app, &url, &temp_path, None, None, &on_progress).await {
        Ok(()) => {
            // Replace any existing (possibly corrupt) file, then move the fresh one in.
            if output_path.exists() {
                let _ = tokio::fs::remove_file(&output_path).await;
            }
            tokio::fs::rename(&temp_path, &output_path)
                .await
                .map_err(|e: std::io::Error| {
                    AppError::FileError(format!("Failed to finalize model file: {}", e))
                })?;
            logger::info(&app, "model", format!("Model downloaded: {}", model_name));
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp_path).await; // best-effort cleanup
            logger::error(&app, "model", format!("Download failed: {}", e));
            Err(e)
        }
    }
}

/// Streamed download into `temp_path` with connect/read timeouts and a final size
/// check. When `expected_sha256` is given, the stream is hashed on the fly and a
/// mismatch fails the download (used for models fetched from community mirrors).
pub(crate) async fn download_to_temp(
    app: &AppHandle,
    url: &str,
    temp_path: &std::path::Path,
    expected_sha256: Option<&str>,
    cancel: Option<&AtomicBool>,
    on_progress: &Channel<f32>,
) -> Result<(), AppError> {
    use futures_util::StreamExt;
    use sha2::Digest;
    use tokio::io::AsyncWriteExt;

    // Per-read timeout guards against a connection that stalls mid-stream — the old
    // client had no timeout at all and could hang forever on a half-open connection.
    const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e: reqwest::Error| AppError::ModelDownloadFailed(e.to_string()))?;

    let response = client.get(url).send().await.map_err(|e: reqwest::Error| {
        AppError::ModelDownloadFailed(format!("Download failed: {}", e))
    })?;

    if !response.status().is_success() {
        return Err(AppError::ModelDownloadFailed(format!(
            "Download failed with status: {}",
            response.status()
        )));
    }

    let total_size = response.content_length().unwrap_or(0);
    logger::info(
        app,
        "model",
        format!("Downloading {:.1} MB", total_size as f64 / 1_048_576.0),
    );

    let mut file = tokio::fs::File::create(temp_path)
        .await
        .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

    let mut downloaded: u64 = 0;
    let mut last_logged_decile: u64 = 0;
    // Throttle progress events: a multi-GB download emits tens of thousands of
    // chunks, and one IPC message + React setState per chunk floods the webview.
    // Send only on a >=1pp change or every >=100ms, and always the final 1.0.
    let mut last_sent_progress: f32 = -1.0;
    let mut last_sent_at = std::time::Instant::now();
    let mut hasher = expected_sha256.map(|_| sha2::Sha256::new());
    let mut stream = response.bytes_stream();

    loop {
        // User asked to cancel — abort; the caller removes the .part file.
        if cancel.map(|c| c.load(Ordering::Relaxed)).unwrap_or(false) {
            return Err(AppError::Cancelled);
        }
        let next = tokio::time::timeout(READ_TIMEOUT, stream.next())
            .await
            .map_err(|_| {
                AppError::ModelDownloadFailed("Download stalled (read timeout)".to_string())
            })?;
        let chunk = match next {
            Some(c) => c.map_err(|e: reqwest::Error| {
                AppError::ModelDownloadFailed(e.to_string())
            })?,
            None => break,
        };
        file.write_all(&chunk)
            .await
            .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

        if let Some(h) = hasher.as_mut() {
            h.update(&chunk);
        }
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = downloaded as f32 / total_size as f32;
            if progress - last_sent_progress >= 0.01
                || last_sent_at.elapsed() >= std::time::Duration::from_millis(100)
            {
                let _ = on_progress.send(progress);
                last_sent_progress = progress;
                last_sent_at = std::time::Instant::now();
            }

            let decile = (progress * 10.0) as u64;
            if decile > last_logged_decile {
                last_logged_decile = decile;
                logger::info(app, "model", format!("Download progress: {}%", decile * 10));
            }
        }
    }

    file.flush()
        .await
        .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

    // Guarantee the UI sees 100% even if the last chunk didn't cross the throttle.
    if total_size > 0 {
        let _ = on_progress.send(1.0);
    }

    // Guard against a silently truncated download reported as success.
    if total_size > 0 && downloaded != total_size {
        return Err(AppError::ModelDownloadFailed(format!(
            "Incomplete download: got {} of {} bytes",
            downloaded, total_size
        )));
    }

    if let (Some(h), Some(expected)) = (hasher, expected_sha256) {
        let got = format!("{:x}", h.finalize());
        if !got.eq_ignore_ascii_case(expected) {
            return Err(AppError::ModelDownloadFailed(format!(
                "Checksum mismatch — expected sha256 {}, got {}",
                expected, got
            )));
        }
    }

    Ok(())
}

/// Transcribe audio file using Whisper.
/// Streams progress via Channel<TranscriptionProgress>.
/// Runs whisper-rs on a blocking thread to avoid starving the async runtime.
#[tauri::command]
pub async fn cancel_transcription(
    app: AppHandle,
    cancel: State<'_, TranscriptionCancel>,
) -> Result<(), AppError> {
    cancel.0.store(true, Ordering::Relaxed);
    logger::info(&app, "transcribe", "Cancellation requested");
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn transcribe_audio(
    app: AppHandle,
    cancel: State<'_, TranscriptionCancel>,
    cache: State<'_, WhisperCache>,
    audio_path: String,
    model_name: String,
    language: Option<String>,
    detect_speakers: Option<bool>,
    force_cpu: Option<bool>,
    on_progress: Channel<TranscriptionProgress>,
) -> Result<Vec<crate::subtitle::types::Subtitle>, AppError> {
    validate_model_name(&model_name)?;

    // Reset cancellation flag at the start of each run.
    cancel.0.store(false, Ordering::Relaxed);
    let cancel_flag = cancel.0.clone();
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::Other(e.to_string()))?
        .join("models");

    let model_path = models_dir.join(format!("ggml-{}.bin", model_name));
    if !model_path.exists() {
        logger::error(
            &app,
            "transcribe",
            format!("Model not found: {}", model_name),
        );
        return Err(AppError::ModelNotFound(model_name));
    }

    let audio = std::path::PathBuf::from(&audio_path);
    if !audio.exists() {
        logger::error(
            &app,
            "transcribe",
            format!("Audio file not found: {}", audio_path),
        );
        return Err(AppError::FileError(format!(
            "Audio file not found: {}",
            audio_path
        )));
    }

    let lang = language.clone();
    let diarize = detect_speakers.unwrap_or(false);
    let cpu_only = force_cpu.unwrap_or(false);

    logger::info(
        &app,
        "transcribe",
        format!(
            "Starting transcription: model={} lang={} diarize={} force_cpu={}",
            model_name,
            lang.as_deref().unwrap_or("auto"),
            diarize,
            cpu_only,
        ),
    );

    let app_for_log = app.clone();
    let app_for_whisper = app.clone();
    let cache = cache.inner().clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::whisper::model::transcribe(
            &app_for_whisper,
            &model_path,
            &audio,
            lang.as_deref(),
            diarize,
            cpu_only,
            &on_progress,
            cancel_flag,
            &cache,
        )
    })
    .await
    .map_err(|e| AppError::TranscriptionFailed(format!("Task join error: {}", e)))?;

    match &result {
        Ok(subs) => logger::info(
            &app_for_log,
            "transcribe",
            format!("Transcription completed — {} segments", subs.len()),
        ),
        Err(e) => logger::error(&app_for_log, "transcribe", e.to_string()),
    }

    result
}

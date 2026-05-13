use crate::logger;
use crate::subtitle::types::{AppError, TranscriptionProgress, WhisperModelInfo};
use crate::TranscriptionCancel;
use std::sync::atomic::Ordering;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

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
/// Streams download progress via Channel<f32> (0.0 to 1.0).
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_name: String,
    on_progress: Channel<f32>,
) -> Result<(), AppError> {
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

    logger::info(&app, "model", format!("Downloading {} from HuggingFace", model_name));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e: reqwest::Error| {
            logger::error(&app, "model", format!("Download request failed: {}", e));
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
        &app,
        "model",
        format!("Downloading {:.1} MB", total_size as f64 / 1_048_576.0),
    );
    let mut downloaded: u64 = 0;
    let mut last_logged_decile: u64 = 0;

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&output_path)
        .await
        .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e: reqwest::Error| AppError::ModelDownloadFailed(e.to_string()))?;
        file.write_all(&chunk)
            .await
            .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = downloaded as f32 / total_size as f32;
            let _ = on_progress.send(progress);

            let decile = (progress * 10.0) as u64;
            if decile > last_logged_decile {
                last_logged_decile = decile;
                logger::info(&app, "model", format!("Download progress: {}%", decile * 10));
            }
        }
    }

    file.flush()
        .await
        .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

    logger::info(&app, "model", format!("Model downloaded: {}", model_name));

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
pub async fn transcribe_audio(
    app: AppHandle,
    cancel: State<'_, TranscriptionCancel>,
    audio_path: String,
    model_name: String,
    language: Option<String>,
    detect_speakers: Option<bool>,
    on_progress: Channel<TranscriptionProgress>,
) -> Result<Vec<crate::subtitle::types::Subtitle>, AppError> {
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

    logger::info(
        &app,
        "transcribe",
        format!(
            "Starting transcription: model={} lang={} diarize={}",
            model_name,
            lang.as_deref().unwrap_or("auto"),
            diarize,
        ),
    );

    let app_for_log = app.clone();
    let app_for_whisper = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::whisper::model::transcribe(
            &app_for_whisper,
            &model_path,
            &audio,
            lang.as_deref(),
            diarize,
            &on_progress,
            cancel_flag,
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

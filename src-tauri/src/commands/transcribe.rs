use crate::subtitle::types::{AppError, TranscriptionProgress, WhisperModelInfo};
use tauri::ipc::Channel;
use tauri::AppHandle;

/// List all available Whisper models (bundled + downloaded)
#[tauri::command]
pub async fn list_models(app: AppHandle) -> Result<Vec<WhisperModelInfo>, AppError> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e| AppError::FileError(e.to_string()))?;

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
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model_name
    );

    let output_path = models_dir.join(format!("ggml-{}.bin", model_name));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Download failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Download failed with status: {}",
            response.status()
        )));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&output_path)
        .await
        .map_err(|e| AppError::FileError(e.to_string()))?;

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Other(e.to_string()))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::FileError(e.to_string()))?;

        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = downloaded as f32 / total_size as f32;
            let _ = on_progress.send(progress);
        }
    }

    file.flush()
        .await
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok(())
}

/// Transcribe audio file using Whisper.
/// Streams progress via Channel<TranscriptionProgress>.
/// NOTE: whisper-rs integration will be added in Phase 5.
/// This stub returns a placeholder error to allow compilation.
#[tauri::command]
pub async fn transcribe_audio(
    _app: AppHandle,
    _audio_path: String,
    _model_name: String,
    _language: Option<String>,
    on_progress: Channel<TranscriptionProgress>,
) -> Result<Vec<crate::subtitle::types::Subtitle>, AppError> {
    let _ = on_progress.send(TranscriptionProgress {
        stage: "loading_model".into(),
        progress: 0.0,
        message: "Whisper integration coming in Phase 5...".into(),
    });

    Err(AppError::Other(
        "Whisper transcription not yet implemented (Phase 5)".into(),
    ))
}

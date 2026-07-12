use crate::logger;
use crate::subtitle::types::AppError;
use crate::translation::local::{model_path, MODEL_FILE, MODEL_SHA256, MODEL_SIZE_BYTES, MODEL_URL};
use tauri::ipc::Channel;
use tauri::AppHandle;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelInfo {
    pub downloaded: bool,
    pub size_mb: u64,
}

/// Status of the local translation model (TranslateGemma 4B). A file with the
/// wrong size (pre-atomic partial copy, mirror swap) counts as not downloaded.
#[tauri::command]
pub async fn local_model_status(app: AppHandle) -> Result<LocalModelInfo, AppError> {
    let path = model_path(&app)?;
    let downloaded = std::fs::metadata(&path)
        .map(|m| m.len() == MODEL_SIZE_BYTES)
        .unwrap_or(false);
    Ok(LocalModelInfo {
        downloaded,
        size_mb: MODEL_SIZE_BYTES / 1_048_576,
    })
}

/// Download the local translation model. Same atomic .part+rename scheme as the
/// Whisper models, plus a pinned SHA-256 check — the GGUF comes from a community
/// mirror, so integrity is verified rather than trusted.
#[tauri::command]
pub async fn download_local_model(
    app: AppHandle,
    on_progress: Channel<f32>,
) -> Result<(), AppError> {
    let output_path = model_path(&app)?;
    if let Some(dir) = output_path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;
    }
    let temp_path = output_path.with_file_name(format!("{}.part", MODEL_FILE));

    logger::info(
        &app,
        "model",
        "Downloading TranslateGemma 4B (local translation model)",
    );

    match crate::commands::transcribe::download_to_temp(
        &app,
        MODEL_URL,
        &temp_path,
        Some(MODEL_SHA256),
        &on_progress,
    )
    .await
    {
        Ok(()) => {
            if output_path.exists() {
                let _ = tokio::fs::remove_file(&output_path).await;
            }
            tokio::fs::rename(&temp_path, &output_path)
                .await
                .map_err(|e: std::io::Error| {
                    AppError::FileError(format!("Failed to finalize model file: {}", e))
                })?;
            logger::info(&app, "model", "Local translation model downloaded");
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            logger::error(&app, "model", format!("Download failed: {}", e));
            Err(e)
        }
    }
}

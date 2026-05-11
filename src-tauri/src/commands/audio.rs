use crate::logger;
use crate::subtitle::types::AppError;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Extract audio from video/audio file to a 16kHz mono WAV for Whisper.
/// Returns path to the temporary WAV file.
#[tauri::command]
pub async fn extract_audio(app: AppHandle, input_path: String) -> Result<String, AppError> {
    let temp_dir = std::env::temp_dir();
    let output_path = temp_dir.join("transcriptpro_audio.wav");
    let output_str = output_path.to_string_lossy().to_string();

    let input_size_mb = std::fs::metadata(&input_path)
        .map(|m| m.len() as f64 / 1_048_576.0)
        .unwrap_or(0.0);
    logger::info(
        &app,
        "audio",
        format!(
            "Extracting audio from {} ({:.1} MB) → 16kHz mono WAV",
            input_path, input_size_mb
        ),
    );
    let started = std::time::Instant::now();

    let output = app
        .shell()
        .command("ffmpeg")
        .args([
            "-i",
            &input_path,
            "-ar",
            "16000",        // 16kHz sample rate required by Whisper
            "-ac",
            "1",            // mono channel
            "-acodec",
            "pcm_s16le",    // 16-bit PCM
            "-y",           // overwrite output file
            &output_str,
        ])
        .output()
        .await
        .map_err(|e: tauri_plugin_shell::Error| {
            let msg = format!(
                "FFmpeg not found. Install it via 'brew install ffmpeg' or add it to PATH. ({})",
                e
            );
            logger::error(&app, "audio", &msg);
            AppError::AudioExtractionFailed(msg)
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        logger::error(&app, "audio", format!("ffmpeg failed: {}", stderr));
        return Err(AppError::AudioExtractionFailed(stderr));
    }

    let output_size_mb = std::fs::metadata(&output_path)
        .map(|m| m.len() as f64 / 1_048_576.0)
        .unwrap_or(0.0);
    logger::info(
        &app,
        "audio",
        format!(
            "Audio ready ({:.1} MB) in {:.2}s — {}",
            output_size_mb,
            started.elapsed().as_secs_f32(),
            output_str
        ),
    );
    Ok(output_str)
}

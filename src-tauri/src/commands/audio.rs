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

    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::AudioExtractionFailed(e.to_string()))?
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
        .map_err(|e| AppError::AudioExtractionFailed(e.to_string()))?;

    if !output.status.success() {
        return Err(AppError::AudioExtractionFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(output_str)
}

use crate::logger;
use crate::subtitle::types::AppError;
use crate::AudioExtraction;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// Extract audio from video/audio file to a 16kHz mono WAV for Whisper.
/// Returns path to the temporary WAV file. The ffmpeg process is spawned (not run to
/// completion in one call) so it can be killed via `cancel_audio_extraction`.
#[tauri::command]
pub async fn extract_audio(
    app: AppHandle,
    input_path: String,
    state: State<'_, AudioExtraction>,
) -> Result<String, AppError> {
    let temp_dir = std::env::temp_dir();

    // Unique per-extraction filename avoids the race where a new extraction overwrote the
    // fixed path while a previous file was still being read. Stale WAVs are cleaned at app
    // startup (see `cleanup_stale_audio` in lib.rs) rather than here, so we never delete a
    // WAV that a pending (manually-triggered) transcription still needs to read.
    let output_path = temp_dir.join(format!("transcriptpro_audio_{}.wav", Uuid::new_v4()));
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

    // Reset the cancellation flag for this run.
    state.cancelled.store(false, Ordering::Relaxed);

    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| {
        let msg = format!("Bundled FFmpeg sidecar is unavailable: {}", e);
        logger::error(&app, "audio", &msg);
        AppError::AudioExtractionFailed(msg)
    })?;

    let (mut rx, child) = sidecar
        .args([
            "-i",
            &input_path,
            "-ar",
            "16000", // 16kHz sample rate required by Whisper
            "-ac",
            "1", // mono channel
            "-acodec",
            "pcm_s16le", // 16-bit PCM
            "-y",        // overwrite output file
            &output_str,
        ])
        .spawn()
        .map_err(|e: tauri_plugin_shell::Error| {
            let msg = format!("FFmpeg execution failed: {}", e);
            logger::error(&app, "audio", &msg);
            AppError::AudioExtractionFailed(msg)
        })?;

    // Publish the child handle so cancel_audio_extraction (or app shutdown) can kill it.
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }

    let mut stderr = String::new();
    let mut exit_code: Option<i32> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(bytes) => stderr.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Error(e) => stderr.push_str(&e),
            CommandEvent::Terminated(payload) => exit_code = payload.code,
            _ => {}
        }
    }

    // Release the stored child (cancel may already have taken it).
    if let Ok(mut guard) = state.child.lock() {
        let _ = guard.take();
    }

    if state.cancelled.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&output_path); // discard the partial WAV
        logger::info(&app, "audio", "Audio extraction cancelled");
        return Err(AppError::Cancelled);
    }

    if exit_code != Some(0) {
        let _ = std::fs::remove_file(&output_path);
        let detail = if stderr.trim().is_empty() {
            format!("ffmpeg exited with code {:?}", exit_code)
        } else {
            stderr
        };
        logger::error(&app, "audio", format!("ffmpeg failed: {}", detail));
        return Err(AppError::AudioExtractionFailed(detail));
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

/// Cancel an in-progress audio extraction by killing the ffmpeg child process.
#[tauri::command]
pub async fn cancel_audio_extraction(
    app: AppHandle,
    state: State<'_, AudioExtraction>,
) -> Result<(), AppError> {
    state.cancelled.store(true, Ordering::Relaxed);
    let child = state.child.lock().ok().and_then(|mut g| g.take());
    if let Some(child) = child {
        let _ = child.kill();
        logger::info(&app, "audio", "Audio extraction cancellation requested");
    }
    Ok(())
}

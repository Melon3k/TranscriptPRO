use crate::subtitle::types::{AppError, Subtitle, TranscriptionProgress, Word};
use std::path::Path;
use tauri::ipc::Channel;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Run Whisper transcription on a 16kHz mono WAV file.
/// Returns subtitle segments with word-level timestamps.
pub fn transcribe(
    model_path: &Path,
    audio_path: &Path,
    language: Option<&str>,
    on_progress: &Channel<TranscriptionProgress>,
) -> Result<Vec<Subtitle>, AppError> {
    // ── Load model ──────────────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "loading_model".into(),
        progress: 0.0,
        message: "Loading Whisper model…".into(),
    });

    let ctx = WhisperContext::new_with_params(
        model_path.to_str().unwrap_or_default(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| AppError::TranscriptionFailed(format!("Failed to load model: {}", e)))?;

    // ── Read WAV audio ──────────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "loading_audio".into(),
        progress: 0.05,
        message: "Reading audio file…".into(),
    });

    let audio_data = read_wav_pcm_f32(audio_path)?;

    // ── Configure transcription ─────────────────────────────────────────
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    if let Some(lang) = language {
        params.set_language(Some(lang));
    } else {
        params.set_language(Some("auto"));
    }

    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(true);
    // Do NOT set max_len — let Whisper decide sentence boundaries naturally

    // ── Run transcription ───────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "transcribing".into(),
        progress: 0.1,
        message: "Transcribing audio…".into(),
    });

    let mut state = ctx
        .create_state()
        .map_err(|e| AppError::TranscriptionFailed(format!("Failed to create state: {}", e)))?;

    state
        .full(params, &audio_data)
        .map_err(|e| AppError::TranscriptionFailed(format!("Transcription failed: {}", e)))?;

    // ── Extract segments ────────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "transcribing".into(),
        progress: 0.9,
        message: "Extracting segments…".into(),
    });

    let num_segments = state.full_n_segments().map_err(|e| {
        AppError::TranscriptionFailed(format!("Failed to get segment count: {}", e))
    })?;

    let mut subtitles = Vec::new();

    for i in 0..num_segments {
        let start_ts = state.full_get_segment_t0(i).map_err(|e| {
            AppError::TranscriptionFailed(format!("Failed to get segment start: {}", e))
        })?;
        let end_ts = state.full_get_segment_t1(i).map_err(|e| {
            AppError::TranscriptionFailed(format!("Failed to get segment end: {}", e))
        })?;
        let text = state.full_get_segment_text(i).map_err(|e| {
            AppError::TranscriptionFailed(format!("Failed to get segment text: {}", e))
        })?;

        let text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }

        // whisper timestamps are in centiseconds (10ms units)
        let start_ms = (start_ts as u64) * 10;
        let end_ms = (end_ts as u64) * 10;

        // Extract word-level timestamps by merging BPE sub-tokens into words.
        // Whisper BPE convention: tokens starting with a space begin a new word,
        // tokens without a leading space are continuations of the previous word.
        let num_tokens = state.full_n_tokens(i).map_err(|e| {
            AppError::TranscriptionFailed(format!("Failed to get token count: {}", e))
        })?;

        let mut raw_tokens: Vec<(String, u64, u64)> = Vec::new();
        for t in 0..num_tokens {
            let token_text = state.full_get_token_text(i, t).unwrap_or_default();
            let token_data = state.full_get_token_data(i, t);

            // Skip empty, special tokens like [_BEG_], [_SOT_], etc.
            if token_text.is_empty()
                || token_text.starts_with('[')
                || token_text.starts_with("<|")
            {
                continue;
            }

            if let Ok(data) = token_data {
                raw_tokens.push((
                    token_text,
                    (data.t0 as u64) * 10,
                    (data.t1 as u64) * 10,
                ));
            }
        }

        // Merge sub-tokens into full words
        let mut words: Vec<Word> = Vec::new();
        for (token_text, t0, t1) in &raw_tokens {
            let starts_new_word = token_text.starts_with(' ') || words.is_empty();
            let clean = token_text.trim().to_string();
            if clean.is_empty() {
                continue;
            }

            if starts_new_word {
                words.push(Word {
                    text: clean,
                    start_time: *t0,
                    end_time: *t1,
                });
            } else if let Some(last) = words.last_mut() {
                // Continuation of previous word — append text, extend end time
                last.text.push_str(&clean);
                last.end_time = *t1;
            }
        }

        subtitles.push(Subtitle {
            id: uuid::Uuid::new_v4().to_string(),
            index: subtitles.len() + 1,
            start_time: start_ms,
            end_time: end_ms,
            text,
            words,
        });

        // Update progress proportionally
        let progress = 0.1 + 0.8 * ((i + 1) as f32 / num_segments as f32);
        let _ = on_progress.send(TranscriptionProgress {
            stage: "transcribing".into(),
            progress,
            message: format!("Segment {}/{}", i + 1, num_segments),
        });
    }

    let _ = on_progress.send(TranscriptionProgress {
        stage: "done".into(),
        progress: 1.0,
        message: format!("Done — {} segments", subtitles.len()),
    });

    Ok(subtitles)
}

/// Read a 16-bit PCM WAV file and return f32 samples normalized to [-1, 1].
fn read_wav_pcm_f32(path: &Path) -> Result<Vec<f32>, AppError> {
    let data = std::fs::read(path).map_err(|e| {
        AppError::FileError(format!("Failed to read audio file: {}", e))
    })?;

    // Minimal WAV header parsing: find "data" chunk
    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err(AppError::TranscriptionFailed(
            "Invalid WAV file format".into(),
        ));
    }

    // Find data chunk
    let mut pos = 12;
    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
        ]) as usize;

        if chunk_id == b"data" {
            let pcm_start = pos + 8;
            let pcm_end = (pcm_start + chunk_size).min(data.len());
            let pcm_data = &data[pcm_start..pcm_end];

            // Convert 16-bit LE samples to f32
            let samples: Vec<f32> = pcm_data
                .chunks_exact(2)
                .map(|chunk| {
                    let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                    sample as f32 / 32768.0
                })
                .collect();

            return Ok(samples);
        }

        pos += 8 + chunk_size;
        // Chunks are word-aligned
        if chunk_size % 2 != 0 {
            pos += 1;
        }
    }

    Err(AppError::TranscriptionFailed(
        "WAV file missing data chunk".into(),
    ))
}

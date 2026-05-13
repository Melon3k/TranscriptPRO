use crate::logger;
use crate::subtitle::types::{AppError, Subtitle, TranscriptionProgress, Word};
use std::ffi::c_void;
use std::os::raw::c_int;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::ipc::Channel;
use tauri::AppHandle;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// FFI trampoline invoked by whisper.cpp from `state.full()`.
/// `user_data` is a `*const Channel<TranscriptionProgress>` owned by the caller and kept alive
/// for the duration of the call. We use the raw unsafe API instead of
/// `set_progress_callback_safe` because in whisper-rs 0.13 the safe wrapper stores a stale
/// stack pointer as user_data and crashes on the first callback (SIGSEGV).
unsafe extern "C" fn progress_trampoline(
    _ctx: *mut whisper_rs_sys::whisper_context,
    _state: *mut whisper_rs_sys::whisper_state,
    progress: c_int,
    user_data: *mut c_void,
) {
    if user_data.is_null() {
        return;
    }
    let channel = &*(user_data as *const Channel<TranscriptionProgress>);
    let frac = (progress as f32 / 100.0).clamp(0.0, 1.0);
    let mapped = 0.10 + 0.75 * frac;
    let _ = channel.send(TranscriptionProgress {
        stage: "transcribing".into(),
        progress: mapped,
        message: format!("Transcribing audio… {}%", progress),
    });
}

/// Run Whisper transcription on a 16kHz mono WAV file.
/// Returns subtitle segments with word-level timestamps.
pub fn transcribe(
    app: &AppHandle,
    model_path: &Path,
    audio_path: &Path,
    language: Option<&str>,
    enable_diarization: bool,
    on_progress: &Channel<TranscriptionProgress>,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<Subtitle>, AppError> {
    let started = Instant::now();

    // ── Load model ──────────────────────────────────────────────────────
    let model_size_mb = std::fs::metadata(model_path).map(|m| m.len() / 1_048_576).unwrap_or(0);
    logger::info(
        app,
        "whisper",
        format!(
            "Loading model {} ({} MB)",
            model_path.file_name().and_then(|s| s.to_str()).unwrap_or("?"),
            model_size_mb
        ),
    );
    let _ = on_progress.send(TranscriptionProgress {
        stage: "loading_model".into(),
        progress: 0.0,
        message: "Loading Whisper model…".into(),
    });

    let load_started = Instant::now();
    let ctx = WhisperContext::new_with_params(
        model_path.to_str().unwrap_or_default(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| {
        logger::error(app, "whisper", format!("Model load failed: {}", e));
        AppError::TranscriptionFailed(format!("Failed to load model: {}", e))
    })?;
    logger::info(
        app,
        "whisper",
        format!("Model loaded in {:.2}s", load_started.elapsed().as_secs_f32()),
    );

    // ── Read WAV audio ──────────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "loading_audio".into(),
        progress: 0.05,
        message: "Reading audio file…".into(),
    });

    let audio_data = read_wav_pcm_f32(audio_path)?;
    let duration_s = audio_data.len() as f32 / SAMPLE_RATE as f32;
    logger::info(
        app,
        "whisper",
        format!(
            "Audio loaded: {:.1}s ({} samples @ {}Hz)",
            duration_s,
            audio_data.len(),
            SAMPLE_RATE
        ),
    );

    // ── Configure transcription ─────────────────────────────────────────
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    if let Some(lang) = language {
        params.set_language(Some(lang));
        logger::info(app, "whisper", format!("Language: {} (forced)", lang));
    } else {
        params.set_language(Some("auto"));
        logger::info(app, "whisper", "Language: auto-detect");
    }

    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(true);
    // Do NOT set max_len — let Whisper decide sentence boundaries naturally

    // Stream whisper's internal progress (0-100) into the channel via the raw FFI callback.
    // Mapped to 0.10–0.85 so we leave room for segment extraction (0.85–0.95)
    // and optional speaker detection (0.95–1.0).
    let cb_channel: Box<Channel<TranscriptionProgress>> = Box::new(on_progress.clone());
    let cb_ptr = &*cb_channel as *const Channel<TranscriptionProgress> as *mut c_void;
    unsafe {
        params.set_progress_callback(Some(progress_trampoline));
        params.set_progress_callback_user_data(cb_ptr);
    }

    // Cooperative cancellation: whisper.cpp polls this callback during decode.
    let cancel_for_abort = cancel.clone();
    params.set_abort_callback_safe(move || cancel_for_abort.load(Ordering::Relaxed));

    // ── Run transcription ───────────────────────────────────────────────
    logger::info(app, "whisper", "Starting whisper.cpp inference");
    let _ = on_progress.send(TranscriptionProgress {
        stage: "transcribing".into(),
        progress: 0.1,
        message: "Transcribing audio…".into(),
    });

    let mut state = ctx
        .create_state()
        .map_err(|e| AppError::TranscriptionFailed(format!("Failed to create state: {}", e)))?;

    let infer_started = Instant::now();
    state
        .full(params, &audio_data)
        .map_err(|e| {
            logger::error(app, "whisper", format!("Inference failed: {}", e));
            AppError::TranscriptionFailed(format!("Transcription failed: {}", e))
        })?;
    logger::info(
        app,
        "whisper",
        format!(
            "Inference finished in {:.2}s ({:.2}x realtime)",
            infer_started.elapsed().as_secs_f32(),
            duration_s / infer_started.elapsed().as_secs_f32().max(0.001)
        ),
    );

    // Keep the callback channel alive until after `state.full()` returns.
    drop(cb_channel);

    if cancel.load(Ordering::Relaxed) {
        logger::info(app, "whisper", "Transcription cancelled by user");
        let _ = on_progress.send(TranscriptionProgress {
            stage: "cancelled".into(),
            progress: 0.0,
            message: "Cancelled".into(),
        });
        return Err(AppError::Cancelled);
    }

    // ── Extract segments ────────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "transcribing".into(),
        progress: 0.85,
        message: "Extracting segments…".into(),
    });

    let num_segments = state.full_n_segments().map_err(|e| {
        AppError::TranscriptionFailed(format!("Failed to get segment count: {}", e))
    })?;
    logger::info(
        app,
        "whisper",
        format!("Extracting {} segments", num_segments),
    );

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

        let preview: String = text.chars().take(80).collect();
        let preview = if text.chars().count() > 80 {
            format!("{}…", preview)
        } else {
            preview
        };
        logger::info(
            app,
            "whisper",
            format!(
                "[{}/{}] {:.2}s–{:.2}s: {}",
                i + 1,
                num_segments,
                start_ms as f32 / 1000.0,
                end_ms as f32 / 1000.0,
                preview
            ),
        );

        subtitles.push(Subtitle {
            id: uuid::Uuid::new_v4().to_string(),
            index: subtitles.len() + 1,
            start_time: start_ms,
            end_time: end_ms,
            text,
            words,
            speaker: None,
        });

        // Update progress proportionally over the extraction band (0.85 → 0.95).
        let progress = 0.85 + 0.10 * ((i + 1) as f32 / num_segments as f32);
        let _ = on_progress.send(TranscriptionProgress {
            stage: "transcribing".into(),
            progress,
            message: format!("Segment {}/{}", i + 1, num_segments),
        });
    }

    // ── Speaker detection (optional) ──────────────────────────────────────
    if enable_diarization {
        logger::info(app, "whisper", "Running speaker diarization");
        let _ = on_progress.send(TranscriptionProgress {
            stage: "transcribing".into(),
            progress: 0.95,
            message: "Detecting speakers…".into(),
        });
        let diar_started = Instant::now();
        detect_speakers(&mut subtitles, &audio_data);
        let speaker_count = subtitles
            .iter()
            .filter_map(|s| s.speaker.as_ref())
            .collect::<std::collections::HashSet<_>>()
            .len();
        logger::info(
            app,
            "whisper",
            format!(
                "Diarization done in {:.2}s — {} speaker(s)",
                diar_started.elapsed().as_secs_f32(),
                speaker_count
            ),
        );
    }

    let total_words: usize = subtitles.iter().map(|s| s.words.len()).sum();
    logger::info(
        app,
        "whisper",
        format!(
            "Transcription complete — {} segments, {} words in {:.2}s total",
            subtitles.len(),
            total_words,
            started.elapsed().as_secs_f32()
        ),
    );

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

// ── Speaker detection ───────────────────────────────────────────────────

const SAMPLE_RATE: usize = 16_000; // 16kHz WAV from FFmpeg

/// Voice profile for a segment — used to compare speakers
#[derive(Clone)]
struct VoiceProfile {
    rms_energy: f32,
    zero_crossing_rate: f32,
    spectral_centroid: f32,
}

/// Compute a voice profile for a slice of audio samples.
fn compute_voice_profile(samples: &[f32]) -> VoiceProfile {
    if samples.is_empty() {
        return VoiceProfile {
            rms_energy: 0.0,
            zero_crossing_rate: 0.0,
            spectral_centroid: 0.0,
        };
    }

    // RMS energy
    let rms_energy = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();

    // Zero-crossing rate — correlates with pitch
    let zero_crossings = samples
        .windows(2)
        .filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0))
        .count();
    let zero_crossing_rate = zero_crossings as f32 / samples.len() as f32;

    // Spectral centroid approximation via autocorrelation dominant period
    let frame_len = samples.len().min(1600); // 100ms max frame
    let frame = &samples[..frame_len];
    let mut best_lag = 1usize;
    let mut best_corr = 0.0f32;
    let min_lag = 30; // ~533 Hz max
    let max_lag = frame_len.min(500); // ~32 Hz min
    for lag in min_lag..max_lag {
        let mut corr = 0.0f32;
        for j in 0..(frame_len - lag) {
            corr += frame[j] * frame[j + lag];
        }
        if corr > best_corr {
            best_corr = corr;
            best_lag = lag;
        }
    }
    let spectral_centroid = SAMPLE_RATE as f32 / best_lag as f32;

    VoiceProfile {
        rms_energy,
        zero_crossing_rate,
        spectral_centroid,
    }
}

/// Compare two voice profiles. Returns a dissimilarity score (0 = identical).
fn profile_distance(a: &VoiceProfile, b: &VoiceProfile) -> f32 {
    // Normalize each feature and combine
    let energy_diff = ((a.rms_energy - b.rms_energy) / (a.rms_energy + b.rms_energy + 1e-8)).abs();
    let zcr_diff =
        ((a.zero_crossing_rate - b.zero_crossing_rate) / (a.zero_crossing_rate + b.zero_crossing_rate + 1e-8)).abs();
    let pitch_diff = ((a.spectral_centroid - b.spectral_centroid)
        / (a.spectral_centroid + b.spectral_centroid + 1e-8))
        .abs();

    // Weighted combination
    energy_diff * 0.2 + zcr_diff * 0.3 + pitch_diff * 0.5
}

/// Assign speaker labels to subtitles based on audio voice profile analysis.
/// Uses gap detection + voice profile comparison to cluster speakers.
pub fn detect_speakers(subtitles: &mut [Subtitle], audio_data: &[f32]) {
    if subtitles.is_empty() {
        return;
    }

    let total_samples = audio_data.len();

    // Compute voice profile for each segment
    let profiles: Vec<VoiceProfile> = subtitles
        .iter()
        .map(|sub| {
            let start_sample =
                ((sub.start_time as usize) * SAMPLE_RATE / 1000).min(total_samples);
            let end_sample =
                ((sub.end_time as usize) * SAMPLE_RATE / 1000).min(total_samples);
            if start_sample >= end_sample || end_sample - start_sample < 160 {
                // Segment too short for analysis
                VoiceProfile {
                    rms_energy: 0.0,
                    zero_crossing_rate: 0.0,
                    spectral_centroid: 0.0,
                }
            } else {
                compute_voice_profile(&audio_data[start_sample..end_sample])
            }
        })
        .collect();

    // Cluster speakers using sequential comparison
    // Start with speaker 1, switch when profile changes significantly
    // or there's a long pause between segments
    let change_threshold = 0.15; // profile distance threshold for speaker change
    let pause_threshold_ms: u64 = 2000; // 2 second gap suggests speaker change

    // Track known speaker profiles (average profile per speaker)
    let mut speaker_profiles: Vec<VoiceProfile> = vec![profiles[0].clone()];
    let mut assignments: Vec<usize> = vec![0]; // speaker index for each subtitle

    for i in 1..subtitles.len() {
        let gap = subtitles[i]
            .start_time
            .saturating_sub(subtitles[i - 1].end_time);
        let dist = profile_distance(&profiles[i], &speaker_profiles[assignments[i - 1]]);

        let has_pause = gap >= pause_threshold_ms;
        let voice_changed = dist > change_threshold;

        if has_pause || voice_changed {
            // Check if this profile matches any known speaker
            let mut best_speaker = None;
            let mut best_dist = f32::MAX;
            for (si, sp) in speaker_profiles.iter().enumerate() {
                let d = profile_distance(&profiles[i], sp);
                if d < best_dist {
                    best_dist = d;
                    best_speaker = Some(si);
                }
            }

            if best_dist < change_threshold {
                // Matches an existing speaker
                assignments.push(best_speaker.unwrap());
            } else {
                // New speaker
                let new_idx = speaker_profiles.len();
                speaker_profiles.push(profiles[i].clone());
                assignments.push(new_idx);
            }
        } else {
            // Same speaker as previous
            assignments.push(assignments[i - 1]);
        }
    }

    // Assign labels
    for (sub, &speaker_idx) in subtitles.iter_mut().zip(assignments.iter()) {
        sub.speaker = Some(format!("Speaker {}", speaker_idx + 1));
    }
}

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
        stage: "transcribing_audio".into(),
        progress: mapped,
        message: format!("Transcribing audio… {}%", progress),
        ..Default::default()
    });
}

/// FFI trampoline for whisper.cpp's abort callback. `user_data` is a `*const AtomicBool`
/// (the cancellation flag) kept alive by the caller for the duration of `state.full()`.
/// Returning `true` aborts whisper.cpp's decode loop.
///
/// We deliberately use the raw API instead of `FullParams::set_abort_callback_safe` because
/// that wrapper is unsound in whisper-rs 0.16: it monomorphises its internal trampoline over
/// the closure type `F` but stores a pointer to a `Box<dyn FnMut() -> bool>` as user_data.
/// The trampoline then reinterprets the fat box pointer as `F` and dereferences it, so the
/// callback reads unrelated heap memory and returns garbage — almost always `true`. That
/// aborted every transcription after the first 30 s window, surfacing as "0 segments at
/// >50× realtime" on BOTH GPU and CPU (previously misdiagnosed as Metal GPU corruption).
unsafe extern "C" fn abort_trampoline(user_data: *mut c_void) -> bool {
    if user_data.is_null() {
        return false;
    }
    let flag = &*(user_data as *const AtomicBool);
    flag.load(Ordering::Relaxed)
}

/// A loaded Whisper context cached across transcription jobs, keyed by model path +
/// backend (GPU/CPU). Reusing it avoids reloading the model (up to 3 GB) from disk every
/// time — this is whisper.cpp's intended usage (load once, transcribe many).
pub struct CachedContext {
    model_path: std::path::PathBuf,
    use_gpu: bool,
    ctx: Arc<WhisperContext>,
}

/// DTW alignment-head preset for a ggml model file (`ggml-<name>.bin`). DTW token
/// alignment yields word timestamps that track the actual speech far better than the
/// energy heuristic (t0/t1) alone. Unknown names get `None` → plain context.
fn dtw_preset_for_path(model_path: &Path) -> Option<whisper_rs::DtwModelPreset> {
    use whisper_rs::DtwModelPreset as P;
    let name = model_path
        .file_stem()?
        .to_str()?
        .strip_prefix("ggml-")?;
    match name {
        "tiny" => Some(P::Tiny),
        "tiny.en" => Some(P::TinyEn),
        "base" => Some(P::Base),
        "base.en" => Some(P::BaseEn),
        "small" => Some(P::Small),
        "small.en" => Some(P::SmallEn),
        "medium" => Some(P::Medium),
        "medium.en" => Some(P::MediumEn),
        "large-v1" => Some(P::LargeV1),
        "large-v2" => Some(P::LargeV2),
        "large-v3" => Some(P::LargeV3),
        "large-v3-turbo" => Some(P::LargeV3Turbo),
        _ => None,
    }
}

/// Create a Whisper context, preferring DTW token alignment (per-model attention-head
/// preset). Falls back to a plain context when the preset is unknown or DTW init fails,
/// so this can never make model loading worse than before.
fn load_context(
    app: &AppHandle,
    model_path: &Path,
    use_gpu: bool,
) -> Result<WhisperContext, AppError> {
    use whisper_rs::{DtwMode, DtwParameters};

    let path_str = model_path.to_str().unwrap_or_default();

    if let Some(preset) = dtw_preset_for_path(model_path) {
        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu(use_gpu);
        ctx_params.dtw_parameters(DtwParameters {
            mode: DtwMode::ModelPreset {
                model_preset: preset,
            },
            ..Default::default()
        });
        match WhisperContext::new_with_params(path_str, ctx_params) {
            Ok(ctx) => {
                logger::info(app, "whisper", "DTW token alignment enabled");
                return Ok(ctx);
            }
            Err(e) => {
                logger::emit(
                    app,
                    "warn",
                    "whisper",
                    format!("DTW init failed ({}), using heuristic word timestamps", e),
                );
            }
        }
    }

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(use_gpu);
    WhisperContext::new_with_params(path_str, ctx_params).map_err(|e| {
        logger::error(app, "whisper", format!("Model load failed: {}", e));
        AppError::TranscriptionFailed(format!("Failed to load model: {}", e))
    })
}

/// Drop the cached context for a given (model, backend) — used after a failure so a
/// potentially tainted GPU/Metal context is never reused on a later job.
fn evict_context(cache: &crate::WhisperCache, model_path: &Path, use_gpu: bool) {
    // Recover from a poisoned lock (a prior panic) — the cached value is a plain Option.
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    let matches = guard
        .as_ref()
        .is_some_and(|c| c.model_path == model_path && c.use_gpu == use_gpu);
    if matches {
        *guard = None;
    }
}

/// Run Whisper transcription on a 16kHz mono WAV file.
/// Returns subtitle segments with word-level timestamps.
#[allow(clippy::too_many_arguments)]
pub fn transcribe(
    app: &AppHandle,
    model_path: &Path,
    audio_path: &Path,
    language: Option<&str>,
    enable_diarization: bool,
    force_cpu: bool,
    on_progress: &Channel<TranscriptionProgress>,
    cancel: Arc<AtomicBool>,
    cache: &crate::WhisperCache,
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
        ..Default::default()
    });

    // ── Read WAV audio ──────────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "loading_audio".into(),
        progress: 0.05,
        message: "Reading audio file…".into(),
        ..Default::default()
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

    // ── Diagnostics: audio sanity + whisper.cpp system info ─────────────
    let (mut amin, mut amax, mut nan_count, mut inf_count) = (f32::INFINITY, f32::NEG_INFINITY, 0u64, 0u64);
    for &s in &audio_data {
        if s.is_nan() { nan_count += 1; }
        else if s.is_infinite() { inf_count += 1; }
        else {
            if s < amin { amin = s; }
            if s > amax { amax = s; }
        }
    }
    logger::info(
        app,
        "whisper",
        format!(
            "Audio stats: min={:.4} max={:.4} nans={} infs={} first8={:?}",
            amin, amax, nan_count, inf_count,
            audio_data.iter().take(8).copied().collect::<Vec<_>>()
        ),
    );
    logger::info(
        app,
        "whisper",
        format!("whisper system info: {}", whisper_rs::print_system_info()),
    );

    // ── Run inference, with GPU → CPU fallback on encode failure ────────
    logger::info(app, "whisper", "Starting whisper.cpp inference");
    let _ = on_progress.send(TranscriptionProgress {
        stage: "transcribing_audio".into(),
        progress: 0.1,
        message: "Transcribing audio…".into(),
        ..Default::default()
    });

    if force_cpu {
        logger::info(app, "whisper", "Force CPU mode — skipping GPU backend");
    }

    // Fallback chain:
    // - After a GPU encode failure (-6), the Metal context is tainted — a second GPU
    //   attempt will silently return 0 segments in unrealistically short time.
    //   We therefore jump straight to CPU after the first GPU failure.
    // - We also detect "0 segments on non-trivial audio" (Metal corruption symptom)
    //   and treat it as a failure requiring the next fallback.
    // - force_cpu skips GPU entirely, which avoids Metal initialisation and the
    //   contamination cascade that follows a -6 error on Apple Silicon.
    let attempts: Vec<(bool, Option<&str>, &str)> = if force_cpu {
        if language.is_some() {
            vec![
                (false, language, "CPU + requested language"),
                (false, None,     "CPU + auto-detect (fallback)"),
            ]
        } else {
            vec![
                (false, language, "CPU + auto"),
            ]
        }
    } else if language.is_some() {
        vec![
            (true,  language, "GPU + requested language"),
            (false, language, "CPU + requested language (fallback)"),
            (false, None,     "CPU + auto-detect (last resort)"),
        ]
    } else {
        vec![
            (true,  language, "GPU + auto"),
            (false, language, "CPU + auto (fallback)"),
        ]
    };

    // Threshold: audio longer than 20 s returning 0 segments at >50× realtime is a
    // GPU/Metal context corruption signal. Short clips (≤20 s) skip the check because
    // fast models (e.g. tiny) can legitimately exceed 50× on very short audio.
    let audio_duration_s = audio_data.len() as f32 / SAMPLE_RATE as f32;

    let mut subtitles: Option<Vec<Subtitle>> = None;
    let mut last_err: Option<AppError> = None;
    for (i, (use_gpu, lang, label)) in attempts.iter().enumerate() {
        if i > 0 {
            logger::emit(
                app,
                "warn",
                "whisper",
                format!("Previous attempt failed, retrying: {}", label),
            );
            let _ = on_progress.send(TranscriptionProgress {
                stage: "transcribing_audio".into(),
                progress: 0.1,
                message: format!("Retrying ({})…", label),
                ..Default::default()
            });
            // Give Metal/whisper.cpp time to fully release the previous context.
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        let attempt_start = Instant::now();
        match run_inference_pass(
            app,
            model_path,
            &audio_data,
            *lang,
            on_progress,
            cancel.clone(),
            *use_gpu,
            cache,
        ) {
            Ok(s) if !s.is_empty() => {
                subtitles = Some(s);
                break;
            }
            Ok(_) => {
                // A cancel makes run_inference_pass return early with an empty result.
                // Recognise that here so it isn't misread as "0 segments at Nx realtime =
                // GPU corruption", which would cascade into CPU-reload fallbacks and end
                // as TranscriptionFailed instead of Cancelled. Break with an empty result;
                // the post-loop cancel check turns it into AppError::Cancelled.
                if cancel.load(Ordering::Relaxed) {
                    subtitles = Some(Vec::new());
                    break;
                }
                let elapsed = attempt_start.elapsed().as_secs_f32();
                let realtime = audio_duration_s / elapsed.max(0.001);
                if realtime > 50.0 && audio_duration_s > 20.0 {
                    // Unrealistically fast on non-trivial audio = GPU/Metal context corruption.
                    // (>20 s guard avoids false positives on tiny model + short clips)
                    logger::emit(
                        app,
                        "warn",
                        "whisper",
                        format!(
                            "0 segments at {:.0}×realtime on {:.0}s audio ({}) — GPU corruption, trying next backend",
                            realtime, audio_duration_s, label
                        ),
                    );
                    last_err = Some(AppError::TranscriptionFailed(format!(
                        "0 segments at {:.0}x realtime ({})",
                        realtime, label
                    )));
                    // The context that produced this is suspect — don't reuse it.
                    evict_context(cache, model_path, *use_gpu);
                    continue;
                }
                // Realistic timing with 0 segments = no speech in audio, accept result.
                logger::info(
                    app,
                    "whisper",
                    format!(
                        "0 segments on {:.0}s audio at {:.1}×realtime ({}) — no speech detected",
                        audio_duration_s, realtime, label
                    ),
                );
                subtitles = Some(Vec::new());
                break;
            }
            Err(AppError::TranscriptionFailed(msg)) if is_encode_failure(&msg) => {
                last_err = Some(AppError::TranscriptionFailed(msg));
                // A -6 encode failure taints the (Metal) context — evict before retrying.
                evict_context(cache, model_path, *use_gpu);
                continue;
            }
            Err(other) => return Err(other),
        }
    }

    let mut subtitles = subtitles.ok_or_else(|| {
        last_err.unwrap_or_else(|| {
            AppError::TranscriptionFailed("Inference failed on all backends".into())
        })
    })?;

    if cancel.load(Ordering::Relaxed) {
        logger::info(app, "whisper", "Transcription cancelled by user");
        let _ = on_progress.send(TranscriptionProgress {
            stage: "cancelled".into(),
            progress: 0.0,
            message: "Cancelled".into(),
            ..Default::default()
        });
        return Err(AppError::Cancelled);
    }

    // Reindex subtitles (run_inference_pass numbers them locally, but the final
    // index needs to be 1-based across the whole transcript).
    for (i, sub) in subtitles.iter_mut().enumerate() {
        sub.index = i + 1;
    }

    // ── Speaker detection (optional) ──────────────────────────────────────
    if enable_diarization {
        logger::info(app, "whisper", "Running speaker diarization");
        let _ = on_progress.send(TranscriptionProgress {
            stage: "detecting_speakers".into(),
            progress: 0.95,
            message: "Detecting speakers…".into(),
            ..Default::default()
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
        total: subtitles.len() as u32,
        ..Default::default()
    });

    Ok(subtitles)
}

/// True when the error string from `state.full()` indicates a whisper.cpp encode failure
/// (return code -6 from `whisper_full_with_state`). This is the well-known crash we
/// recover from by retrying with `use_gpu=false`.
fn is_encode_failure(msg: &str) -> bool {
    msg.contains("code: -6") || msg.contains("Error code: -6")
}

/// One transcription attempt for a single backend choice (GPU or CPU). Builds a fresh
/// `WhisperContext`, runs `state.full()`, and extracts segments. Used by `transcribe()`
/// with `use_gpu=true` first; on encode failure (-6), retried with `use_gpu=false`.
#[allow(clippy::too_many_arguments)]
fn run_inference_pass(
    app: &AppHandle,
    model_path: &Path,
    audio_data: &[f32],
    language: Option<&str>,
    on_progress: &Channel<TranscriptionProgress>,
    cancel: Arc<AtomicBool>,
    use_gpu: bool,
    cache: &crate::WhisperCache,
) -> Result<Vec<Subtitle>, AppError> {
    let backend = if use_gpu { "GPU" } else { "CPU" };

    // Reuse a cached context for the same model + backend; otherwise load and cache it.
    let ctx: Arc<WhisperContext> = {
        // Recover from a poisoned lock (a prior panic) rather than failing permanently —
        // the cached value is a plain Option and is safe to reuse.
        let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(c) if c.model_path == model_path && c.use_gpu == use_gpu => {
                logger::info(app, "whisper", format!("Reusing cached {} context", backend));
                c.ctx.clone()
            }
            _ => {
                let load_started = Instant::now();
                let loaded = Arc::new(load_context(app, model_path, use_gpu)?);
                *guard = Some(CachedContext {
                    model_path: model_path.to_path_buf(),
                    use_gpu,
                    ctx: loaded.clone(),
                });
                logger::info(
                    app,
                    "whisper",
                    format!(
                        "Model loaded in {:.2}s ({} backend)",
                        load_started.elapsed().as_secs_f32(),
                        backend,
                    ),
                );
                loaded
            }
        }
    };

    // ── Configure transcription params ─────────────────────────────────
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    if let Some(lang) = language {
        params.set_language(Some(lang));
        params.set_detect_language(false);
        logger::info(app, "whisper", format!("Language: {} (forced)", lang));
    } else {
        params.set_language(Some("auto"));
        params.set_detect_language(true);
        logger::info(app, "whisper", "Language: auto-detect");
    }

    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(4) as i32)
        .unwrap_or(2);
    params.set_n_threads(threads);
    logger::info(app, "whisper", format!("Threads: {}", threads));

    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(true);

    // Stream whisper.cpp's internal progress (0-100) into the channel via the raw FFI callback.
    // We use the unsafe API instead of `set_progress_callback_safe` because the latter
    // historically stored a stale stack pointer and SIGSEGV'd on first invocation.
    let cb_channel: Box<Channel<TranscriptionProgress>> = Box::new(on_progress.clone());
    let cb_ptr = &*cb_channel as *const Channel<TranscriptionProgress> as *mut c_void;
    unsafe {
        params.set_progress_callback(Some(progress_trampoline));
        params.set_progress_callback_user_data(cb_ptr);
    }

    // Raw-FFI abort callback (see `abort_trampoline` for why the `_safe` variant is unsound
    // in whisper-rs 0.16). `cancel` is an `Arc<AtomicBool>` owned by this function for the
    // entire call, so a pointer to its inner value stays valid for the duration of `state.full()`.
    let abort_ptr = Arc::as_ptr(&cancel) as *mut c_void;
    unsafe {
        params.set_abort_callback(Some(abort_trampoline));
        params.set_abort_callback_user_data(abort_ptr);
    }

    let mut state = ctx
        .create_state()
        .map_err(|e| AppError::TranscriptionFailed(format!("Failed to create state: {}", e)))?;

    let infer_started = Instant::now();
    state.full(params, audio_data).map_err(|e| {
        logger::error(app, "whisper", format!("Inference failed ({} backend): {}", backend, e));
        AppError::TranscriptionFailed(format!("Transcription failed: {}", e))
    })?;

    let duration_s = audio_data.len() as f32 / SAMPLE_RATE as f32;
    logger::info(
        app,
        "whisper",
        format!(
            "Inference finished in {:.2}s ({:.2}x realtime, {} backend)",
            infer_started.elapsed().as_secs_f32(),
            duration_s / infer_started.elapsed().as_secs_f32().max(0.001),
            backend,
        ),
    );

    drop(cb_channel);

    if cancel.load(Ordering::Relaxed) {
        // Caller handles the cancellation surface — just return empty result.
        return Ok(Vec::new());
    }

    // ── Extract segments ────────────────────────────────────────────────
    let _ = on_progress.send(TranscriptionProgress {
        stage: "extracting_segments".into(),
        progress: 0.85,
        message: "Extracting segments…".into(),
        ..Default::default()
    });

    let num_segments = state.full_n_segments();
    logger::info(app, "whisper", format!("Extracting {} segments", num_segments));

    // First id of the special-token range — anything >= this is not speech text.
    let token_eot = ctx.token_eot();

    let mut subtitles = Vec::new();

    for i in 0..num_segments {
        let segment = match state.get_segment(i) {
            Some(s) => s,
            None => continue,
        };
        let start_ts = segment.start_timestamp();
        let end_ts = segment.end_timestamp();
        let text = segment
            .to_str_lossy()
            .map_err(|e| {
                AppError::TranscriptionFailed(format!("Failed to get segment text: {}", e))
            })?
            .to_string();

        let text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }

        let start_ms = (start_ts as u64) * 10;
        let end_ms = (end_ts as u64) * 10;

        let words = extract_word_timestamps(&segment, token_eot, start_ts, end_ts);

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

        let progress = 0.85 + 0.10 * ((i + 1) as f32 / num_segments as f32);
        let _ = on_progress.send(TranscriptionProgress {
            stage: "segment_progress".into(),
            progress,
            message: format!("Segment {}/{}", i + 1, num_segments),
            index: (i + 1) as u32,
            total: num_segments as u32,
        });
    }

    Ok(subtitles)
}

/// Group BPE tokens into words and return per-word timestamps.
/// Tokens starting with a space `' '` begin a new word; all other tokens (incl.
/// punctuation) are continuations of the preceding word.
///
/// Timing strategy: the word's *end* comes from DTW alignment (`t_dtw` of its last
/// token) when the context was created with DTW enabled — DTW tracks the actual
/// speech far better than the energy heuristic. The word's *start* keeps the
/// heuristic `t0` (which detects pauses) clamped between the previous word's end and
/// this word's end. Everything is clamped to the segment bounds and forced monotonic,
/// so downstream splits can never produce out-of-order or out-of-range times.
fn extract_word_timestamps(
    segment: &whisper_rs::WhisperSegment<'_>,
    token_eot: whisper_rs::WhisperTokenId,
    seg_t0_cs: i64,
    seg_t1_cs: i64,
) -> Vec<Word> {
    struct RawWord {
        text: String,
        t0: i64,    // heuristic start of first token (centiseconds)
        t1: i64,    // heuristic end of last token (centiseconds)
        t_dtw: i64, // DTW-aligned end of last token, -1 when unavailable
    }

    let num_tokens = segment.n_tokens();
    let mut raw: Vec<RawWord> = Vec::new();
    let mut pending_break = false;

    for t in 0..num_tokens {
        let token = match segment.get_token(t) {
            Some(tok) => tok,
            None => continue,
        };

        // Skip special / control tokens ([_BEG_], [_TT_x], <|pl|>, …) by id —
        // string matching would also drop legitimate text starting with '[' or '<'.
        if token.token_id() >= token_eot {
            continue;
        }

        let token_text = match token.to_str_lossy() {
            Ok(c) => c.into_owned(),
            Err(_) => continue,
        };

        // Whitespace-only token: contributes no text, but a leading space still marks
        // a word boundary for the next token. Dropping these entirely used to glue
        // two words together silently.
        if token_text.trim().is_empty() {
            if token_text.starts_with(' ') {
                pending_break = true;
            }
            continue;
        }

        let data = token.token_data();
        let starts_word = token_text.starts_with(' ') || pending_break;
        pending_break = false;
        let piece = token_text.trim_start();

        if starts_word || raw.is_empty() {
            raw.push(RawWord {
                text: piece.to_string(),
                t0: data.t0,
                t1: data.t1,
                t_dtw: data.t_dtw,
            });
        } else if let Some(last) = raw.last_mut() {
            last.text.push_str(piece);
            last.t1 = data.t1;
            if data.t_dtw >= 0 {
                last.t_dtw = data.t_dtw;
            }
        }
    }

    let cs_to_ms = |cs: i64| (cs.max(0) * 10) as u64;

    let mut words: Vec<Word> = Vec::with_capacity(raw.len());
    let mut prev_end_cs = seg_t0_cs;
    for rw in &raw {
        let end_cs = if rw.t_dtw >= 0 { rw.t_dtw } else { rw.t1 }.clamp(prev_end_cs, seg_t1_cs);
        let start_cs = rw.t0.clamp(prev_end_cs, end_cs);
        words.push(Word {
            text: rw.text.clone(),
            start_time: cs_to_ms(start_cs),
            end_time: cs_to_ms(end_cs),
        });
        prev_end_cs = end_cs;
    }

    words
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

use crate::logger;
use crate::subtitle::style::{CaptionAnimation, CaptionStyle};
use crate::subtitle::types::{AppError, Subtitle};
use crate::VideoExport;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// Basename of the temp .ass inside the per-export burn dir. Written by the prep
/// phase and referenced bare (no path chars) in the `ass=` filtergraph.
const ASS_NAME: &str = "subs.ass";

/// RAII guard that recursively removes the per-export temp directory on EVERY
/// exit path (success, error, cancel, panic). One shot covers the .ass AND the
/// copied TTFs — all invisible internal plumbing, never surfaced.
struct TempBurnDir(std::path::PathBuf);
impl Drop for TempBurnDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Serializes `export_video`. Two overlapping exports would race on the shared
/// `VideoExport` slot: the 2nd resets `cancelled=false` (breaking the 1st's
/// cancellation) and overwrites `state.child` (leaking the 1st ffmpeg child, so
/// it can never be killed → a zombie that outlives the app). Mirrors the
/// `TRANSCRIPTION_RUNNING` pattern in transcribe.rs — `compare_exchange` admits
/// exactly one; the RAII guard clears the flag on every exit path (early return,
/// error, panic, normal completion), so a retry after the first finishes works.
static VIDEO_EXPORT_RUNNING: AtomicBool = AtomicBool::new(false);

/// Monotonic id stamped on each export. The end-of-run `state.child.take()` only
/// fires when the stored child still belongs to THIS generation, so a straggler
/// can never reap a newer export's child handle.
static VIDEO_EXPORT_GENERATION: AtomicU64 = AtomicU64::new(0);

struct VideoExportRunningGuard;

impl VideoExportRunningGuard {
    fn acquire() -> Result<Self, AppError> {
        VIDEO_EXPORT_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| VideoExportRunningGuard)
            .map_err(|_| AppError::VideoExportFailed("export already in progress".into()))
    }
}

impl Drop for VideoExportRunningGuard {
    fn drop(&mut self) {
        VIDEO_EXPORT_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// True iff `output` resolves to the same filesystem path as `video`.
///
/// `output` is the burn destination and typically does NOT exist yet, so we
/// cannot `canonicalize` it directly; and on macOS `canonicalize` rewrites
/// `/var` → `/private/var`, so a raw string compare is unsafe too. Instead we
/// canonicalize `output`'s PARENT (which must already exist) and rejoin the file
/// name, then compare against the fully-canonicalized `video`. A missing parent
/// (or missing file name) is a validation error, never a panic.
fn same_file(video: &Path, output: &Path) -> Result<bool, AppError> {
    let video_canon = std::fs::canonicalize(video)
        .map_err(|e| AppError::VideoExportFailed(format!("Cannot resolve video path: {e}")))?;
    let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            AppError::VideoExportFailed("Output path has no parent directory".to_string())
        })?;
    let parent_canon = std::fs::canonicalize(parent).map_err(|e| {
        AppError::VideoExportFailed(format!("Output directory does not exist: {e}"))
    })?;
    let file_name = output
        .file_name()
        .ok_or_else(|| AppError::VideoExportFailed("Output path has no file name".to_string()))?;
    Ok(parent_canon.join(file_name) == video_canon)
}

/// Best-effort: copy EVERY installed face belonging to `family` into `dest` so
/// libass — pointed at the dir via `fontsdir=.` — can match the requested
/// family by its name-table entry WITHOUT depending on the bundled ffmpeg's
/// libass having a working fontconfig provider (a static build may lack one on
/// some platforms). Uses the SAME fontdb enumeration the picker's
/// `list_system_fonts` sourced the family from, so a family the user could pick
/// is a family we can resolve here.
///
/// Returns true iff at least one matching face file was copied — the honest
/// signal the burn will render the requested face. Files keep their original
/// basenames (irrelevant to libass, which matches by name-table family) and
/// never touch the filtergraph, so the escape-by-elimination invariant holds.
fn copy_system_family_faces(family: &str, dest: &std::path::Path) -> bool {
    let target = family.trim().to_lowercase();
    if target.is_empty() {
        return false;
    }
    // Shared process-wide fontdb (loaded once) instead of a per-call
    // load_system_fonts — the same enumeration resolve_font_metrics uses.
    let db = crate::subtitle::ass::system_fontdb();
    let mut copied = false;
    let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
    for face in db.faces() {
        let matches = face
            .families
            .iter()
            .any(|(name, _lang)| name.trim().to_lowercase() == target);
        if !matches {
            continue;
        }
        // A single file can hold several faces (e.g. a TTC or a family's
        // weights); copy each source file at most once.
        let path = match &face.source {
            fontdb::Source::File(p) => p.clone(),
            fontdb::Source::SharedFile(p, _) => p.clone(),
            fontdb::Source::Binary(_) => continue,
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        if let Some(name) = path.file_name() {
            if std::fs::copy(&path, dest.join(name)).is_ok() {
                copied = true;
            }
        }
    }
    copied
}

/// Burn the styled + animated subtitles into an MP4 using the existing ASS
/// serializer plus the bundled ffmpeg sidecar.
///
/// Path-escaping is resolved by ELIMINATION: a per-export temp SUBDIRECTORY
/// (`<tmp>/tpro_burn_<uuid>/`) holds both the ASCII-named `.ass` and the copied
/// font TTFs, the ffmpeg child's working directory is set to that subdir, and
/// only the bare `.ass` basename plus `fontsdir=.` (the bare current dir) go
/// into the `ass=` filtergraph. The filtergraph therefore never sees a
/// directory path, colon, backslash, space, apostrophe, or quote. The video
/// input and output are ordinary argv entries (array args, no shell) so they
/// handle spaces / apostrophes / Polish chars natively.
///
/// FONTS: the picked family (`style.font_id`) is either one of the three
/// bundled families (Outfit / Inter / JetBrains Mono) or an arbitrary system
/// family the user selected. The two cases resolve differently:
///   - BUNDLED family: the burn resolves the bundled Regular+Bold TTFs from
///     `resource_dir()/fonts`, copies them into the per-export temp subdir, and
///     passes `fontsdir=.` so libass renders the real bundled faces (each TTF's
///     name-table family equals the ASS Style Fontname, so libass matches
///     instead of substituting — a guaranteed match against the app's own
///     faces). Only Regular+Bold ship, so italic is faux-synthesized by libass
///     — matching the CSS-synthesized italic in the on-screen preview. If those
///     TTFs can't be resolved or copied (e.g. a `resource_dir()` quirk under
///     `tauri dev`), the burn degrades to libass system substitution
///     (`fontsdir` omitted) rather than failing the export.
///   - SYSTEM family: the installed face(s) for that family are located via the
///     SAME fontdb enumeration the picker used and copied into the per-export
///     temp subdir, then `fontsdir=.` makes libass match them by name-table
///     family — the same installed font the on-screen preview (CSS) used, so
///     the burn stays faithful and does NOT depend on the bundled libass having
///     a working fontconfig provider. If no matching face file can be located
///     or copied (uninstalled since, a name-table casing mismatch, a
///     binary-only source), the copy is skipped, `fontsdir` is omitted, and the
///     export is reported as `"substituted"` rather than falsely claiming a
///     match.
/// `fontsdir=.` is therefore always a bare current-dir reference (bundled OR
/// system case), preserving the escape-by-elimination invariant (no path chars
/// reach the filtergraph).
///
/// Whatever `write_ass` emits burns in — style plus every animation type
/// (fade/karaoke and the entrance animations slide/pop/typewriter/blur, which
/// serialize to libass override tags); only `none` is transform-free. easing
/// and per-word delay stay preview-only (no ASS equivalent).
///
/// RETURNS a three-way tag describing how the font resolved, so the UI can tell
/// the user the truth:
///   - `"bundled"`   — bundled family + embedded app TTFs (matches the preview
///     exactly).
///   - `"system"`    — non-bundled family whose installed face(s) were located
///     and embedded so libass matches them by name (faithful: the same
///     installed font the preview used).
///   - `"substituted"` — the requested face couldn't be embedded (a bundled
///     family whose TTFs couldn't be resolved/copied, OR a system family that
///     couldn't be located on disk); `fontsdir` is omitted and libass may
///     substitute a different face (the degrade path). Never reported as a
///     match.
#[tauri::command]
pub async fn export_video(
    app: AppHandle,
    state: State<'_, VideoExport>,
    video_path: String,
    subtitles: Vec<Subtitle>,
    style: CaptionStyle,
    animation: CaptionAnimation,
    output_path: String,
    on_progress: Channel<f32>,
) -> Result<String, AppError> {
    // 0. Re-entrancy guard: admit exactly one export. A concurrent 2nd call
    //    would reset `cancelled` and clobber `state.child`, orphaning the 1st
    //    ffmpeg child. The RAII guard frees the flag on EVERY exit path below.
    let _run_guard = VideoExportRunningGuard::acquire()?;
    // Stamp this run so the end-of-run `state.child.take()` can't reap a newer
    // export's child (belt-and-suspenders alongside the running guard).
    let generation = VIDEO_EXPORT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // 1. Validate inputs up front.
    if subtitles.is_empty() {
        return Err(AppError::VideoExportFailed("no subtitles".to_string()));
    }
    if !std::path::Path::new(&video_path).exists() {
        return Err(AppError::FileError(format!(
            "Video file not found: {}",
            video_path
        )));
    }
    // Refuse to overwrite the source video with the burned output. The final
    // step is `fs::rename(tmp_out, output_path)`; without this guard,
    // output_path == video_path would clobber the user's original irreversibly.
    if same_file(Path::new(&video_path), Path::new(&output_path))? {
        return Err(AppError::VideoExportFailed(
            "Output file cannot be the source video file".to_string(),
        ));
    }
    state.cancelled.store(false, Ordering::Relaxed);

    logger::info(
        &app,
        "video",
        format!(
            "Burning {} subtitles into MP4 → {}",
            subtitles.len(),
            output_path
        ),
    );
    let started = std::time::Instant::now();

    // Bundled families ship as TTFs we can embed for a guaranteed match; any
    // other family is a system font libass must resolve via fontconfig by name.
    let bundled_family = matches!(style.font_id.trim(), "Outfit" | "Inter" | "JetBrains Mono");

    // 4. Encode to a sibling temp `.part` so an existing destination is
    //    untouched until success.
    let tmp_out = {
        let mut s = std::ffi::OsString::from(&output_path);
        s.push(format!(".{}.part", Uuid::new_v4().simple()));
        std::path::PathBuf::from(s)
    };

    // 5. Progress denominator: prefer ffmpeg's own stderr Duration banner
    //    (parsed live below); fall back to the last subtitle end time.
    let fallback_us: u64 = subtitles
        .iter()
        .map(|s| s.end_time)
        .max()
        .unwrap_or(0)
        .saturating_mul(1000);

    // 2+3. Font resolution (fontdb scan), ASS serialization, temp-dir setup and
    //    font copying are all SYNCHRONOUS fontdb / CPU / IO work — a scan of
    //    hundreds of faces plus (for CJK families) copying hundreds of MB. Run
    //    the whole phase on a blocking thread so the tokio executor is never
    //    stalled (mirrors list_system_fonts in fonts.rs). resolve_font_metrics
    //    and copy_system_family_faces now share ONE process-wide fontdb
    //    (subtitle::ass::system_fontdb), so the system fonts are enumerated at
    //    most once per process rather than twice per export.
    let (_burn_guard, have_fonts) = {
        let app_bg = app.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(TempBurnDir, bool), AppError> {
            // Resolve the caption font so the text-hugging background pill is
            // sized to real glyph metrics (degrades to a rough estimate if it
            // can't resolve; only actually measured when style.background is on).
            let bundled_fonts_dir = app_bg.path().resource_dir().ok().map(|d| d.join("fonts"));
            let font_metrics =
                crate::subtitle::ass::resolve_font_metrics(&style, bundled_fonts_dir.as_deref());
            let ass = crate::subtitle::ass::write_ass_with_metrics(
                &subtitles,
                &style,
                &animation,
                font_metrics.as_ref(),
            );

            // Per-export temp subdir holding both the .ass and the copied font
            // TTFs; the RAII guard removes the whole dir on every exit path.
            let burn_dir =
                std::env::temp_dir().join(format!("tpro_burn_{}", Uuid::new_v4().simple()));
            std::fs::create_dir_all(&burn_dir).map_err(|e| {
                AppError::VideoExportFailed(format!("Failed to create temp export dir: {e}"))
            })?;
            let burn_guard = TempBurnDir(burn_dir.clone());

            let ass_path = burn_dir.join(ASS_NAME);
            std::fs::write(&ass_path, ass).map_err(|e| {
                AppError::VideoExportFailed(format!("Failed to write temp subtitles: {e}"))
            })?;

            // For a BUNDLED family, copy the bundled Regular+Bold TTFs next to
            // the .ass so libass matches them by internal family name via
            // `fontsdir=.`. For a SYSTEM family the installed face(s) are located
            // via the shared fontdb and copied instead. Best-effort: any failure
            // degrades to libass substitution ("substituted"), never fatal.
            // Filenames are irrelevant to libass (it matches by name-table
            // family), so originals are preserved as-is.
            let mut have_fonts = false;
            if bundled_family {
                if let Ok(res_dir) = app_bg.path().resource_dir() {
                    if let Ok(entries) = std::fs::read_dir(res_dir.join("fonts")) {
                        for entry in entries.flatten() {
                            let src = entry.path();
                            let is_ttf = src
                                .extension()
                                .and_then(|e| e.to_str())
                                .is_some_and(|e| e.eq_ignore_ascii_case("ttf"));
                            if is_ttf {
                                if let Some(name) = src.file_name() {
                                    if std::fs::copy(&src, burn_dir.join(name)).is_ok() {
                                        have_fonts = true;
                                    }
                                }
                            }
                        }
                    }
                }
                if !have_fonts {
                    logger::info(
                        &app_bg,
                        "video",
                        "bundled caption fonts unavailable; libass will substitute",
                    );
                }
            } else {
                // SYSTEM family: locate + embed installed face(s) so libass
                // matches by name. copy_system_family_faces re-reads each file
                // from disk, so a font uninstalled mid-session yields false here
                // ("substituted") even though the shared fontdb still lists it —
                // the "system" vs "substituted" honesty invariant is preserved.
                have_fonts = copy_system_family_faces(style.font_id.trim(), &burn_dir);
                if !have_fonts {
                    logger::info(
                        &app_bg,
                        "video",
                        format!(
                            "requested system font '{}' not found on disk; libass will substitute",
                            style.font_id.trim()
                        ),
                    );
                }
            }
            Ok((burn_guard, have_fonts))
        })
        .await
        .map_err(|e| AppError::VideoExportFailed(format!("export prep task failed: {e}")))??
    };
    let burn_dir = _burn_guard.0.clone();

    // H3(a): the prep phase (font scan + copy) can take a while; if the user hit
    // Cancel during it, don't even start ffmpeg.
    if state.cancelled.load(Ordering::Relaxed) {
        logger::info(&app, "video", "Video export cancelled before encode start");
        return Err(AppError::Cancelled);
    }

    // 6. Spawn the bundled ffmpeg sidecar.
    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::VideoExportFailed(format!("Bundled FFmpeg sidecar unavailable: {e}")))?;

    // fontsdir=. is a bare current-dir reference (no path chars), so it
    // preserves the escape-by-elimination property. `have_fonts` is true
    // whenever we embedded faces into the temp dir — bundled TTFs OR the
    // located system-family faces (see copy_system_family_faces) — so libass
    // matches the requested family by name. It is omitted only on the degrade
    // path where nothing could be copied ("substituted"), letting libass
    // substitute a default face.
    let vf = if have_fonts {
        format!("ass={}:fontsdir=.", ASS_NAME)
    } else {
        format!("ass={}", ASS_NAME)
    };
    let tmp_out_str = tmp_out.to_string_lossy().to_string();
    let args: Vec<&str> = vec![
        "-nostdin",
        "-y",
        "-i",
        &video_path,
        "-vf",
        &vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        // Transcode audio to AAC rather than stream-copying it. The Rail gate
        // admits mkv/avi/mov/webm inputs whose native audio (Vorbis, Opus,
        // FLAC, PCM, …) has no MP4 tag; `-c:a copy` would make the `-f mp4`
        // muxer abort with "Could not find tag for codec …", failing the whole
        // burn-in after the video re-encode. AAC muxes into MP4 for every
        // permitted container. (`-c:a aac` is a no-op when the input has no
        // audio stream.)
        "-c:a",
        "aac",
        "-f",
        "mp4",
        "-progress",
        "pipe:1",
        "-nostats",
        &tmp_out_str,
    ];

    let (mut rx, child) = sidecar
        .current_dir(&burn_dir)
        .args(args)
        .spawn()
        .map_err(|e: tauri_plugin_shell::Error| {
            let msg = format!("FFmpeg execution failed: {e}");
            logger::error(&app, "video", &msg);
            AppError::VideoExportFailed(msg)
        })?;

    // 7. Publish the child so cancel_video_export (or app shutdown) can kill it.
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }

    // H3(b): close the cancel race — if Cancel fired between the pre-spawn check
    // and publishing the child, kill it now instead of running the full encode.
    if state.cancelled.load(Ordering::Relaxed) {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
        logger::info(&app, "video", "Video export cancelled");
        return Err(AppError::Cancelled);
    }

    // Progress throttle — copied from download_to_temp in transcribe.rs.
    let mut last_sent_progress: f32 = -1.0;
    let mut last_sent_at = std::time::Instant::now();

    let mut stderr = String::new();
    let mut total_us: u64 = 0;
    let mut exit_code: Option<i32> = None;
    let mut saw_end = false;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let chunk = String::from_utf8_lossy(&bytes);
                for line in chunk.lines() {
                    if let Some(us) = parse_progress_out_time_us(line) {
                        let have_real_duration = total_us > 0;
                        let denom = if have_real_duration { total_us } else { fallback_us };
                        if denom > 0 {
                            // With ffmpeg's container Duration banner the 0..1
                            // fraction is accurate. With only the subtitle-based
                            // fallback — a LOWER bound on the true video length —
                            // out_time overtakes the denominator long before the
                            // encode finishes, so cap below 1.0: the bar keeps
                            // climbing but never shows a false "done". The genuine
                            // 1.0 is emitted once after the loop on real completion.
                            let ceiling = if have_real_duration { 1.0 } else { 0.99 };
                            let frac = (us as f32 / denom as f32).clamp(0.0, ceiling);
                            if frac - last_sent_progress >= 0.01
                                || last_sent_at.elapsed() >= std::time::Duration::from_millis(100)
                            {
                                let _ = on_progress.send(frac);
                                last_sent_progress = frac;
                                last_sent_at = std::time::Instant::now();
                            }
                        }
                    } else if line.trim() == "progress=end" {
                        saw_end = true;
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                let chunk = String::from_utf8_lossy(&bytes);
                // Scan for the Duration banner until we find it.
                if total_us == 0 {
                    if let Some(us) = parse_duration_banner(&chunk) {
                        total_us = us;
                    }
                }
                stderr.push_str(&chunk);
                // Keep the accumulated stderr bounded (ffmpeg is chatty).
                if stderr.len() > 64 * 1024 {
                    let tail = stderr.split_at(stderr.len() - 32 * 1024).1.to_string();
                    stderr = tail;
                }
            }
            CommandEvent::Error(e) => stderr.push_str(&e),
            CommandEvent::Terminated(payload) => exit_code = payload.code,
            _ => {}
        }
    }

    // Release the stored child (cancel may already have taken it). Only reclaim
    // it if no newer export has since superseded this generation, so a slow
    // cleanup here never reaps another export's child handle.
    if VIDEO_EXPORT_GENERATION.load(Ordering::SeqCst) == generation {
        if let Ok(mut guard) = state.child.lock() {
            let _ = guard.take();
        }
    }

    // 8. Cancelled → discard the partial output, do NOT rename.
    if state.cancelled.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&tmp_out);
        logger::info(&app, "video", "Video export cancelled");
        return Err(AppError::Cancelled);
    }

    // Non-zero exit → discard partial output. The FULL stderr goes to the log;
    // the UI banner gets only a short, secret-redacted summary (not 32 KB of
    // raw stderr with full paths / metadata).
    if exit_code != Some(0) {
        let _ = std::fs::remove_file(&tmp_out);
        let full = if stderr.trim().is_empty() {
            format!("ffmpeg exited with code {exit_code:?}")
        } else {
            stderr.trim().to_string()
        };
        logger::error(&app, "video", format!("ffmpeg failed: {full}"));
        return Err(AppError::VideoExportFailed(summarize_ffmpeg_stderr(&full)));
    }

    // Success: emit a final 1.0 (throttle may have swallowed it).
    if saw_end || exit_code == Some(0) {
        let _ = on_progress.send(1.0);
    }

    // 9. Promote the temp output to the real destination.
    std::fs::rename(&tmp_out, &output_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_out);
        AppError::VideoExportFailed(format!("Failed to finalize output file: {e}"))
    })?;

    logger::info(
        &app,
        "video",
        format!(
            "Video export ready in {:.2}s — {}",
            started.elapsed().as_secs_f32(),
            output_path
        ),
    );
    // Return a three-way tag describing how the font resolved so the UI can
    // tell the user the truth. `have_fonts` is the honest signal that the
    // requested face was actually embedded (copied into the fontsdir libass
    // reads); it is the gate for BOTH faithful outcomes:
    //   - "bundled"     = a bundled family's embedded app TTFs (matches preview);
    //   - "system"      = a non-bundled family whose installed face(s) we
    //                     located and embedded (same face the preview used);
    //   - "substituted" = the requested face couldn't be embedded (bundled TTFs
    //                     unavailable OR system family not found on disk), so
    //                     `fontsdir` was omitted and libass may substitute. We
    //                     never claim a match we didn't embed.
    let outcome = if !have_fonts {
        "substituted"
    } else if bundled_family {
        "bundled"
    } else {
        "system"
    };
    Ok(outcome.to_string())
    // _burn_guard drops here, recursively removing the temp subdir (.ass + TTFs).
}

/// Cancel an in-progress video export by killing the ffmpeg child process.
/// Mirrors `cancel_audio_extraction`.
#[tauri::command]
pub async fn cancel_video_export(
    app: AppHandle,
    state: State<'_, VideoExport>,
) -> Result<(), AppError> {
    state.cancelled.store(true, Ordering::Relaxed);
    let child = state.child.lock().ok().and_then(|mut g| g.take());
    if let Some(child) = child {
        let _ = child.kill();
        logger::info(&app, "video", "Video export cancellation requested");
    }
    Ok(())
}

/// Condense ffmpeg's verbose stderr into a short, UI-safe message: prefer the
/// last line mentioning an error, else the last ~300 chars. The FULL stderr is
/// still written to the log (see the caller) — this only trims what crosses to
/// the banner. Also redacts anything resembling a provider API key
/// (defense-in-depth: ffmpeg stderr shouldn't carry one, but URLs/paths might).
fn summarize_ffmpeg_stderr(stderr: &str) -> String {
    let trimmed = stderr.trim();
    let picked = trimmed
        .lines()
        .rev()
        .find(|l| {
            let ll = l.to_lowercase();
            ll.contains("error") || ll.contains("invalid") || ll.contains("failed")
        })
        .map(|l| l.trim().to_string())
        .unwrap_or_else(|| {
            let n = trimmed.chars().count();
            let start = n.saturating_sub(300);
            trimmed.chars().skip(start).collect::<String>().trim().to_string()
        });
    crate::translation::redact_secrets(&picked)
}

/// Parse ffmpeg's `-progress pipe:1` key=value lines for the current output
/// time in microseconds. Reads `out_time_us=`; if only the legacy
/// `out_time_ms=` is present, it too is treated as microseconds (ffmpeg's
/// `out_time_ms` has historically carried microseconds, not milliseconds).
/// Returns None for any other line (including `out_time_us=N/A`).
fn parse_progress_out_time_us(line: &str) -> Option<u64> {
    let line = line.trim();
    let value = line
        .strip_prefix("out_time_us=")
        .or_else(|| line.strip_prefix("out_time_ms="))?;
    value.trim().parse::<u64>().ok()
}

/// Parse ffmpeg's stderr `Duration: HH:MM:SS.cs` banner into microseconds.
/// Scans for the first line containing "Duration:"; returns None if absent or
/// malformed (e.g. "Duration: N/A").
fn parse_duration_banner(text: &str) -> Option<u64> {
    for line in text.lines() {
        if let Some(idx) = line.find("Duration:") {
            let rest = &line[idx + "Duration:".len()..];
            // Take the token up to the first comma, e.g. " 00:01:02.50,".
            let token = rest.split(',').next()?.trim();
            if let Some(us) = parse_hms_cs(token) {
                return Some(us);
            }
        }
    }
    None
}

/// Parse an `HH:MM:SS.cs` (centiseconds) timestamp into microseconds.
fn parse_hms_cs(token: &str) -> Option<u64> {
    let mut parts = token.split(':');
    let h: u64 = parts.next()?.trim().parse().ok()?;
    let m: u64 = parts.next()?.trim().parse().ok()?;
    let sec_part = parts.next()?.trim();
    if parts.next().is_some() {
        return None; // more than 3 colon-separated fields
    }
    let mut sec_split = sec_part.split('.');
    let s: u64 = sec_split.next()?.parse().ok()?;
    let frac_us: u64 = match sec_split.next() {
        Some(frac) => {
            // Interpret the fractional part with up to 6 digits of precision.
            let digits: String = frac.chars().take(6).collect();
            if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let scale = 10u64.pow(6 - digits.len() as u32);
            digits.parse::<u64>().ok()? * scale
        }
        None => 0,
    };
    Some(((h * 3600 + m * 60 + s) * 1_000_000) + frac_us)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_banner_basic() {
        let line = "  Duration: 00:01:02.50, start: 0.000000, bitrate: 1234 kb/s";
        assert_eq!(parse_duration_banner(line), Some(62_500_000));
    }

    #[test]
    fn duration_banner_hours() {
        let line = "  Duration: 01:00:00.00, start: 0.0";
        assert_eq!(parse_duration_banner(line), Some(3_600_000_000));
    }

    #[test]
    fn duration_banner_na_returns_none() {
        assert_eq!(parse_duration_banner("  Duration: N/A, start: 0.0"), None);
    }

    #[test]
    fn duration_banner_absent_returns_none() {
        assert_eq!(parse_duration_banner("Stream #0:0: Video: h264"), None);
    }

    #[test]
    fn progress_out_time_us() {
        assert_eq!(parse_progress_out_time_us("out_time_us=62500000"), Some(62_500_000));
    }

    #[test]
    fn progress_out_time_ms_treated_as_us() {
        assert_eq!(parse_progress_out_time_us("out_time_ms=62500000"), Some(62_500_000));
    }

    #[test]
    fn progress_out_time_na_returns_none() {
        assert_eq!(parse_progress_out_time_us("out_time_us=N/A"), None);
    }

    #[test]
    fn progress_end_is_not_a_time() {
        assert_eq!(parse_progress_out_time_us("progress=end"), None);
    }

    #[test]
    fn progress_end_detected_via_trim() {
        assert_eq!("progress=end".trim(), "progress=end");
    }

    #[test]
    fn same_file_rejects_identical_path() {
        let dir = std::env::temp_dir().join(format!("tpro_same_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("clip.mp4");
        std::fs::write(&video, b"x").unwrap();

        // video_path == output_path must be caught even though output "exists"
        // here; the guard is about the destination equaling the source.
        assert!(same_file(&video, &video).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_file_accepts_distinct_paths_in_same_dir() {
        let dir = std::env::temp_dir().join(format!("tpro_same_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("clip.mp4");
        std::fs::write(&video, b"x").unwrap();
        // The output need NOT exist yet — its parent dir does, which is all
        // same_file requires.
        let output = dir.join("out.mp4");

        assert!(!same_file(&video, &output).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn summarize_ffmpeg_prefers_error_line_and_redacts() {
        let stderr = "frame= 10 fps=5 q=28.0 size=1kB time=00:00:00.40\n\
[libx264 @ 0x7f] using cpu capabilities: ARMv8\n\
leaked key AIzaSyA1234567890abcdefghijklmnopqrstuvwx in a path\n\
Error: Invalid data found when processing input";
        let s = summarize_ffmpeg_stderr(stderr);
        assert_eq!(s, "Error: Invalid data found when processing input");
        assert!(!s.contains("AIzaSy"));
    }

    #[test]
    fn summarize_ffmpeg_redacts_key_in_fallback_tail() {
        // No error/invalid/failed keyword → fall back to the tail, still redacted.
        let stderr = "loading font AIzaSyA1234567890abcdefghijklmnopqrstuvwx done";
        let s = summarize_ffmpeg_stderr(stderr);
        assert!(!s.contains("AIzaSy"), "key must be redacted: {s}");
    }

    #[test]
    fn same_file_errors_when_output_parent_missing() {
        let dir = std::env::temp_dir().join(format!("tpro_same_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("clip.mp4");
        std::fs::write(&video, b"x").unwrap();
        // Parent directory does not exist → a clean validation error, not panic.
        let output = dir.join("nope").join("out.mp4");

        assert!(same_file(&video, &output).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// End-to-end burn smoke: drive a REAL ffmpeg over the exact `write_ass` output
/// + filtergraph shape that `export_video` uses, and assert an MP4 with a video
/// stream comes out. This is the automated proxy for the manual "burn a styled
/// MP4 and eyeball it" release check (BACKLOG: MP4 burn-in was verified by
/// fixture-frame inspection, never by an automated run).
///
/// What it guards against, that the string-only parser tests above cannot:
///   - `write_ass` emitting ASS that libass rejects (a parse error aborts the
///     burn — caught here as a non-zero ffmpeg exit / missing output),
///   - the `ass=<basename>:fontsdir=.` + `current_dir` bundled-font recipe
///     silently breaking,
///   - any animation variant ("all animations now export/burn") producing a
///     filtergraph libass won't accept.
///
/// Gated on an ffmpeg with the `ass` filter (the shipped sidecar has one; a dev
/// Homebrew ffmpeg does too). Set `TPRO_TEST_FFMPEG` to point at a specific
/// binary. When no suitable ffmpeg is found the test SKIPS with a printed
/// notice rather than failing — it must never be a false red on a machine that
/// simply lacks ffmpeg, but the skip is always logged (never silent).
///
/// NOTE: the ffmpeg args here MUST mirror `export_video` (see the `-vf` +
/// encoder block around the `sidecar("ffmpeg")` call). If that invocation
/// changes, update this test in lockstep.
#[cfg(test)]
mod burn_smoke {
    use crate::subtitle::style::{CaptionAnimation, CaptionStyle};
    use crate::subtitle::types::Subtitle;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use uuid::Uuid;

    fn sub(index: usize, start_ms: u64, end_ms: u64, text: &str) -> Subtitle {
        Subtitle {
            id: Uuid::new_v4().to_string(),
            index,
            start_time: start_ms,
            end_time: end_ms,
            text: text.to_string(),
            words: Vec::new(),
            speaker: None,
        }
    }

    /// Locate an ffmpeg with the `ass` filter compiled in. Returns None (with a
    /// logged reason) when the environment can't run the smoke.
    fn find_ffmpeg_with_ass() -> Option<String> {
        let bin = std::env::var("TPRO_TEST_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_string());
        // A provided path (possibly relative, e.g. the CI sidecar) is made
        // absolute so it still resolves once the burn runs with `current_dir`
        // set to a temp folder. A bare command name ("ffmpeg") fails to
        // canonicalize and is left for PATH resolution.
        let bin = std::fs::canonicalize(&bin)
            .map(|abs| abs.to_string_lossy().into_owned())
            .unwrap_or(bin);
        let out = match Command::new(&bin).arg("-hide_banner").arg("-filters").output() {
            Ok(o) => o,
            Err(e) => {
                eprintln!("[burn_smoke] SKIP: cannot run '{bin}' (-filters): {e}");
                return None;
            }
        };
        let filters = String::from_utf8_lossy(&out.stdout);
        // ffmpeg -filters lines look like: " ... ass  V->V  Render ASS subtitles..."
        let has_ass = filters
            .lines()
            .any(|l| l.split_whitespace().nth(1) == Some("ass"));
        if !has_ass {
            eprintln!("[burn_smoke] SKIP: ffmpeg '{bin}' has no `ass` filter (libass missing)");
            return None;
        }
        Some(bin)
    }

    /// Copy the bundled caption TTFs (Regular+Bold of Outfit/Inter/JetBrains
    /// Mono) next to the .ass, exactly as the bundled-family burn path does.
    fn copy_bundled_fonts(dest: &Path) -> bool {
        let fonts_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let Ok(entries) = std::fs::read_dir(&fonts_dir) else {
            return false;
        };
        let mut any = false;
        for entry in entries.flatten() {
            let src = entry.path();
            let is_ttf = src
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("ttf"));
            if is_ttf {
                if let Some(name) = src.file_name() {
                    if std::fs::copy(&src, dest.join(name)).is_ok() {
                        any = true;
                    }
                }
            }
        }
        any
    }

    /// Run ffmpeg and return (success, combined stderr).
    fn run(bin: &str, cwd: &Path, args: &[&str]) -> (bool, String) {
        let out = Command::new(bin)
            .current_dir(cwd)
            .args(args)
            .output()
            .expect("ffmpeg spawn failed");
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        (out.status.success(), stderr)
    }

    #[test]
    fn styled_subtitles_burn_into_a_playable_mp4() {
        let Some(ffmpeg) = find_ffmpeg_with_ass() else {
            return; // environment gate — reason already logged
        };

        let dir = std::env::temp_dir().join(format!("tpro_burn_smoke_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _guard = Cleanup(dir.clone());

        // 1. A 1-second silent test clip to burn onto (absolute path input).
        let input = dir.join("input.mp4");
        let input_str = input.to_string_lossy().to_string();
        let (ok, err) = run(
            &ffmpeg,
            &dir,
            &[
                "-nostdin", "-y", "-f", "lavfi", "-i",
                "color=c=black:s=320x180:d=1:r=15", "-c:v", "libx264", "-t", "1", &input_str,
            ],
        );
        assert!(ok, "generating the test input clip failed:\n{err}");
        assert!(input.exists(), "test input clip was not written");

        // 2. The app's own ASS, with the bundled Outfit style, background pill +
        //    drop shadow ENABLED (so the measured rounded-rect drawing and the
        //    offset shadow copy are exercised by real libass), plus Unicode + a
        //    brace to exercise escaping.
        let subs = vec![sub(1, 0, 900, "Smoke żółć {test}")];
        let style = CaptionStyle {
            background: true,
            shadow: true,
            ..CaptionStyle::default()
        };
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let metrics = crate::subtitle::ass::resolve_font_metrics(&style, Some(&fonts));
        let ass = crate::subtitle::ass::write_ass_with_metrics(
            &subs,
            &style,
            &CaptionAnimation::default(),
            metrics.as_ref(),
        );
        let ass_name = "smoke.ass";
        std::fs::write(dir.join(ass_name), &ass).unwrap();

        let have_fonts = copy_bundled_fonts(&dir);
        // Bundled TTFs live in-repo; if this ever regresses the burn would fall
        // back to substitution, which is a real signal worth failing on here.
        assert!(have_fonts, "bundled caption fonts were not copied from src-tauri/fonts");

        // 3. Burn — same filtergraph + encoder flags as `export_video`.
        let out = dir.join("out.mp4");
        let out_str = out.to_string_lossy().to_string();
        let vf = format!("ass={ass_name}:fontsdir=.");
        let (ok, err) = run(
            &ffmpeg,
            &dir,
            &[
                "-nostdin", "-y", "-i", &input_str, "-vf", &vf, "-c:v", "libx264",
                "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-f", "mp4", &out_str,
            ],
        );
        assert!(ok, "burn-in ffmpeg run failed (libass likely rejected the ASS):\n{err}");
        let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
        assert!(size > 1024, "burned MP4 is missing or too small ({size} bytes)");

        // 4. Probe the result: ffmpeg -i on a file with no output exits 1 but
        //    prints the stream table to stderr. Assert a real video stream and
        //    a ~1s duration made it in.
        let (_ok, probe) = run(&ffmpeg, &dir, &["-hide_banner", "-i", &out_str]);
        assert!(probe.contains("Video:"), "no video stream in the burned MP4:\n{probe}");
        assert!(
            probe.contains("Duration: 00:00:0"),
            "unexpected duration in the burned MP4:\n{probe}"
        );
    }

    /// Every animation type must burn without libass rejecting the emitted ASS.
    /// This is the automated backstop for "all animations now export/burn"
    /// (fade, karaoke, pop, blur, slide, typewriter) — the string tests check
    /// the emitted tags, this proves libass actually accepts them.
    #[test]
    fn every_animation_type_burns() {
        let Some(ffmpeg) = find_ffmpeg_with_ass() else {
            return;
        };

        let dir = std::env::temp_dir().join(format!("tpro_burn_anim_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _guard = Cleanup(dir.clone());

        let input = dir.join("input.mp4");
        let input_str = input.to_string_lossy().to_string();
        let (ok, err) = run(
            &ffmpeg,
            &dir,
            &[
                "-nostdin", "-y", "-f", "lavfi", "-i",
                "color=c=black:s=320x180:d=1:r=15", "-c:v", "libx264", "-t", "1", &input_str,
            ],
        );
        assert!(ok, "generating the test input clip failed:\n{err}");
        copy_bundled_fonts(&dir);

        let subs = vec![sub(1, 0, 900, "Multi word żółć line")];
        // (label, type, granularity, direction, karaokeHighlight) covering the
        // full new set plus the granularity/direction/highlight variants, so
        // libass is exercised on every override-tag shape the serializer emits —
        // including the positioned per-word \move events and karaoke box drawings.
        let cases: [(&str, &str, &str, &str, &str); 17] = [
            ("none", "none", "word", "in", "text"),
            ("fade", "fade", "word", "in", "text"),
            ("scale_word", "scale", "word", "in", "text"),
            ("scale_line", "scale", "line", "in", "text"),
            ("typewriter", "typewriter", "char", "in", "text"),
            ("decode", "decode", "char", "in", "text"),
            ("slide_word", "slide", "word", "in", "text"),
            ("slide_line", "slide", "line", "in", "text"),
            ("blur_in", "blur", "word", "in", "text"),
            ("blur_left", "blur", "word", "left", "text"),
            ("colorshift", "colorShift", "word", "in", "text"),
            ("blurdrop_up", "blurDrop", "word", "up", "text"),
            ("staircase_word", "staircase", "word", "down", "text"),
            ("staircase_sentence", "staircase", "sentence", "up", "text"),
            ("karaoke_text", "karaoke", "word", "in", "text"),
            ("karaoke_background", "karaoke", "word", "in", "background"),
            ("karaoke_both", "karaoke", "word", "in", "both"),
        ];
        for (label, anim_type, granularity, direction, highlight) in cases {
            let anim = CaptionAnimation {
                anim_type: anim_type.to_string(),
                granularity: granularity.to_string(),
                direction: direction.to_string(),
                karaoke_highlight: highlight.to_string(),
                ..CaptionAnimation::default()
            };
            let ass = crate::subtitle::ass::write_ass(&subs, &CaptionStyle::default(), &anim);
            let ass_name = format!("anim_{label}.ass");
            std::fs::write(dir.join(&ass_name), &ass).unwrap();

            let out_name = format!("out_{label}.mp4");
            let out = dir.join(&out_name);
            let out_str = out.to_string_lossy().to_string();
            let vf = format!("ass={ass_name}:fontsdir=.");
            let (ok, err) = run(
                &ffmpeg,
                &dir,
                &[
                    "-nostdin", "-y", "-i", &input_str, "-vf", &vf, "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-f", "mp4", &out_str,
                ],
            );
            assert!(ok, "animation '{label}' failed to burn (libass rejected its ASS):\n{err}");
            let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            assert!(size > 1024, "animation '{label}' produced a too-small MP4 ({size} bytes)");
        }
    }
}

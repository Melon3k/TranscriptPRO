use crate::logger;
use crate::subtitle::style::{CaptionAnimation, CaptionStyle};
use crate::subtitle::types::{AppError, Subtitle};
use crate::VideoExport;
use std::sync::atomic::Ordering;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// RAII guard that recursively removes the per-export temp directory on EVERY
/// exit path (success, error, cancel, panic). One shot covers the .ass AND the
/// copied TTFs — all invisible internal plumbing, never surfaced.
struct TempBurnDir(std::path::PathBuf);
impl Drop for TempBurnDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
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
/// FONTS: the burn resolves the bundled Regular+Bold TTFs from
/// `resource_dir()/fonts`, copies them into the per-export temp subdir, and
/// passes `fontsdir=.` so libass renders the real Outfit / Inter / JetBrains
/// Mono faces (each TTF's name-table family equals the ASS Style Fontname, so
/// libass matches instead of substituting). Only Regular+Bold ship, so italic
/// is faux-synthesized by libass — matching the CSS-synthesized italic in the
/// on-screen preview. If the bundled fonts can't be resolved or copied (e.g. a
/// `resource_dir()` quirk under `tauri dev`), the burn degrades to libass
/// system substitution (`fontsdir` omitted) rather than failing the export.
///
/// Only STYLE + FADE + KARAOKE burn in — exactly what `write_ass` emits. The
/// four preview-only animations (slide/pop/typewriter/blur) serialize to a
/// plain body just as they do for the .ass text export, so they are silently
/// not-animated in the burn (accepted decision).
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
) -> Result<bool, AppError> {
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

    // 2. Serialize ASS via the EXISTING serializer (no duplicated ASS logic).
    let ass = crate::subtitle::ass::write_ass(&subtitles, &style, &animation);

    // 3. Per-export temp subdir holding both the .ass and the copied font
    //    TTFs; the RAII guard removes the whole dir on every exit path.
    let burn_dir = std::env::temp_dir().join(format!("tpro_burn_{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&burn_dir).map_err(|e| {
        AppError::VideoExportFailed(format!("Failed to create temp export dir: {e}"))
    })?;
    let _burn_guard = TempBurnDir(burn_dir.clone());

    let ass_name = "subs.ass";
    let ass_path = burn_dir.join(ass_name);
    std::fs::write(&ass_path, ass)
        .map_err(|e| AppError::VideoExportFailed(format!("Failed to write temp subtitles: {e}")))?;

    // 3b. Copy the bundled Regular+Bold TTFs next to the .ass so libass can
    //     match them by internal family name via `fontsdir=.`. Best-effort:
    //     any failure degrades to libass system substitution, never fatal.
    //     Filenames are irrelevant to libass (it matches by name-table family),
    //     so originals are preserved as-is.
    let mut have_fonts = false;
    if let Ok(res_dir) = app.path().resource_dir() {
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
            &app,
            "video",
            "bundled caption fonts unavailable; libass will substitute",
        );
    }

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

    // 6. Spawn the bundled ffmpeg sidecar.
    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::VideoExportFailed(format!("Bundled FFmpeg sidecar unavailable: {e}")))?;

    // fontsdir=. is a bare current-dir reference (no path chars), so it
    // preserves the escape-by-elimination property. Omitted when no fonts were
    // copied so libass falls back to system substitution.
    let vf = if have_fonts {
        format!("ass={}:fontsdir=.", ass_name)
    } else {
        format!("ass={}", ass_name)
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

    // Release the stored child (cancel may already have taken it).
    if let Ok(mut guard) = state.child.lock() {
        let _ = guard.take();
    }

    // 8. Cancelled → discard the partial output, do NOT rename.
    if state.cancelled.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&tmp_out);
        logger::info(&app, "video", "Video export cancelled");
        return Err(AppError::Cancelled);
    }

    // Non-zero exit → discard partial output, return stderr tail.
    if exit_code != Some(0) {
        let _ = std::fs::remove_file(&tmp_out);
        let detail = if stderr.trim().is_empty() {
            format!("ffmpeg exited with code {exit_code:?}")
        } else {
            stderr.trim().to_string()
        };
        logger::error(&app, "video", format!("ffmpeg failed: {detail}"));
        return Err(AppError::VideoExportFailed(detail));
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
    // Return whether the bundled fonts were embedded so the UI can tell the
    // user the truth: `true` = burned with the app's own faces (matches the
    // preview), `false` = libass substituted a system face (degrade path).
    Ok(have_fonts)
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
}

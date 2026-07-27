use crate::logger;
use crate::subtitle::types::AppError;
use crate::PreviewState;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// Result of preparing a WKWebView-playable preview for an input video.
/// `preview_path` is `Some` ONLY when a proxy was transcoded; when the original
/// is already WKWebView-safe it's `None` and the frontend plays the original.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInfo {
    pub preview_path: Option<String>,
    pub needs_proxy: bool,
    pub width: u32,
    pub height: u32,
}

/// Transcode progress, 0–100.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewProgress {
    pub pct: f32,
}

/// Serializes `prepare_preview`: a 2nd concurrent call would race on the shared
/// `PreviewState` slot (reset `cancelled`, clobber `child`, orphan the 1st
/// ffmpeg). Mirrors `VIDEO_EXPORT_RUNNING`; the RAII guard clears the flag on
/// every exit path.
static PREVIEW_RUNNING: AtomicBool = AtomicBool::new(false);

struct PreviewRunningGuard;

impl PreviewRunningGuard {
    fn acquire() -> Result<Self, AppError> {
        PREVIEW_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| PreviewRunningGuard)
            .map_err(|_| AppError::Other("preview already in progress".into()))
    }
}

impl Drop for PreviewRunningGuard {
    fn drop(&mut self) {
        PREVIEW_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Probe facts extracted from ffmpeg's stderr `-i` banner.
struct ProbeResult {
    width: u32,
    height: u32,
    /// Display-matrix rotation in degrees (signed, as ffmpeg reports it).
    rotation: i32,
    has_video: bool,
}

/// Prepare a preview source the app's WKWebView can actually render.
///
/// WKWebView's `<video>` chokes on some inputs (confirmed: 4K H.264 with a 90°
/// display-matrix rotation renders a frozen/half-green frame with audio only),
/// while the same file plays fine in QuickTime. So we probe the input and, when
/// it's oversized or rotation-flagged, transcode a small upright 4:2:0 proxy the
/// webview handles. Otherwise the frontend plays the original untouched.
#[tauri::command]
pub async fn prepare_preview(
    app: AppHandle,
    input_path: String,
    on_progress: Channel<PreviewProgress>,
    state: State<'_, PreviewState>,
) -> Result<PreviewInfo, AppError> {
    let _run_guard = PreviewRunningGuard::acquire()?;
    state.cancelled.store(false, Ordering::Relaxed);

    if !Path::new(&input_path).exists() {
        return Err(AppError::FileError(format!(
            "Preview input not found: {input_path}"
        )));
    }

    // 1. Probe (ffmpeg -i, no output — exits 1, facts go to stderr).
    let probe = run_probe(&app, &input_path, &state).await?;
    if !probe.has_video {
        // Audio-only: nothing to preview visually, no proxy needed.
        return Ok(PreviewInfo {
            preview_path: None,
            needs_proxy: false,
            width: 0,
            height: 0,
        });
    }

    // 2. Decide.
    if !needs_proxy(probe.width, probe.height, probe.rotation) {
        return Ok(PreviewInfo {
            preview_path: None,
            needs_proxy: false,
            width: probe.width,
            height: probe.height,
        });
    }

    // Cancelled during/after the probe → stop before the expensive transcode.
    if state.cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    logger::info(
        &app,
        "preview",
        format!(
            "Transcoding preview proxy ({}x{}, rotation {}) for {}",
            probe.width, probe.height, probe.rotation, input_path
        ),
    );
    let started = Instant::now();

    // 3. Transcode a webview-friendly proxy. Default ffmpeg autorotate bakes the
    //    display-matrix rotation into the frames and clears the matrix, so the
    //    proxy is already upright; scale to ≤720p on the short side, force 4:2:0,
    //    +faststart for progressive play.
    let out_path = std::env::temp_dir().join(format!("tpro_proxy_{}.mp4", Uuid::new_v4().simple()));
    let out_str = out_path.to_string_lossy().to_string();

    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| {
        AppError::Other(format!("Bundled FFmpeg sidecar unavailable: {e}"))
    })?;
    let (mut rx, child) = sidecar
        .args([
            "-nostdin",
            "-i",
            &input_path,
            "-vf",
            "scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-y",
            &out_str,
        ])
        .spawn()
        .map_err(|e: tauri_plugin_shell::Error| {
            let msg = format!("FFmpeg execution failed: {e}");
            logger::error(&app, "preview", &msg);
            AppError::Other(msg)
        })?;

    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }
    // Close the cancel race: if cancel fired between the pre-spawn check and
    // publishing the child, kill it now instead of running the full transcode.
    if state.cancelled.load(Ordering::Relaxed) {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
        let _ = std::fs::remove_file(&out_path);
        return Err(AppError::Cancelled);
    }

    let mut stderr = String::new();
    let mut total_us: u64 = 0;
    let mut exit_code: Option<i32> = None;
    let mut last_pct: f32 = -1.0;
    let mut last_at = Instant::now();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(bytes) => {
                let chunk = String::from_utf8_lossy(&bytes);
                if total_us == 0 {
                    if let Some(us) = parse_duration_us(&chunk) {
                        total_us = us;
                    }
                }
                for line in chunk.lines() {
                    if let Some(us) = parse_time_us(line) {
                        if total_us > 0 {
                            let pct = ((us as f32 / total_us as f32) * 100.0).clamp(0.0, 99.0);
                            if pct - last_pct >= 1.0
                                || last_at.elapsed() >= Duration::from_millis(100)
                            {
                                let _ = on_progress.send(PreviewProgress { pct });
                                last_pct = pct;
                                last_at = Instant::now();
                            }
                        }
                    }
                }
                stderr.push_str(&chunk);
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

    if let Ok(mut guard) = state.child.lock() {
        let _ = guard.take();
    }

    if state.cancelled.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&out_path);
        logger::info(&app, "preview", "Preview transcode cancelled");
        return Err(AppError::Cancelled);
    }

    if exit_code != Some(0) {
        let _ = std::fs::remove_file(&out_path);
        logger::error(&app, "preview", format!("ffmpeg failed: {}", stderr.trim()));
        let tail: String = {
            let t = stderr.trim();
            let n = t.chars().count();
            t.chars().skip(n.saturating_sub(300)).collect()
        };
        return Err(AppError::Other(crate::translation::redact_secrets(&tail)));
    }

    let _ = on_progress.send(PreviewProgress { pct: 100.0 });
    logger::info(
        &app,
        "preview",
        format!(
            "Preview proxy ready in {:.2}s — {}",
            started.elapsed().as_secs_f32(),
            out_str
        ),
    );
    Ok(PreviewInfo {
        preview_path: Some(out_str),
        needs_proxy: true,
        width: probe.width,
        height: probe.height,
    })
}

/// Cancel an in-progress preview preparation by killing the ffmpeg child.
#[tauri::command]
pub async fn cancel_preview(state: State<'_, PreviewState>) -> Result<(), AppError> {
    state.cancelled.store(true, Ordering::Relaxed);
    let child = state.child.lock().ok().and_then(|mut g| g.take());
    if let Some(child) = child {
        let _ = child.kill();
    }
    Ok(())
}

/// Run `ffmpeg -i <input>` (no output) and parse the stderr banner. A code-1
/// exit is EXPECTED here (no output file), so it is ignored — only the parsed
/// facts matter.
async fn run_probe(
    app: &AppHandle,
    input_path: &str,
    state: &State<'_, PreviewState>,
) -> Result<ProbeResult, AppError> {
    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Other(format!("Bundled FFmpeg sidecar unavailable: {e}")))?;
    let (mut rx, child) = sidecar
        .args(["-nostdin", "-hide_banner", "-i", input_path])
        .spawn()
        .map_err(|e: tauri_plugin_shell::Error| {
            AppError::Other(format!("FFmpeg probe failed: {e}"))
        })?;
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }

    let mut stderr = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(bytes) => stderr.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Error(e) => stderr.push_str(&e),
            _ => {}
        }
    }

    if let Ok(mut guard) = state.child.lock() {
        let _ = guard.take();
    }
    if state.cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }
    Ok(parse_probe(&stderr))
}

/// `needs_proxy` iff the input is larger than 1080p on its longer edge OR
/// carries a 90°/270° display-matrix rotation (the WKWebView failure modes).
/// Rotation is normalized so -90 ≡ 270 and -270 ≡ 90.
fn needs_proxy(width: u32, height: u32, rotation: i32) -> bool {
    let r = rotation.rem_euclid(360);
    width.max(height) > 1920 || r == 90 || r == 270
}

/// Parse the whole ffmpeg `-i` stderr banner into probe facts.
fn parse_probe(stderr: &str) -> ProbeResult {
    let has_video = stderr.lines().any(|l| l.contains("Video:"));
    let (width, height) = parse_dimensions(stderr).unwrap_or((0, 0));
    let rotation = parse_rotation(stderr);
    ProbeResult {
        width,
        height,
        rotation,
        has_video,
    }
}

/// First `WxH` resolution token on a `Video:` line, e.g. `3840x2160`.
fn parse_dimensions(stderr: &str) -> Option<(u32, u32)> {
    for line in stderr.lines() {
        if !line.contains("Video:") {
            continue;
        }
        if let Some(dims) = find_wxh(line) {
            return Some(dims);
        }
    }
    None
}

/// Scan a line for the first `<digits>x<digits>` token with both sides ≥ 16
/// (so aspect-ratio tokens like `1x1` in `[SAR 1:1 ...]` — which use `:` anyway
/// — and degenerate `0x0` don't masquerade as a resolution).
fn find_wxh(s: &str) -> Option<(u32, u32)> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == b'x' {
            let w = &s[start..i];
            let hstart = i + 1;
            let mut j = hstart;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > hstart {
                if let (Ok(wv), Ok(hv)) = (w.parse::<u32>(), s[hstart..j].parse::<u32>()) {
                    if wv >= 16 && hv >= 16 {
                        return Some((wv, hv));
                    }
                }
            }
            i = j;
        }
    }
    None
}

/// Display-matrix rotation in degrees. Prefers the modern
/// `displaymatrix: rotation of -90.00 degrees` line, falls back to the legacy
/// `rotate : 90` metadata tag. Returns 0 when neither is present.
fn parse_rotation(stderr: &str) -> i32 {
    for line in stderr.lines() {
        if let Some(idx) = line.find("rotation of") {
            let rest = &line[idx + "rotation of".len()..];
            if let Some(tok) = rest.split_whitespace().next() {
                if let Ok(v) = tok.parse::<f32>() {
                    return v.round() as i32;
                }
            }
        }
    }
    for line in stderr.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("rotate") {
            if let Some(colon) = rest.find(':') {
                if let Ok(v) = rest[colon + 1..].trim().parse::<f32>() {
                    return v.round() as i32;
                }
            }
        }
    }
    0
}

/// Duration in microseconds from the stderr `Duration: HH:MM:SS.cs,` banner.
fn parse_duration_us(text: &str) -> Option<u64> {
    for line in text.lines() {
        if let Some(idx) = line.find("Duration:") {
            let rest = &line[idx + "Duration:".len()..];
            let token = rest.split(',').next()?.trim();
            if let Some(us) = hms_to_us(token) {
                return Some(us);
            }
        }
    }
    None
}

/// Microseconds from a progress line's `time=HH:MM:SS.cs` field (`time=N/A` → None).
fn parse_time_us(line: &str) -> Option<u64> {
    let idx = line.find("time=")?;
    let token = line[idx + "time=".len()..].split_whitespace().next()?;
    hms_to_us(token)
}

/// Parse `HH:MM:SS.cs` into microseconds; None on `N/A` or malformed input.
fn hms_to_us(token: &str) -> Option<u64> {
    let mut parts = token.split(':');
    let h: u64 = parts.next()?.trim().parse().ok()?;
    let m: u64 = parts.next()?.trim().parse().ok()?;
    let sec_part = parts.next()?.trim();
    if parts.next().is_some() {
        return None;
    }
    let mut sec_split = sec_part.split('.');
    let s: u64 = sec_split.next()?.parse().ok()?;
    let frac_us: u64 = match sec_split.next() {
        Some(frac) => {
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

    // A representative ffmpeg `-i` stderr block for a rotated 4K phone clip.
    const PROBE_4K_ROT90: &str = "\
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mov':
  Metadata:
    major_brand     : qt
  Duration: 00:01:03.50, start: 0.000000, bitrate: 114000 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 3840x2160, 114000 kb/s, 29.97 fps
      Metadata:
        rotate          : 90
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s";

    #[test]
    fn probe_parses_dimensions_and_rotation() {
        let p = parse_probe(PROBE_4K_ROT90);
        assert!(p.has_video);
        assert_eq!(p.width, 3840);
        assert_eq!(p.height, 2160);
        // displaymatrix line wins: -90 degrees.
        assert_eq!(p.rotation, -90);
    }

    #[test]
    fn probe_audio_only_has_no_video() {
        let s = "\
Input #0, mp3, from 'song.mp3':
  Duration: 00:03:12.00, start: 0.000000, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s";
        let p = parse_probe(s);
        assert!(!p.has_video);
        assert_eq!((p.width, p.height), (0, 0));
    }

    #[test]
    fn does_not_mistake_aspect_ratio_for_resolution() {
        // SAR/DAR use colons; the only `WxH` token is the real resolution.
        let line = "  Stream #0:0: Video: h264, yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 30 fps";
        assert_eq!(find_wxh(line), Some((1920, 1080)));
    }

    #[test]
    fn needs_proxy_for_4k() {
        assert!(needs_proxy(3840, 2160, 0));
    }

    #[test]
    fn no_proxy_for_plain_1080p() {
        assert!(!needs_proxy(1920, 1080, 0));
    }

    #[test]
    fn needs_proxy_for_rotated_1080p() {
        assert!(needs_proxy(1920, 1080, 90));
        // Negative/co-terminal rotations normalize the same way.
        assert!(needs_proxy(1080, 1920, -90));
        assert!(needs_proxy(1080, 1920, 270));
    }

    #[test]
    fn parse_time_and_duration_roundtrip() {
        assert_eq!(parse_duration_us("  Duration: 00:01:03.50, start: 0.0"), Some(63_500_000));
        assert_eq!(
            parse_time_us("frame=  100 fps= 30 q=28.0 time=00:00:02.00 bitrate=1000kb/s"),
            Some(2_000_000)
        );
        assert_eq!(parse_time_us("frame=1 time=N/A bitrate=N/A"), None);
    }
}

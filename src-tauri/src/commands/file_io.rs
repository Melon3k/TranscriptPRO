use crate::logger;
use crate::subtitle::{
    ass::{resolve_font_metrics, write_ass_with_metrics},
    srt::{parse_srt, write_srt, write_word_srt, write_txt},
    style::{CaptionAnimation, CaptionStyle},
    types::{AppError, Subtitle},
    vtt::write_vtt,
};
use tauri::{AppHandle, Manager};

/// Write a file atomically: write to a sibling `.tmp` then rename into place, so an
/// interrupted or failed write never leaves the user with a truncated/corrupt file.
fn write_atomic(path: impl AsRef<std::path::Path>, content: &str) -> Result<(), AppError> {
    let path = path.as_ref();
    // Unique temp suffix so two concurrent writes to the same target (e.g. rapid version
    // saves under one project key) don't clobber each other's temp file.
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let tmp = std::path::PathBuf::from(tmp);
    std::fs::write(&tmp, content).map_err(|e| AppError::FileError(e.to_string()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp); // best-effort cleanup
        AppError::FileError(e.to_string())
    })
}

/// Decode subtitle bytes to text. Prefers UTF-8 (stripping a BOM if present) and falls
/// back to Windows-1250 — the common legacy encoding for Polish SRTs — when the bytes
/// aren't valid UTF-8, instead of failing the whole import.
fn decode_text(bytes: &[u8]) -> String {
    let without_bom = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };
    match std::str::from_utf8(without_bom) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::WINDOWS_1250.decode(without_bom).0.into_owned(),
    }
}

/// Reject project keys that could escape the history directory via path traversal.
/// The frontend sends a SHA-256 hex key (or a legacy base64url key); both are covered.
fn validate_project_key(key: &str) -> Result<(), AppError> {
    if !key.is_empty()
        && key.len() <= 128
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Ok(())
    } else {
        Err(AppError::Other(format!("Invalid project key: {}", key)))
    }
}

#[tauri::command]
pub async fn import_srt(app: AppHandle, path: String) -> Result<Vec<Subtitle>, AppError> {
    let bytes = std::fs::read(&path).map_err(|e| AppError::FileError(e.to_string()))?;
    let content = decode_text(&bytes);
    let subs = parse_srt(&content)?;
    logger::info(
        &app,
        "file",
        format!("Imported {} segments from {}", subs.len(), path),
    );
    Ok(subs)
}

#[tauri::command]
pub async fn export_srt(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    let content = write_srt(&subtitles);
    write_atomic(&path, &content)?;
    logger::info(
        &app,
        "file",
        format!("Exported {} segments as SRT → {}", subtitles.len(), path),
    );
    Ok(())
}

#[tauri::command]
pub async fn export_word_srt(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    let content = write_word_srt(&subtitles);
    write_atomic(&path, &content)?;
    logger::info(
        &app,
        "file",
        format!("Exported word-level SRT ({} segments) → {}", subtitles.len(), path),
    );
    Ok(())
}

#[tauri::command]
pub async fn export_txt(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    let content = write_txt(&subtitles);
    write_atomic(&path, &content)?;
    logger::info(
        &app,
        "file",
        format!("Exported TXT ({} segments) → {}", subtitles.len(), path),
    );
    Ok(())
}

#[tauri::command]
pub async fn export_vtt(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    let content = write_vtt(&subtitles);
    write_atomic(&path, &content)?;
    logger::info(
        &app,
        "file",
        format!("Exported {} segments as VTT → {}", subtitles.len(), path),
    );
    Ok(())
}

#[tauri::command]
pub async fn export_ass(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
    style: CaptionStyle,
    animation: CaptionAnimation,
) -> Result<(), AppError> {
    // Serialize with the SAME resolved font metrics the MP4 burn-in uses (H6):
    // with style.background on, line wrapping depends on measured glyph advances,
    // so a Rough estimate here would break lines at different points than the
    // burned video (wide/CJK glyphs then overflow the frame). Font resolution is
    // a blocking fontdb scan → run it off the async runtime (REL-12).
    let seg_count = subtitles.len();
    let content = {
        let app_bg = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let bundled_fonts_dir = app_bg.path().resource_dir().ok().map(|d| d.join("fonts"));
            let metrics = resolve_font_metrics(&style, bundled_fonts_dir.as_deref());
            write_ass_with_metrics(&subtitles, &style, &animation, metrics.as_ref())
        })
        .await
        .map_err(|e| AppError::Other(format!("ASS serialization task failed: {e}")))?
    };
    write_atomic(&path, &content)?;
    logger::info(
        &app,
        "file",
        format!("Exported {} segments as ASS → {}", seg_count, path),
    );
    Ok(())
}

/// Read-only export preview: serialize subtitles to the requested lossless text format
/// using the SAME pure serializers as the real export commands, so the in-app preview
/// can never drift from the written file. Does not touch the filesystem.
#[tauri::command]
pub async fn preview_export(
    subtitles: Vec<Subtitle>,
    format: String,
) -> Result<String, AppError> {
    let content = match format.as_str() {
        "srt" => write_srt(&subtitles),
        "vtt" => write_vtt(&subtitles),
        other => return Err(AppError::Other(format!("Unknown preview format: {}", other))),
    };
    Ok(content)
}

#[tauri::command]
pub async fn save_version_history(
    app: AppHandle,
    project_key: String,
    versions_json: String,
) -> Result<(), AppError> {
    validate_project_key(&project_key)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("history");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::FileError(e.to_string()))?;
    write_atomic(dir.join(format!("{}.json", project_key)), &versions_json)
}

#[tauri::command]
pub async fn load_version_history(
    app: AppHandle,
    project_key: String,
) -> Result<Option<String>, AppError> {
    validate_project_key(&project_key)?;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("history")
        .join(format!("{}.json", project_key));
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::FileError(e.to_string()))?;
    Ok(Some(content))
}

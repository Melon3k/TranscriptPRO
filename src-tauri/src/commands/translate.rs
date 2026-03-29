use crate::subtitle::types::{AppError, Subtitle};

/// Translate subtitle texts using DeepL or Google Translate.
/// Preserves timestamps, clears word-level data (invalid after translation).
/// NOTE: API integration will be added in Phase 6.
#[tauri::command]
pub async fn translate_subtitles(
    subtitles: Vec<Subtitle>,
    _target_lang: String,
    _provider: String,
    _api_key: String,
    _source_lang: Option<String>,
) -> Result<Vec<Subtitle>, AppError> {
    // Phase 6 placeholder
    let _ = subtitles;
    Err(AppError::Other(
        "Translation not yet implemented (Phase 6)".into(),
    ))
}

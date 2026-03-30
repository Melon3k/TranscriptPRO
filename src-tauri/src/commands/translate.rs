use crate::subtitle::types::{AppError, Subtitle};
use crate::translation;

/// Translate subtitle texts using Gemini or Claude AI.
/// Preserves timestamps, clears word-level data (invalid after translation).
#[tauri::command]
pub async fn translate_subtitles(
    subtitles: Vec<Subtitle>,
    target_lang: String,
    provider: String,
    api_key: String,
    source_lang: Option<String>,
    model: Option<String>,
) -> Result<Vec<Subtitle>, AppError> {
    if subtitles.is_empty() {
        return Ok(Vec::new());
    }

    if api_key.trim().is_empty() {
        return Err(AppError::TranslationApiError(
            "API key is required for translation".into(),
        ));
    }

    let texts: Vec<String> = subtitles.iter().map(|s| s.text.clone()).collect();
    let src = source_lang.as_deref();

    let gemini_model = model.as_deref().unwrap_or("");

    let translated_texts = match provider.as_str() {
        "gemini" => {
            translation::gemini::translate(&texts, &target_lang, src, &api_key, gemini_model).await?
        }
        "claude" => {
            translation::claude::translate(&texts, &target_lang, src, &api_key).await?
        }
        other => {
            return Err(AppError::TranslationApiError(format!(
                "Unknown translation provider: '{}'. Supported: gemini, claude",
                other
            )));
        }
    };

    if translated_texts.len() != subtitles.len() {
        return Err(AppError::TranslationApiError(format!(
            "Translation count mismatch: expected {}, got {}",
            subtitles.len(),
            translated_texts.len()
        )));
    }

    let result: Vec<Subtitle> = subtitles
        .into_iter()
        .zip(translated_texts)
        .map(|(sub, new_text)| Subtitle {
            text: new_text,
            words: Vec::new(), // word timestamps invalid after translation
            ..sub
        })
        .collect();

    Ok(result)
}

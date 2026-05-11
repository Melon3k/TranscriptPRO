use crate::logger;
use crate::subtitle::types::{AppError, Subtitle};
use crate::translation;
use tauri::AppHandle;

/// Translate subtitle texts using Gemini or Claude AI.
/// Preserves timestamps, clears word-level data (invalid after translation).
#[tauri::command]
pub async fn translate_subtitles(
    app: AppHandle,
    subtitles: Vec<Subtitle>,
    target_lang: String,
    provider: String,
    api_key: String,
    source_lang: Option<String>,
    model: Option<String>,
    server_url: Option<String>,
) -> Result<Vec<Subtitle>, AppError> {
    if subtitles.is_empty() {
        return Ok(Vec::new());
    }

    // LibreTranslate does not require an API key
    if api_key.trim().is_empty() && provider != "libretranslate" {
        return Err(AppError::TranslationApiError(
            "API key is required for translation".into(),
        ));
    }

    let texts: Vec<String> = subtitles.iter().map(|s| s.text.clone()).collect();
    let src = source_lang.as_deref();

    let gemini_model = model.as_deref().unwrap_or("");
    let libre_url = server_url.as_deref().unwrap_or("https://libretranslate.com");

    logger::info(
        &app,
        "translate",
        format!(
            "Translating {} segments via {} ({} → {})",
            texts.len(),
            provider,
            source_lang.as_deref().unwrap_or("auto"),
            target_lang,
        ),
    );
    let started = std::time::Instant::now();

    let translated_texts = match provider.as_str() {
        "gemini" => {
            translation::gemini::translate(&texts, &target_lang, src, &api_key, gemini_model).await?
        }
        "claude" => {
            translation::claude::translate(&texts, &target_lang, src, &api_key).await?
        }
        "libretranslate" => {
            translation::libretranslate::translate(&texts, &target_lang, src, &api_key, libre_url).await?
        }
        other => {
            return Err(AppError::TranslationApiError(format!(
                "Unknown translation provider: '{}'. Supported: gemini, claude, libretranslate",
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

    logger::info(
        &app,
        "translate",
        format!(
            "Translation completed — {} segments in {:.2}s",
            result.len(),
            started.elapsed().as_secs_f32()
        ),
    );

    Ok(result)
}

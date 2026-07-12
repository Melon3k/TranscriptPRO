use crate::logger;
use crate::subtitle::types::{AppError, Subtitle, TranslationProgress};
use crate::translation;
use crate::TranslationCancel;
use std::sync::atomic::Ordering;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

/// Request cancellation of an in-progress translation. Providers check the flag between
/// chunks and return whatever they've translated so far (partial results).
#[tauri::command]
pub async fn cancel_translation(
    app: AppHandle,
    cancel: State<'_, TranslationCancel>,
) -> Result<(), AppError> {
    cancel.0.store(true, Ordering::Relaxed);
    logger::info(&app, "translate", "Translation cancellation requested");
    Ok(())
}

/// Translate subtitle texts using Gemini / Claude / LibreTranslate.
/// Preserves timestamps and clears word-level data (invalid after translation).
/// Streams progress via Channel and supports cancellation with partial results.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn translate_subtitles(
    app: AppHandle,
    cancel: State<'_, TranslationCancel>,
    subtitles: Vec<Subtitle>,
    target_lang: String,
    provider: String,
    api_key: String,
    source_lang: Option<String>,
    model: Option<String>,
    server_url: Option<String>,
    on_progress: Channel<TranslationProgress>,
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

    // Reset the cancellation flag at the start of each run.
    cancel.0.store(false, Ordering::Relaxed);
    let cancel_flag = cancel.0.clone();

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
            translation::gemini::translate(
                &texts,
                &target_lang,
                src,
                &api_key,
                gemini_model,
                &cancel_flag,
                &on_progress,
            )
            .await?
        }
        "claude" => {
            translation::claude::translate(
                &texts,
                &target_lang,
                src,
                &api_key,
                &cancel_flag,
                &on_progress,
            )
            .await?
        }
        "libretranslate" => {
            translation::libretranslate::translate(
                &texts,
                &target_lang,
                src,
                &api_key,
                libre_url,
                &cancel_flag,
                &on_progress,
            )
            .await?
        }
        other => {
            return Err(AppError::TranslationApiError(format!(
                "Unknown translation provider: '{}'. Supported: gemini, claude, libretranslate",
                other
            )));
        }
    };

    // Apply the (possibly partial, if cancelled) translations. Segments beyond what was
    // translated keep their original text, so cancelling doesn't throw away progress.
    let translated_count = translated_texts.len();
    let result: Vec<Subtitle> = subtitles
        .into_iter()
        .enumerate()
        .map(|(i, sub)| match translated_texts.get(i) {
            Some(new_text) => Subtitle {
                text: new_text.clone(),
                words: Vec::new(), // word timestamps invalid after translation
                ..sub
            },
            None => sub,
        })
        .collect();

    logger::info(
        &app,
        "translate",
        format!(
            "Translation completed — {}/{} segments in {:.2}s",
            translated_count,
            result.len(),
            started.elapsed().as_secs_f32()
        ),
    );

    Ok(result)
}

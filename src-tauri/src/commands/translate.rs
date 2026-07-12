use crate::logger;
use crate::subtitle::types::{AppError, Subtitle, TranslationProgress};
use crate::translation;
use crate::{LocalLlm, TranslationCancel};
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

/// Translate subtitle texts using Gemini / Claude (cloud) or the local
/// TranslateGemma model.
/// Preserves timestamps and clears word-level data (invalid after translation).
/// Streams progress via Channel and supports cancellation with partial results.
/// Cloud providers read their API key from the OS credential store — it never
/// crosses IPC from the webview; the local provider needs no key.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn translate_subtitles(
    app: AppHandle,
    cancel: State<'_, TranslationCancel>,
    llm: State<'_, LocalLlm>,
    subtitles: Vec<Subtitle>,
    target_lang: String,
    provider: String,
    source_lang: Option<String>,
    model: Option<String>,
    on_progress: Channel<TranslationProgress>,
) -> Result<Vec<Subtitle>, AppError> {
    if subtitles.is_empty() {
        return Ok(Vec::new());
    }

    let api_key = match provider.as_str() {
        "gemini" | "claude" => {
            let key = crate::commands::keys::get_api_key(&app, &provider)?.unwrap_or_default();
            if key.trim().is_empty() {
                return Err(AppError::TranslationApiError(
                    "API key is required for translation".into(),
                ));
            }
            key
        }
        _ => String::new(),
    };

    // Reset the cancellation flag at the start of each run.
    cancel.0.store(false, Ordering::Relaxed);
    let cancel_flag = cancel.0.clone();

    let texts: Vec<String> = subtitles.iter().map(|s| s.text.clone()).collect();
    let src = source_lang.as_deref();

    let gemini_model = model.as_deref().unwrap_or("");

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
        "local" => {
            translation::local::translate(
                &app,
                llm.inner(),
                &texts,
                &target_lang,
                src,
                &cancel_flag,
                &on_progress,
            )
            .await?
        }
        other => {
            return Err(AppError::TranslationApiError(format!(
                "Unknown translation provider: '{}'. Supported: gemini, claude, local",
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

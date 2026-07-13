use crate::logger;
use crate::subtitle::types::{AppError, Subtitle, TranslationProgress};
use crate::translation;
use crate::{LocalLlm, TranslationCancel};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

/// Outcome of a translate call. `warning` is set when the run stopped early on an
/// error (not a cancel) — `subtitles` then holds the partial translation and
/// `translated_count` how many cues were done, so the UI can apply the partial
/// and warn instead of discarding everything.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub subtitles: Vec<Subtitle>,
    pub translated_count: u32,
    pub warning: Option<String>,
}

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
) -> Result<TranslationResult, AppError> {
    if subtitles.is_empty() {
        return Ok(TranslationResult {
            subtitles: Vec::new(),
            translated_count: 0,
            warning: None,
        });
    }

    use crate::commands::keys::KeyLookup;
    let api_key = match provider.as_str() {
        "gemini" | "claude" => {
            // Key lookup touches the filesystem and (once per run) the OS keychain,
            // which can block — keep it off the async runtime thread.
            let (app_c, provider_c) = (app.clone(), provider.clone());
            let lookup = tauri::async_runtime::spawn_blocking(move || {
                crate::commands::keys::get_api_key(&app_c, &provider_c)
            })
            .await
            .map_err(|e| AppError::Other(format!("Key lookup task failed: {}", e)))??;
            match lookup {
            KeyLookup::Present(k) if !k.trim().is_empty() => k,
            KeyLookup::Present(_) | KeyLookup::Missing => {
                return Err(AppError::TranslationApiError(
                    "API key is required for translation".into(),
                ));
            }
            KeyLookup::Unreadable => {
                // Do NOT delete the entry: the master key may be only *temporarily*
                // unavailable (keychain locked, roaming credential not yet synced),
                // in which case the ciphertext is still recoverable. Surface a
                // dedicated, localized error instead; the user can remove + re-enter
                // the key in Settings (which overwrites the entry) if it's truly lost.
                return Err(AppError::ApiKeyUnreadable(provider.clone()));
            }
            }
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

    let outcome = match provider.as_str() {
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

    // Apply the (possibly partial) translations. Segments beyond what was translated
    // keep their original text, so neither a cancel nor a mid-run error throws away
    // progress. A mid-run error surfaces as `warning` (not a hard Err) so the UI can
    // keep the partial result.
    let translated_texts = outcome.texts;
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
            "Translation {} — {}/{} segments in {:.2}s",
            if outcome.error.is_some() { "stopped with error" } else { "completed" },
            translated_count,
            result.len(),
            started.elapsed().as_secs_f32()
        ),
    );

    Ok(TranslationResult {
        subtitles: result,
        translated_count: translated_count as u32,
        warning: outcome.error,
    })
}

use crate::subtitle::types::{AppError, TranslationProgress};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;

#[derive(Debug, Serialize)]
struct LibreRequest<'a> {
    q: &'a [String],
    source: &'a str,
    target: &'a str,
    format: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    api_key: &'a str,
}

/// LibreTranslate returns `translatedText` as an array for an array `q`, but some older
/// or proxied servers return a single string. Accept both so a non-array server can be
/// handled (via per-line fallback) instead of failing with a raw serde parse error.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TranslatedText {
    Many(Vec<String>),
    One(String),
}

#[derive(Debug, Deserialize)]
struct LibreResponse {
    #[serde(rename = "translatedText")]
    translated_text: TranslatedText,
}

/// Map our uppercase language codes (e.g. "EN") to LibreTranslate lowercase codes (e.g. "en").
fn map_lang(code: &str) -> String {
    match code.to_uppercase().as_str() {
        "EN" => "en",
        "PL" => "pl",
        "DE" => "de",
        "FR" => "fr",
        "ES" => "es",
        "IT" => "it",
        "PT" => "pt",
        "NL" => "nl",
        "JA" => "ja",
        "KO" => "ko",
        "ZH" => "zh",
        "RU" => "ru",
        "UK" => "uk",
        "AR" => "ar",
        "TR" => "tr",
        "CS" => "cs",
        "SV" => "sv",
        "FI" => "fi",
        "HU" => "hu",
        _ => code,
    }
    .to_string()
}

/// Translate a batch of texts using LibreTranslate (free, no API key required on public server).
/// Sends texts in array batches (the `/translate` endpoint accepts and returns arrays)
/// so a long file is a few dozen requests rather than one request per line.
#[allow(clippy::too_many_arguments)]
pub async fn translate(
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
    server_url: &str,
    cancel: &AtomicBool,
    on_progress: &Channel<TranslationProgress>,
) -> Result<Vec<String>, AppError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let server = server_url.trim_end_matches('/');
    let endpoint = format!("{}/translate", server);
    let target = map_lang(target_lang);
    let source = source_lang
        .map(map_lang)
        .unwrap_or_else(|| "auto".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("HTTP client error: {}", e))
        })?;

    let mut all_translated = Vec::with_capacity(texts.len());

    // The /translate endpoint accepts `q` as an array and returns `translatedText` as an
    // array, so batch the texts. A short delay between batches stays gentle on the
    // rate-limited public server.
    const BATCH_SIZE: usize = 25;
    for (i, chunk) in texts.chunks(BATCH_SIZE).enumerate() {
        // Cancelled — return partial results instead of discarding everything.
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        let body = LibreRequest {
            q: chunk,
            source: &source,
            target: &target,
            format: "text",
            api_key,
        };

        let response = client
            .post(&endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e: reqwest::Error| {
                AppError::TranslationApiError(format!(
                    "LibreTranslate request failed: {}. Is the server at '{}' running?",
                    e, server
                ))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();

            // Provide a helpful message for common errors
            let hint = if status == 403 {
                " (API key required — get one at https://libretranslate.com)"
            } else if status == 429 {
                " (rate limited — try again in a moment or use a self-hosted instance)"
            } else {
                ""
            };

            return Err(AppError::TranslationApiError(format!(
                "LibreTranslate error {}{}: {}",
                status, hint, body_text
            )));
        }

        let result: LibreResponse = response.json().await.map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("LibreTranslate parse error: {}", e))
        })?;

        match result.translated_text {
            TranslatedText::Many(v) if v.len() == chunk.len() => all_translated.extend(v),
            TranslatedText::One(s) if chunk.len() == 1 => all_translated.push(s),
            // Server didn't honor the array `q` (single string for a multi-item batch, or
            // a count mismatch) — fall back to one request per text for this chunk so the
            // feature still works on servers without batch support.
            _ => {
                for text in chunk {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    all_translated.push(
                        translate_one(&client, &endpoint, text, &source, &target, api_key, server)
                            .await?,
                    );
                }
            }
        }
        let _ = on_progress.send(TranslationProgress {
            done: all_translated.len() as u32,
            total: texts.len() as u32,
        });
    }

    Ok(all_translated)
}

/// Translate a single text (per-line fallback for servers that don't support array `q`).
async fn translate_one(
    client: &reqwest::Client,
    endpoint: &str,
    text: &str,
    source: &str,
    target: &str,
    api_key: &str,
    server: &str,
) -> Result<String, AppError> {
    #[derive(Serialize)]
    struct OneRequest<'a> {
        q: &'a str,
        source: &'a str,
        target: &'a str,
        format: &'a str,
        #[serde(skip_serializing_if = "str::is_empty")]
        api_key: &'a str,
    }
    #[derive(Deserialize)]
    struct OneResponse {
        #[serde(rename = "translatedText")]
        translated_text: String,
    }

    let response = client
        .post(endpoint)
        .json(&OneRequest {
            q: text,
            source,
            target,
            format: "text",
            api_key,
        })
        .send()
        .await
        .map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!(
                "LibreTranslate request failed: {}. Is the server at '{}' running?",
                e, server
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(AppError::TranslationApiError(format!(
            "LibreTranslate error {}: {}",
            status, body_text
        )));
    }

    let result: OneResponse = response.json().await.map_err(|e: reqwest::Error| {
        AppError::TranslationApiError(format!("LibreTranslate parse error: {}", e))
    })?;
    Ok(result.translated_text)
}

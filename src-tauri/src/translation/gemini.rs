use crate::subtitle::types::{AppError, TranslationProgress};
use crate::translation::TranslateOutcome;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::ipc::Channel;

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: String,
}

// Used only for parsing 429 retry delay
#[derive(Debug, Deserialize)]
struct GeminiErrorBody {
    error: GeminiErrorInfo,
}

#[derive(Debug, Deserialize)]
struct GeminiErrorInfo {
    details: Option<Vec<GeminiErrorDetail>>,
}

#[derive(Debug, Deserialize)]
struct GeminiErrorDetail {
    #[serde(rename = "retryDelay")]
    retry_delay: Option<String>,
}

const DEFAULT_MODEL: &str = "gemini-3.1-flash-lite";
const MAX_RETRIES: usize = 3;

/// Parse a retryDelay string like "41s" or "41.838117925s" into a Duration.
fn parse_retry_delay(s: &str) -> Option<Duration> {
    let secs: f64 = s.trim_end_matches('s').parse().ok()?;
    Some(Duration::from_secs_f64(secs + 1.0)) // +1s buffer
}

/// Translate a batch of texts using the Gemini API (Google AI).
/// Automatically retries on 429 using the retryDelay from the response.
/// A mid-run failure keeps the chunks already translated (see `TranslateOutcome`).
#[allow(clippy::too_many_arguments)]
pub async fn translate(
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
    model: &str,
    cancel: &AtomicBool,
    on_progress: &Channel<TranslationProgress>,
) -> Result<TranslateOutcome, AppError> {
    if texts.is_empty() {
        return Ok(TranslateOutcome::complete(Vec::new()));
    }

    let model = if model.is_empty() { DEFAULT_MODEL } else { model };
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("HTTP client error: {}", e))
        })?;
    let mut all_translated = Vec::with_capacity(texts.len());
    let mut run_error: Option<String> = None;

    for chunk in texts.chunks(50) {
        // Cancelled — return what's translated so far (partial) instead of discarding it.
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        match translate_chunk(&client, chunk, target_lang, source_lang, api_key, model, cancel)
            .await
        {
            Ok(translated) => {
                all_translated.extend(translated);
                let _ = on_progress.send(TranslationProgress {
                    done: all_translated.len() as u32,
                    total: texts.len() as u32,
                });
            }
            // A cancel during backoff surfaces as Cancelled — stop quietly, no error.
            Err(AppError::Cancelled) => break,
            Err(e) => {
                run_error = Some(e.detail().to_string());
                break;
            }
        }
    }

    Ok(TranslateOutcome {
        texts: all_translated,
        error: run_error,
    })
}

/// Translate one chunk (≤50 cues). Errors are returned so the caller can keep
/// partial results; `AppError::Cancelled` signals a user cancel during backoff.
async fn translate_chunk(
    client: &reqwest::Client,
    chunk: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
    model: &str,
    cancel: &AtomicBool,
) -> Result<Vec<String>, AppError> {
    let source_info = match source_lang {
        Some(lang) => format!(" from {} ", lang),
        None => " ".to_string(),
    };

    let texts_json = serde_json::to_string(chunk)
        .map_err(|e| AppError::TranslationApiError(format!("JSON serialize error: {}", e)))?;

    let prompt = format!(
        "Translate the following subtitle texts{}to {}. \
         Return ONLY a JSON array of translated strings in the same order. \
         Do not add any explanations, markdown formatting, or code blocks. \
         Just the raw JSON array.\n\n{}",
        source_info, target_lang, texts_json
    );

    let body = serde_json::json!({
        "contents": [{ "parts": [{"text": prompt}] }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    });

    // The API key goes in the x-goog-api-key header, NOT the URL query string:
    // a transport error (offline/DNS/TLS) makes reqwest attach the full URL to
    // its Display, which would leak `?key=<secret>` into the error toast and log
    // panel. `without_url()` below strips the URL from those errors as well.
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );

    let mut attempt = 0;
    let response_text = loop {
        attempt += 1;

        let response = client
            .post(&url)
            .header("x-goog-api-key", api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e: reqwest::Error| {
                AppError::TranslationApiError(format!("Gemini request failed: {}", e.without_url()))
            })?;

        let status = response.status();

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let body_text = response.text().await.unwrap_or_default();

            if attempt >= MAX_RETRIES {
                return Err(AppError::TranslationApiError(format!(
                    "Gemini rate limit exceeded after {} attempts. \
                     Check your billing at https://ai.google.dev/gemini-api/docs/rate-limits\n{}",
                    MAX_RETRIES,
                    crate::translation::redact_secrets(crate::translation::truncate_chars(
                        &body_text, 200
                    ))
                )));
            }

            let delay = serde_json::from_str::<GeminiErrorBody>(&body_text)
                .ok()
                .and_then(|b| b.error.details)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|d| d.retry_delay)
                .filter_map(|s| parse_retry_delay(&s))
                .next()
                .unwrap_or(Duration::from_secs(60));

            // Don't sit through a (possibly 60s) backoff if the user cancelled.
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }
            tokio::time::sleep(delay).await;
            continue;
        }

        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            return Err(AppError::TranslationApiError(format!(
                "Gemini API error {}: {}",
                status,
                crate::translation::redact_secrets(crate::translation::truncate_chars(
                    &body_text, 200
                ))
            )));
        }

        break response.text().await.map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("Gemini read error: {}", e))
        })?;
    };

    let result: GeminiResponse = serde_json::from_str(&response_text)
        .map_err(|e| AppError::TranslationApiError(format!("Gemini parse error: {}", e)))?;

    let text = result
        .candidates
        .first()
        .and_then(|c| c.content.parts.first())
        .map(|p| p.text.clone())
        .ok_or_else(|| AppError::TranslationApiError("Gemini returned empty response".into()))?;

    // Strip a leading ```json or ``` fence and a trailing ``` fence, if present.
    let cleaned = {
        let t = text.trim();
        let t = t
            .strip_prefix("```json")
            .or_else(|| t.strip_prefix("```"))
            .unwrap_or(t);
        t.strip_suffix("```").unwrap_or(t).trim()
    };

    let translated: Vec<String> = serde_json::from_str(cleaned).map_err(|e| {
        AppError::TranslationApiError(format!(
            "Failed to parse Gemini result: {}. Raw: {}",
            e,
            crate::translation::truncate_chars(&text, 200)
        ))
    })?;

    if translated.len() != chunk.len() {
        return Err(AppError::TranslationApiError(format!(
            "Gemini returned {} translations, expected {}",
            translated.len(),
            chunk.len()
        )));
    }

    Ok(translated)
}

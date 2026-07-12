use crate::subtitle::types::{AppError, TranslationProgress};
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::ipc::Channel;

#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContentBlock {
    text: Option<String>,
}

/// Translate a batch of texts using the Anthropic Claude API.
/// Uses claude-sonnet-4-20250514 with a structured prompt to return JSON array.
pub async fn translate(
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
    cancel: &AtomicBool,
    on_progress: &Channel<TranslationProgress>,
) -> Result<Vec<String>, AppError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("HTTP client error: {}", e))
        })?;
    let mut all_translated = Vec::with_capacity(texts.len());

    // Batch in chunks of 50 to stay within context limits
    for chunk in texts.chunks(50) {
        // Cancelled — return partial results instead of discarding everything.
        if cancel.load(Ordering::Relaxed) {
            break;
        }
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
            "model": "claude-sonnet-5",
            "max_tokens": 8192,
            // Translation needs no reasoning. Sonnet 5 enables adaptive thinking by
            // default when `thinking` is omitted, which would burn tokens and risk
            // truncating the JSON array within max_tokens — disable it explicitly.
            "thinking": {"type": "disabled"},
            "messages": [{
                "role": "user",
                "content": prompt
            }]
        });

        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e: reqwest::Error| {
                AppError::TranslationApiError(format!("Claude request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::TranslationApiError(format!(
                "Claude API error {}: {}",
                status, body
            )));
        }

        let result: ClaudeResponse = response.json().await.map_err(|e: reqwest::Error| {
            AppError::TranslationApiError(format!("Claude parse error: {}", e))
        })?;

        let text = result
            .content
            .first()
            .and_then(|c| c.text.clone())
            .ok_or_else(|| {
                AppError::TranslationApiError("Claude returned empty response".into())
            })?;

        // Strip a leading ```json or ``` fence and a trailing ``` fence, if present.
        // (The old chained `.unwrap_or(text.trim())` reset to the full original whenever
        // a strip didn't match, leaving the fence in place — serde then failed at col 1.)
        let cleaned = {
            let t = text.trim();
            let t = t
                .strip_prefix("```json")
                .or_else(|| t.strip_prefix("```"))
                .unwrap_or(t);
            t.strip_suffix("```").unwrap_or(t).trim()
        };

        let translated: Vec<String> =
            serde_json::from_str(cleaned).map_err(|e| {
                AppError::TranslationApiError(format!(
                    "Failed to parse Claude translation result: {}. Raw: {}",
                    e,
                    crate::translation::truncate_chars(&text, 200)
                ))
            })?;

        if translated.len() != chunk.len() {
            return Err(AppError::TranslationApiError(format!(
                "Claude returned {} translations, expected {}",
                translated.len(),
                chunk.len()
            )));
        }

        all_translated.extend(translated);
        let _ = on_progress.send(TranslationProgress {
            done: all_translated.len() as u32,
            total: texts.len() as u32,
        });
    }

    Ok(all_translated)
}

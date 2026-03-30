use crate::subtitle::types::AppError;
use serde::Deserialize;
use std::time::Duration;

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

const DEFAULT_MODEL: &str = "gemini-2.0-flash-lite";
const MAX_RETRIES: usize = 3;

/// Parse a retryDelay string like "41s" or "41.838117925s" into a Duration.
fn parse_retry_delay(s: &str) -> Option<Duration> {
    let secs: f64 = s.trim_end_matches('s').parse().ok()?;
    Some(Duration::from_secs_f64(secs + 1.0)) // +1s buffer
}

/// Translate a batch of texts using the Gemini API (Google AI).
/// Automatically retries on 429 using the retryDelay from the response.
pub async fn translate(
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
    model: &str,
) -> Result<Vec<String>, AppError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let model = if model.is_empty() { DEFAULT_MODEL } else { model };
    let client = reqwest::Client::new();
    let mut all_translated = Vec::with_capacity(texts.len());

    for chunk in texts.chunks(50) {
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

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, api_key
        );

        // Retry loop
        let mut attempt = 0;
        let response_text = loop {
            attempt += 1;

            let response = client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e: reqwest::Error| {
                    AppError::TranslationApiError(format!("Gemini request failed: {}", e))
                })?;

            let status = response.status();

            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                let body_text = response.text().await.unwrap_or_default();

                if attempt >= MAX_RETRIES {
                    return Err(AppError::TranslationApiError(format!(
                        "Gemini rate limit exceeded after {} attempts. \
                         Check your billing at https://ai.google.dev/gemini-api/docs/rate-limits\n{}",
                        MAX_RETRIES, body_text
                    )));
                }

                // Parse retryDelay from the error response
                let delay = serde_json::from_str::<GeminiErrorBody>(&body_text)
                    .ok()
                    .and_then(|b| b.error.details)
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|d| d.retry_delay)
                    .filter_map(|s| parse_retry_delay(&s))
                    .next()
                    .unwrap_or(Duration::from_secs(60));

                tokio::time::sleep(delay).await;
                continue;
            }

            if !status.is_success() {
                let body_text = response.text().await.unwrap_or_default();
                return Err(AppError::TranslationApiError(format!(
                    "Gemini API error {}: {}",
                    status, body_text
                )));
            }

            break response.text().await.map_err(|e: reqwest::Error| {
                AppError::TranslationApiError(format!("Gemini read error: {}", e))
            })?;
        };

        let result: GeminiResponse =
            serde_json::from_str(&response_text).map_err(|e| {
                AppError::TranslationApiError(format!("Gemini parse error: {}", e))
            })?;

        let text = result
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.clone())
            .ok_or_else(|| {
                AppError::TranslationApiError("Gemini returned empty response".into())
            })?;

        // Strip markdown code fences if present
        let cleaned = text
            .trim()
            .strip_prefix("```json")
            .unwrap_or(text.trim())
            .strip_prefix("```")
            .unwrap_or(text.trim())
            .strip_suffix("```")
            .unwrap_or(text.trim())
            .trim();

        let translated: Vec<String> = serde_json::from_str(cleaned).map_err(|e| {
            AppError::TranslationApiError(format!(
                "Failed to parse Gemini result: {}. Raw: {}",
                e,
                &text[..text.len().min(200)]
            ))
        })?;

        if translated.len() != chunk.len() {
            return Err(AppError::TranslationApiError(format!(
                "Gemini returned {} translations, expected {}",
                translated.len(),
                chunk.len()
            )));
        }

        all_translated.extend(translated);
    }

    Ok(all_translated)
}

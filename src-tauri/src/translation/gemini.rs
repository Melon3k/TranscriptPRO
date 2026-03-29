use crate::subtitle::types::AppError;
use serde::Deserialize;

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

/// Translate a batch of texts using the Gemini API (Google AI).
/// Uses gemini-2.0-flash model with a structured prompt to return JSON array.
pub async fn translate(
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
) -> Result<Vec<String>, AppError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::new();
    let mut all_translated = Vec::with_capacity(texts.len());

    // Batch in chunks of 50 to stay within context limits
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
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json"
            }
        });

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}",
            api_key
        );

        let response = client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e: reqwest::Error| {
                AppError::TranslationApiError(format!("Gemini request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::TranslationApiError(format!(
                "Gemini API error {}: {}",
                status, body
            )));
        }

        let result: GeminiResponse = response.json().await.map_err(|e: reqwest::Error| {
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

        // Clean up response — strip markdown code fences if present
        let cleaned = text
            .trim()
            .strip_prefix("```json")
            .unwrap_or(text.trim())
            .strip_prefix("```")
            .unwrap_or(text.trim())
            .strip_suffix("```")
            .unwrap_or(text.trim())
            .trim();

        let translated: Vec<String> =
            serde_json::from_str(cleaned).map_err(|e| {
                AppError::TranslationApiError(format!(
                    "Failed to parse Gemini translation result: {}. Raw: {}",
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

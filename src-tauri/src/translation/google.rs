use crate::subtitle::types::AppError;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct GoogleResponse {
    data: GoogleData,
}

#[derive(Debug, Deserialize)]
struct GoogleData {
    translations: Vec<GoogleTranslation>,
}

#[derive(Debug, Deserialize)]
struct GoogleTranslation {
    #[serde(rename = "translatedText")]
    translated_text: String,
}

/// Translate a batch of texts using the Google Cloud Translation API v2.
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

    // Google Translate API supports up to 128 texts per request
    let mut all_translated = Vec::with_capacity(texts.len());

    for chunk in texts.chunks(128) {
        let mut body = serde_json::json!({
            "q": chunk,
            "target": target_lang,
            "format": "text",
        });

        if let Some(src) = source_lang {
            body["source"] = serde_json::json!(src);
        }

        let response = client
            .post("https://translation.googleapis.com/language/translate/v2")
            .query(&[("key", api_key)])
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                AppError::TranslationApiError(format!("Google Translate request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::TranslationApiError(format!(
                "Google Translate API error {}: {}",
                status, body
            )));
        }

        let result: GoogleResponse = response.json().await.map_err(|e| {
            AppError::TranslationApiError(format!("Google Translate parse error: {}", e))
        })?;

        for t in result.data.translations {
            all_translated.push(t.translated_text);
        }
    }

    Ok(all_translated)
}

use crate::subtitle::types::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct LibreRequest<'a> {
    q: &'a str,
    source: &'a str,
    target: &'a str,
    format: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    api_key: &'a str,
}

#[derive(Debug, Deserialize)]
struct LibreResponse {
    #[serde(rename = "translatedText")]
    translated_text: String,
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
/// Translates each text individually to avoid batch size issues with the public server.
pub async fn translate(
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
    server_url: &str,
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

    // LibreTranslate public server has rate limits — translate in small batches
    // with a short delay between requests
    for chunk in texts.chunks(5) {
        for text in chunk {
            let body = LibreRequest {
                q: text.as_str(),
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

            all_translated.push(result.translated_text);
        }

        // Small delay between chunks to avoid rate limiting on public server
        if texts.len() > 5 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    Ok(all_translated)
}

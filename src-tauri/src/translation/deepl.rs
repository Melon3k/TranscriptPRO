use crate::subtitle::types::AppError;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct DeepLResponse {
    translations: Vec<DeepLTranslation>,
}

#[derive(Debug, Deserialize)]
struct DeepLTranslation {
    text: String,
}

/// Translate a batch of texts using the DeepL API.
/// Automatically detects free vs pro API key (free keys end with ":fx").
pub async fn translate(
    texts: &[String],
    target_lang: &str,
    source_lang: Option<&str>,
    api_key: &str,
) -> Result<Vec<String>, AppError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let base_url = if api_key.ends_with(":fx") {
        "https://api-free.deepl.com"
    } else {
        "https://api.deepl.com"
    };

    let client = reqwest::Client::new();

    // DeepL supports up to 50 texts per request — batch accordingly
    let mut all_translated = Vec::with_capacity(texts.len());

    for chunk in texts.chunks(50) {
        let mut form: Vec<(&str, String)> = chunk
            .iter()
            .map(|t| ("text", t.clone()))
            .collect();

        form.push(("target_lang", target_lang.to_uppercase()));

        if let Some(src) = source_lang {
            form.push(("source_lang", src.to_uppercase()));
        }

        let response = client
            .post(format!("{}/v2/translate", base_url))
            .header("Authorization", format!("DeepL-Auth-Key {}", api_key))
            .form(&form)
            .send()
            .await
            .map_err(|e| AppError::TranslationApiError(format!("DeepL request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::TranslationApiError(format!(
                "DeepL API error {}: {}",
                status, body
            )));
        }

        let result: DeepLResponse = response
            .json()
            .await
            .map_err(|e| AppError::TranslationApiError(format!("DeepL parse error: {}", e)))?;

        for t in result.translations {
            all_translated.push(t.text);
        }
    }

    Ok(all_translated)
}

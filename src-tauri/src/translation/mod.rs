pub mod claude;
pub mod gemini;
pub mod local;

/// Result of a translation run. A mid-run failure (network drop, API error, a
/// single bad cue) is NOT fatal: the provider returns whatever it translated
/// before the failure plus `error`, so hours of local CPU work or a batch of paid
/// cloud calls aren't thrown away. `error: None` means a clean full run or a
/// user cancel. Pre-flight failures (no key, bad client) still return `Err`.
pub struct TranslateOutcome {
    pub texts: Vec<String>,
    pub error: Option<String>,
}

impl TranslateOutcome {
    pub fn complete(texts: Vec<String>) -> Self {
        Self { texts, error: None }
    }
}

/// Truncate a string to at most `max` characters on a UTF-8 char boundary.
/// Byte slicing (`&s[..n]`) panics when `n` falls inside a multi-byte character —
/// used for building safe error previews of API responses.
pub(crate) fn truncate_chars(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

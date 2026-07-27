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

/// Redact substrings that look like provider API keys from user-facing error
/// text: Google (`AIza…`) and Anthropic (`sk-ant-…`). Defense-in-depth — a key
/// should never appear in an error body, but a request echo, a misconfigured
/// proxy, or a verbose ffmpeg/CLI line could surface one, and error text is shown
/// verbatim in the UI banner. Each matched token is replaced with `[redacted]`.
pub(crate) fn redact_secrets(s: &str) -> String {
    // (prefix, minimum trailing key-char run to treat it as a real key)
    const PATTERNS: [(&str, usize); 2] = [("AIza", 30), ("sk-ant-", 20)];
    let is_key_char = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    'scan: while !rest.is_empty() {
        for (prefix, min_run) in PATTERNS {
            if let Some(after) = rest.strip_prefix(prefix) {
                let run = after.chars().take_while(|c| is_key_char(*c)).count();
                if run >= min_run {
                    out.push_str("[redacted]");
                    // Key chars are all ASCII (1 byte), so prefix + run bytes.
                    rest = &rest[prefix.len() + run..];
                    continue 'scan;
                }
            }
        }
        // No pattern here: copy one char verbatim and advance.
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_secrets_removes_google_and_anthropic_keys() {
        let google = "error: key AIzaSyA1234567890abcdefghijklmnopqrstuvwx is invalid";
        let redacted = redact_secrets(google);
        assert!(!redacted.contains("AIzaSy"), "google key leaked: {redacted}");
        assert!(redacted.contains("[redacted]"));

        let claude = "401 sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 rejected";
        let redacted = redact_secrets(claude);
        assert!(!redacted.contains("sk-ant-api03"), "claude key leaked: {redacted}");
        assert!(redacted.contains("[redacted]"));
    }

    #[test]
    fn redact_secrets_leaves_ordinary_text_untouched() {
        let msg = "Gemini API error 400: model not found (AIza is too short here)";
        // "AIza" without a long run must NOT be redacted.
        assert_eq!(redact_secrets(msg), msg);
    }
}

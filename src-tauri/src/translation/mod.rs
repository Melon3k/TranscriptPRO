pub mod claude;
pub mod gemini;
pub mod local;

/// Truncate a string to at most `max` characters on a UTF-8 char boundary.
/// Byte slicing (`&s[..n]`) panics when `n` falls inside a multi-byte character —
/// used for building safe error previews of API responses.
pub(crate) fn truncate_chars(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

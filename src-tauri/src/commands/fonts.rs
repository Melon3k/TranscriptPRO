use crate::subtitle::types::AppError;

/// Enumerate the DISTINCT, human-readable font FAMILY names installed on the
/// machine (macOS + Windows). Pure-Rust via fontdb; called LAZILY by the
/// frontend when the font control is first opened, never at startup. Runs on a
/// blocking thread so the sync fontdb scan (tens of ms, hundreds of faces)
/// never blocks the async runtime / UI.
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        // Dedupe case-insensitively while keeping the first-seen display casing.
        use std::collections::HashMap;
        let mut seen: HashMap<String, String> = HashMap::new();
        for face in db.faces() {
            for (family, _lang) in &face.families {
                let name = family.trim();
                // Drop empty and obviously-internal families (macOS hidden
                // system faces like ".SF NS", ".Helvetica Neue DeskInterface").
                if name.is_empty() || name.starts_with('.') {
                    continue;
                }
                seen.entry(name.to_lowercase())
                    .or_insert_with(|| name.to_string());
            }
        }
        let mut names: Vec<String> = seen.into_values().collect();
        names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        names
    })
    .await
    .map_err(|e| AppError::Other(format!("font enumeration failed: {e}")))
}

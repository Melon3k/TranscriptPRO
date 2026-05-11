use crate::logger;
use crate::subtitle::{
    srt::{parse_srt, write_srt, write_word_srt, write_txt},
    types::{AppError, Subtitle},
};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn import_srt(app: AppHandle, path: String) -> Result<Vec<Subtitle>, AppError> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::FileError(e.to_string()))?;
    let subs = parse_srt(&content)?;
    logger::info(
        &app,
        "file",
        format!("Imported {} segments from {}", subs.len(), path),
    );
    Ok(subs)
}

#[tauri::command]
pub async fn export_srt(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    let content = write_srt(&subtitles);
    std::fs::write(&path, content).map_err(|e| AppError::FileError(e.to_string()))?;
    logger::info(
        &app,
        "file",
        format!("Exported {} segments as SRT → {}", subtitles.len(), path),
    );
    Ok(())
}

#[tauri::command]
pub async fn export_word_srt(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    let content = write_word_srt(&subtitles);
    std::fs::write(&path, content).map_err(|e| AppError::FileError(e.to_string()))?;
    logger::info(
        &app,
        "file",
        format!("Exported word-level SRT ({} segments) → {}", subtitles.len(), path),
    );
    Ok(())
}

#[tauri::command]
pub async fn export_txt(
    app: AppHandle,
    path: String,
    subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    let content = write_txt(&subtitles);
    std::fs::write(&path, content).map_err(|e| AppError::FileError(e.to_string()))?;
    logger::info(
        &app,
        "file",
        format!("Exported TXT ({} segments) → {}", subtitles.len(), path),
    );
    Ok(())
}

#[tauri::command]
pub async fn save_version_history(
    app: AppHandle,
    project_key: String,
    versions_json: String,
) -> Result<(), AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("history");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::FileError(e.to_string()))?;
    std::fs::write(dir.join(format!("{}.json", project_key)), versions_json)
        .map_err(|e| AppError::FileError(e.to_string()))
}

#[tauri::command]
pub async fn load_version_history(
    app: AppHandle,
    project_key: String,
) -> Result<Option<String>, AppError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("history")
        .join(format!("{}.json", project_key));
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::FileError(e.to_string()))?;
    Ok(Some(content))
}

use crate::subtitle::{
    srt::{parse_srt, write_srt, write_word_srt, write_txt},
    types::{AppError, Subtitle},
};

#[tauri::command]
pub async fn import_srt(path: String) -> Result<Vec<Subtitle>, AppError> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::FileError(e.to_string()))?;
    parse_srt(&content)
}

#[tauri::command]
pub async fn export_srt(path: String, subtitles: Vec<Subtitle>) -> Result<(), AppError> {
    let content = write_srt(&subtitles);
    std::fs::write(&path, content)
        .map_err(|e| AppError::FileError(e.to_string()))
}

#[tauri::command]
pub async fn export_word_srt(path: String, subtitles: Vec<Subtitle>) -> Result<(), AppError> {
    let content = write_word_srt(&subtitles);
    std::fs::write(&path, content)
        .map_err(|e| AppError::FileError(e.to_string()))
}

#[tauri::command]
pub async fn export_txt(path: String, subtitles: Vec<Subtitle>) -> Result<(), AppError> {
    let content = write_txt(&subtitles);
    std::fs::write(&path, content)
        .map_err(|e| AppError::FileError(e.to_string()))
}

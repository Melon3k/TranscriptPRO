mod commands;
mod subtitle;
mod translation;
mod whisper;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // IMPORTANT: Every command MUST be listed here.
        // Missing entries cause silent failures when invoked from frontend.
        .invoke_handler(tauri::generate_handler![
            // File I/O
            commands::file_io::import_srt,
            commands::file_io::export_srt,
            commands::file_io::export_word_srt,
            commands::file_io::export_txt,
            // Audio extraction
            commands::audio::extract_audio,
            // Transcription
            commands::transcribe::list_models,
            commands::transcribe::download_model,
            commands::transcribe::transcribe_audio,
            // Translation
            commands::translate::translate_subtitles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TranscriptPRO");
}

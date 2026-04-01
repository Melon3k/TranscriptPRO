mod commands;
mod subtitle;
mod translation;
mod whisper;

use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Arc::new(Mutex::new(
            commands::websocket::WsServerState::default(),
        )))
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
            // Premiere Pro integration (Phase 8)
            commands::premiere::send_to_premiere,
            commands::premiere::reveal_in_finder,
            // Premiere Pro WebSocket bridge (Phase 9)
            commands::websocket::start_ws_server,
            commands::websocket::push_subtitles_to_premiere,
            commands::websocket::get_ws_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TranscriptPRO");
}

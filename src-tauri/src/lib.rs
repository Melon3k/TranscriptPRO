mod commands;
mod logger;
mod subtitle;
mod translation;
mod whisper;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::CommandChild;

/// Shared cancellation flag the frontend can flip to abort an in-progress transcription.
pub struct TranscriptionCancel(pub Arc<AtomicBool>);

/// Shared cancellation flag for an in-progress translation.
pub struct TranslationCancel(pub Arc<AtomicBool>);

/// Shared cancellation flag for an in-progress local-model download.
pub struct ModelDownloadCancel(pub Arc<AtomicBool>);

/// Handle to the running ffmpeg child plus a cancellation flag, so audio extraction can be
/// killed on demand and never lingers as a zombie after the app quits.
pub struct AudioExtraction {
    pub child: Mutex<Option<CommandChild>>,
    pub cancelled: AtomicBool,
}

/// Native mirror of the frontend "unsaved changes" flag. Lets the OS-level close/quit
/// handlers (notably macOS Cmd+Q, which does not emit a per-window close event) guard it.
pub struct DirtyState(pub AtomicBool);

/// The llama-server sidecar powering local translation, plus the port it listens on
/// and a per-run bearer token. Kept warm across translations (the model stays
/// loaded) but shut down after a spell of inactivity to free ~2.5 GB RAM, and
/// killed on app exit. `startup` serializes ensure_server: without it, two
/// concurrent translations both see "no server" and each spawn one (the loser
/// leaks as an orphan process).
pub struct LocalLlm {
    pub child: Mutex<Option<CommandChild>>,
    pub port: Mutex<Option<u16>>,
    pub token: Mutex<Option<String>>,
    pub last_used: Mutex<Option<std::time::Instant>>,
    pub startup: tokio::sync::Mutex<()>,
}

/// Whisper context cached across transcriptions of the same model + backend, so the model
/// isn't reloaded from disk on every job.
pub type WhisperCache = Arc<Mutex<Option<whisper::model::CachedContext>>>;

/// Mirror the frontend dirty flag into native state.
#[tauri::command]
fn set_dirty(dirty: bool, state: tauri::State<'_, DirtyState>) {
    state.0.store(dirty, Ordering::Relaxed);
}

/// Exit the app (called by the frontend after the user confirms discarding unsaved work).
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn kill_audio_child(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AudioExtraction>() {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

fn kill_local_llm(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<LocalLlm>() {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
        if let Ok(mut guard) = state.port.lock() {
            *guard = None;
        }
    }
    translation::local::remove_pidfile(app);
}

/// Remove extraction WAVs left over from previous sessions (each can be hundreds of MB).
/// Runs once at startup so it never races with an in-flight or pending extraction.
fn cleanup_stale_audio() {
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("transcriptpro_audio_") && name.ends_with(".wav") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let whisper_cache: WhisperCache = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        // Must be the first plugin. A 2nd launch focuses the existing window rather
        // than starting a rival instance (which would reap the 1st instance's live
        // llama-server at startup).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(TranscriptionCancel(Arc::new(AtomicBool::new(false))))
        .manage(TranslationCancel(Arc::new(AtomicBool::new(false))))
        .manage(ModelDownloadCancel(Arc::new(AtomicBool::new(false))))
        .manage(AudioExtraction {
            child: Mutex::new(None),
            cancelled: AtomicBool::new(false),
        })
        .manage(DirtyState(AtomicBool::new(false)))
        .manage(LocalLlm {
            child: Mutex::new(None),
            port: Mutex::new(None),
            token: Mutex::new(None),
            last_used: Mutex::new(None),
            startup: tokio::sync::Mutex::new(()),
        })
        .manage(whisper_cache)
        .setup(|app| {
            cleanup_stale_audio();
            // Reap a llama-server orphaned by a previous hard kill / crash.
            translation::local::cleanup_stale_server(&app.handle().clone());

            // Custom menu so Cmd+Q routes through on_menu_event and can be guarded — the
            // default macOS Quit item bypasses RunEvent::ExitRequested (confirmed at runtime).
            // The Edit submenu is kept so text fields still have copy/paste/undo shortcuts.
            let quit = MenuItemBuilder::new("Quit TranscriptPRO")
                .id("quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let app_menu = SubmenuBuilder::new(app, "TranscriptPRO")
                .item(&quit)
                .build()?;
            // No Undo/Redo here: their Cmd+Z / Cmd+Shift+Z accelerators would shadow the
            // app's own subtitle undo/redo (handled in MainLayout's keydown listener).
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .close_window()
                .build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                let dirty = app.state::<DirtyState>().0.load(Ordering::Relaxed);
                if dirty {
                    // Guard: let the frontend confirm before discarding unsaved work.
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("confirm-close", ());
                    }
                } else {
                    kill_audio_child(app);
                    kill_local_llm(app);
                    app.exit(0);
                }
            }
        })
        // Window "X" close: if there are unsaved changes, defer to the frontend dialog.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let dirty = window.state::<DirtyState>().0.load(Ordering::Relaxed);
                if dirty {
                    api.prevent_close();
                    let _ = window.emit("confirm-close", ());
                }
            }
        })
        // IMPORTANT: Every command MUST be listed here.
        // Missing entries cause silent failures when invoked from frontend.
        .invoke_handler(tauri::generate_handler![
            // File I/O
            commands::file_io::import_srt,
            commands::file_io::export_srt,
            commands::file_io::export_word_srt,
            commands::file_io::export_txt,
            commands::file_io::export_vtt,
            commands::file_io::export_ass,
            commands::file_io::save_version_history,
            commands::file_io::load_version_history,
            // Audio extraction
            commands::audio::extract_audio,
            commands::audio::cancel_audio_extraction,
            // Transcription
            commands::transcribe::list_models,
            commands::transcribe::download_model,
            commands::transcribe::transcribe_audio,
            commands::transcribe::cancel_transcription,
            // Local translation model
            commands::local_model::local_model_status,
            commands::local_model::download_local_model,
            commands::local_model::cancel_local_model_download,
            // Translation
            commands::translate::translate_subtitles,
            commands::translate::cancel_translation,
            // API keys (OS credential store)
            commands::keys::set_api_key,
            commands::keys::delete_api_key,
            commands::keys::has_api_key,
            commands::keys::api_key_saved_at,
            // App lifecycle
            set_dirty,
            exit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while running TranscriptPRO")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let dirty = app_handle.state::<DirtyState>().0.load(Ordering::Relaxed);
                if dirty {
                    // Quit (incl. macOS Cmd+Q) with unsaved changes — stay open and let the
                    // frontend show the confirmation dialog. It calls set_dirty(false)+exit_app
                    // to actually quit, so this doesn't loop.
                    api.prevent_exit();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("confirm-close", ());
                    }
                } else {
                    // Actually exiting — make sure ffmpeg and llama-server don't
                    // outlive the app.
                    kill_audio_child(app_handle);
                    kill_local_llm(app_handle);
                }
            }
        });
}

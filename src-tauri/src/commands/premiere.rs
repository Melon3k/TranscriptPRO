use crate::subtitle::{srt::write_srt, types::{AppError, Subtitle}};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Write subtitles as a temp SRT file, then use osascript to import it
/// into the frontmost Premiere Pro project.
/// Returns the SRT file path so the frontend can offer a "Reveal in Finder" fallback.
#[tauri::command]
pub async fn send_to_premiere(
    app: AppHandle,
    subtitles: Vec<Subtitle>,
) -> Result<String, AppError> {
    let srt_path = std::env::temp_dir().join("transcriptpro_premiere.srt");
    let content = write_srt(&subtitles);
    std::fs::write(&srt_path, content)
        .map_err(|e: std::io::Error| AppError::FileError(e.to_string()))?;

    let srt_str = srt_path.to_string_lossy().to_string();

    // Try common Premiere Pro application names on macOS
    let app_names = ["Adobe Premiere Pro 2025", "Adobe Premiere Pro 2024", "Adobe Premiere Pro"];
    let mut last_err = String::new();

    for app_name in &app_names {
        // AppleScript: tell Premiere to import the SRT into the active project
        let script = format!(
            "tell application \"{app_name}\" to importFiles (active project) fileList {{\"{srt_str}\"}}"
        );

        let result = app
            .shell()
            .command("osascript")
            .args(["-e", &script])
            .output()
            .await
            .map_err(|e: tauri_plugin_shell::Error| {
                AppError::Other(format!("osascript not available: {}", e))
            })?;

        if result.status.success() {
            return Ok(srt_str);
        }

        last_err = String::from_utf8_lossy(&result.stderr).to_string();

        // If the error is "application not found", try the next name
        if !last_err.contains("Application can't be found")
            && !last_err.contains("doesn't understand")
        {
            break;
        }
    }

    // Return path so frontend can show fallback UI
    Err(AppError::Other(format!(
        "Could not import into Premiere Pro automatically. \
         SRT saved at: {}\nError: {}",
        srt_str, last_err
    )))
}

/// Reveal the given file path in Finder (macOS: open -R).
#[tauri::command]
pub async fn reveal_in_finder(app: AppHandle, path: String) -> Result<(), AppError> {
    app.shell()
        .command("open")
        .args(["-R", &path])
        .output()
        .await
        .map_err(|e: tauri_plugin_shell::Error| {
            AppError::Other(format!("Could not open Finder: {}", e))
        })?;
    Ok(())
}

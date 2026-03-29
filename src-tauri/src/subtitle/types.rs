use serde::{Deserialize, Serialize};

/// Word-level timestamp data from Whisper transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub start_time: u64, // milliseconds
    pub end_time: u64,   // milliseconds
}

/// A single subtitle segment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    pub id: String,        // UUID
    pub index: usize,      // 1-based sequential number
    pub start_time: u64,   // milliseconds
    pub end_time: u64,     // milliseconds
    pub text: String,
    pub words: Vec<Word>,  // word-level timestamps (empty after translation)
}

/// Full project state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub file_path: String,
    pub subtitles: Vec<Subtitle>,
    pub language: String,
    pub whisper_model: String,
}

/// Progress update during transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionProgress {
    pub stage: String,    // "extracting_audio" | "loading_model" | "transcribing" | "done"
    pub progress: f32,    // 0.0 to 1.0
    pub message: String,
}

/// Information about an available Whisper model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModelInfo {
    pub name: String,          // e.g. "tiny", "small", "large-v3"
    pub size_mb: u64,          // approximate size in MB
    pub downloaded: bool,
    pub path: Option<String>,  // full path if downloaded
    pub bundled: bool,         // true for models shipped with the app
}

/// Application error type with user-friendly messages
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Model '{0}' is not downloaded. Please download it first.")]
    ModelNotFound(String),

    #[error("Failed to extract audio: {0}")]
    AudioExtractionFailed(String),

    #[error("Transcription failed: {0}")]
    TranscriptionFailed(String),

    #[error("Translation API error: {0}")]
    TranslationApiError(String),

    #[error("File error: {0}")]
    FileError(String),

    #[error("Invalid SRT format: {0}")]
    InvalidSrtFormat(String),

    #[error("{0}")]
    Other(String),
}

/// Serialize AppError as string for Tauri IPC
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

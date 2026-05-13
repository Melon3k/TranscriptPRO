use serde::{Deserialize, Serialize};

/// Word-level timestamp data from Whisper transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_time: u64, // milliseconds
    pub end_time: u64,   // milliseconds
}

/// A single subtitle segment
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitle {
    pub id: String,        // UUID
    pub index: usize,      // 1-based sequential number
    pub start_time: u64,   // milliseconds
    pub end_time: u64,     // milliseconds
    pub text: String,
    pub words: Vec<Word>,  // word-level timestamps (empty after translation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>, // e.g. "Speaker 1", "Speaker 2"
}

/// Full project state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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

    #[error("Failed to download model: {0}")]
    ModelDownloadFailed(String),

    #[error("Operation cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Stable error code consumed by the frontend i18n layer (errors.json).
    pub fn code(&self) -> &'static str {
        match self {
            AppError::ModelNotFound(_) => "MODEL_NOT_FOUND",
            AppError::AudioExtractionFailed(_) => "AUDIO_EXTRACTION_FAILED",
            AppError::TranscriptionFailed(_) => "TRANSCRIPTION_FAILED",
            AppError::TranslationApiError(_) => "TRANSLATION_API_ERROR",
            AppError::FileError(_) => "FILE_ERROR",
            AppError::InvalidSrtFormat(_) => "INVALID_SRT_FORMAT",
            AppError::ModelDownloadFailed(_) => "MODEL_DOWNLOAD_FAILED",
            AppError::Cancelled => "CANCELLED",
            AppError::Other(_) => "UNKNOWN_ERROR",
        }
    }

    /// The variant-specific detail (UUID, ffmpeg stderr, etc.) — useful for `{detail}` interpolation.
    pub fn detail(&self) -> &str {
        match self {
            AppError::ModelNotFound(s)
            | AppError::AudioExtractionFailed(s)
            | AppError::TranscriptionFailed(s)
            | AppError::TranslationApiError(s)
            | AppError::FileError(s)
            | AppError::InvalidSrtFormat(s)
            | AppError::ModelDownloadFailed(s)
            | AppError::Other(s) => s,
            AppError::Cancelled => "",
        }
    }
}

/// Serialize AppError as `{ code, message, detail }` for Tauri IPC.
/// Frontend maps `code` to a translation key; `message` is the English fallback.
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.serialize_field("detail", self.detail())?;
        state.end()
    }
}

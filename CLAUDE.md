# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**TranscriptPRO** is a desktop subtitle editor with local Whisper AI transcription. It's a Tauri 2.0 app (Rust backend + React frontend). The long-term direction is a dual-target product: the same React UI should run both as this desktop app (Windows/macOS) and as a hosted web app.

## Commands

```bash
# Development
npm run dev              # Vite (port 1420) + Tauri dev window — the main dev loop
npm run build            # tsc + Vite production build (prepares for Tauri bundle)
npm run tauri            # Raw Tauri CLI passthrough (e.g. npm run tauri build)
```

No lint or test scripts are configured.

## Architecture

Two layers communicating via Tauri IPC:

### 1. React Frontend (`src/`)
- **State**: Zustand stores in `src/stores/` — `subtitleStore` (subtitles + 50-item undo/redo), `playerStore`, `settingsStore` (persisted to localStorage), `versionStore`
- **Tauri IPC**: All backend calls go through wrappers in `src/lib/tauri-commands.ts`
- **Subtitle ops**: Split, merge, reindex logic in `src/lib/subtitle-ops.ts`; time conversion in `src/lib/time-format.ts`; diff in `src/lib/diff.ts`

### 2. Rust Backend (`src-tauri/src/`)
- Commands are registered in `lib.rs` and implemented in `src-tauri/src/commands/`:
  - `audio.rs` — ffmpeg wrapper for audio extraction
  - `transcribe.rs` — Whisper.cpp model management and transcription
  - `translate.rs` — Gemini / Claude orchestration
  - `keys.rs` — API keys in the OS credential store (keyring); keys never cross IPC to the webview
  - `local_model.rs` — download/status of the local TranslateGemma GGUF (SHA-256 pinned)
  - Local translation engine in `src-tauri/src/translation/local.rs` — drives the `llama-server`
    sidecar (static build via `scripts/build-llama-server.sh`, pinned llama.cpp tag); prompts are
    hand-rolled Gemma turns because the GGUF chat template doesn't parse (hence `--no-jinja`)
  - `file_io.rs` — SRT/TXT import and export, version history persistence
- Domain types live in `src-tauri/src/subtitle/types.rs`; SRT parsing in `src-tauri/src/subtitle/srt.rs`

## Key Integration Points

- **Port 1420**: Vite dev server — Tauri's `beforeDevCommand` expects exactly this port (enforced in `vite.config.ts`).
- **Whisper models**: Downloaded to and read from the Tauri app-data directory (`~/.config/transcriptpro/models/` on Linux/macOS).
- **CSP** (`src-tauri/tauri.conf.json`): Allows requests to Gemini, HuggingFace, and DeepL endpoints — add new API domains here when integrating new services.

## Development Notes

- Settings are persisted to `localStorage` under the key `transcriptpro-settings`; wipe it to reset to defaults during testing.
- API keys are NOT in localStorage — a single random master key lives in the OS keychain (service `com.transcriptpro.app`, account `master-key`) and the keys themselves sit AES-GCM-encrypted in app-data `keys.enc.json` (the Electron-safeStorage pattern; one keychain item = at most one macOS ACL prompt per run, none at startup). The frontend only tracks presence flags (`hasGeminiKey`/`hasClaudeKey`).

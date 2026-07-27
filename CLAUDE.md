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

# Tests
npm test                 # Vitest — frontend unit tests (run before the bundle in CI)
cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust tests incl. the MP4 burn-in smoke

# Release
npm run bump <version>   # sync version in package.json, tauri.conf.json, Cargo.toml, Cargo.lock
```

CI (`.github/workflows/ci.yml`) gates every PR to `main` on `npm test` → `cargo test` → a
full signed Tauri bundle (macOS universal + Windows). No linter and no standalone
`tsc --noEmit` step are configured (types are checked via `npm run build`'s `tsc`).

## Architecture

Two layers communicating via Tauri IPC:

### 1. React Frontend (`src/`)
- **State**: Zustand stores in `src/stores/` — `subtitleStore` (subtitles + 50-item undo/redo + `dirty`), `playerStore` (playhead + `previewPath` for the display proxy), `settingsStore` and `styleStore` (both persisted to localStorage, separate keys), `versionStore`, `recentFilesStore`, `notifyStore`, `logStore`
- **Tauri IPC**: All backend calls go through wrappers in `src/lib/tauri-commands.ts`
- **Subtitle ops**: Split, merge, reindex logic in `src/lib/subtitle-ops.ts`; time conversion in `src/lib/time-format.ts`; diff in `src/lib/diff.ts`
- **Caption styling**: one global `CaptionStyle`/`CaptionAnimation` (`src/types/captionStyle.ts`); serialization/measurement helpers in `src/lib/caption-style.ts`, `caption-animation.ts`, `caption-presets.ts`; UI in `src/components/Style/`
- **Unsaved-changes guard**: `src/lib/unsaved-guard.ts` (`confirmDiscardIfDirty`) is called before any in-app document swap (open / recent / drop / restore); window-close/Cmd+Q is guarded natively in `lib.rs`

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
  - `video_export.rs` — ffmpeg burn-in of the styled/animated subtitles into an MP4 (over the
    ASS the app generates); re-entrancy guard, cancel, and a hard guard that output ≠ source
  - `preview.rs` — probes the source and, for heavy (>1920px) or rotation-flagged video that
    WKWebView can't render, transcodes a lightweight 720p rotation-baked proxy (`tpro_proxy_*`)
    the player plays instead. Preview-only — `filePath` (used by transcription + burn-in) stays
    the original
  - `fonts.rs` — system font enumeration for the picker (via `fontdb`, on `spawn_blocking`)
  - `file_io.rs` — SRT/TXT/VTT/ASS import/export and version-history persistence
- Domain types live in `src-tauri/src/subtitle/types.rs`; parsers/serializers per format in
  `src-tauri/src/subtitle/` (`srt.rs`, `vtt.rs`, `ass.rs`, `style.rs`) — note **only SRT has an
  importer**; ASS/VTT are export-only, so they don't count as a project save
- Startup cleanup (`cleanup_stale_temp` in `lib.rs`) sweeps stale `transcriptpro_audio_*.wav`,
  `tpro_burn_*/`, and `tpro_proxy_*` temp leftovers left by a crash/hard-kill

## Key Integration Points

- **Port 1420**: Vite dev server — Tauri's `beforeDevCommand` expects exactly this port (enforced in `vite.config.ts`).
- **Whisper models**: Downloaded to and read from the Tauri app-data directory (`~/.config/transcriptpro/models/` on Linux/macOS).
- **CSP** (`src-tauri/tauri.conf.json`): `connect-src` lists the API domains — add new ones here when integrating a service. Note the webview itself makes almost no direct network calls (Gemini/Anthropic/HuggingFace/updater all run from Rust via `reqwest`, which CSP doesn't gate); the list still carries some stale entries (DeepL/Google Translate) pending a cleanup.
- **Capabilities** (`src-tauri/capabilities/default.json`): kept minimal — the webview has NO `shell`/`fs` permissions; all file and subprocess work goes through the Rust commands above.

## Development Notes

- Settings are persisted to `localStorage` under the key `transcriptpro-settings`; wipe it to reset to defaults during testing.
- API keys are NOT in localStorage — a single random master key lives in the OS keychain (service `com.transcriptpro.app`, account `master-key`) and the keys themselves sit AES-GCM-encrypted in app-data `keys.enc.json` (the Electron-safeStorage pattern; one keychain item = at most one macOS ACL prompt per run, none at startup). The frontend only tracks presence flags (`hasGeminiKey`/`hasClaudeKey`).

# Backlog

Deferred items and ideas, surfaced during the AI code review + runtime testing pass
(branch `claude/ai-code-review-team-d29674`). Grouped by area; not in priority order.

## Translation
- **Local / offline translation model.** Bundle an open-source translation model that runs
  on-device (no API key, works offline) as a provider alongside Gemini / Claude / LibreTranslate.
- **LibreTranslate key UX.** The public `libretranslate.com` server now requires an API key.
  The key field already exists in Settings; make it more discoverable for LibreTranslate and
  add short guidance for pointing at a self-hosted instance.
- **Partial results on API error.** Providers return partial translations on user *cancel*;
  a mid-batch API error still drops the whole batch. Consider keeping the already-translated
  chunks on error too.

## Security
- **API keys → OS keychain / Stronghold.** Gemini / Claude / LibreTranslate keys are stored in
  `localStorage` in plaintext. Move them to the OS keychain (or `tauri-plugin-stronghold`) and
  keep only a "key present" flag in localStorage.
- **Model / ffmpeg checksums.** Verify SHA-256 of downloaded Whisper models and the bundled
  ffmpeg sidecar (currently HTTPS-trust only).
- **`assetProtocol` scope.** Currently `**` to allow media from arbitrary paths; revisit whether
  it can be narrowed.

## Editor / UX
- **Inverted-time feedback.** The blocking start<end validation was removed (it blocked the
  legitimate "move a segment by editing start first" flow). Replace with a non-blocking signal:
  highlight rows where start ≥ end, or validate at export time.
- **Virtualize the subtitle list.** `React.memo` is in place; virtualization (react-window /
  virtuoso) is still deferred for very large transcripts — needs care around auto-scroll and
  word drag & drop.
- **`[Speaker N]` round-trip.** `write_srt` prefixes `[Speaker N]` but `parse_srt` never reads it
  back, so re-importing an exported SRT folds the tag into the text.

## Platform
- **Cmd+Q guard on Windows/Linux.** The unsaved-changes guard was verified on macOS (custom menu
  intercepting Quit). Verify the window-close / quit paths behave on Windows and Linux.
- **Offline onboarding.** The onboarding wizard's model step currently requires a download;
  allow completing it offline.

## Reliability
- **ffmpeg WAV cleanup on quit.** If the app quits mid-extraction, the killed ffmpeg child can
  leave a 0-byte WAV (harmless; cleaned at next startup via `cleanup_stale_audio`). Optionally
  remove the in-progress output on the exit path too.

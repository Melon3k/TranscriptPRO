# Backlog

Deferred items and ideas, ordered by priority (impact × effort).

Done in the 2026-07-12 pass (branch `claude/project-backlog-review-b93e6c`):
`[Speaker N]` round-trip fix, API keys → OS keychain, LibreTranslate provider
removed entirely (public server went fully paid), **local translation provider
shipped** (TranslateGemma 4B via static llama-server sidecar — see below).

Follow-up AI review pass (2026-07-13) fixed: partial-results-on-error for all
translation providers; universal `lipo` sidecar (release-blocker); Gemini key
moved to header (no leak into logs); llama-server bearer token + idle shutdown;
llama-server dropped from the shell capability; download-progress IPC throttle;
key-migration writes-before-deletes. **Still open from that review:**

- **Orphaned llama-server on hard kill / crash.** *(reliability — CONFIRMED live)*
  Graceful quit (Cmd+Q, window close) kills the sidecar; a SIGKILL/SIGTERM/crash
  of the app orphans the ~2.5 GB server (idle-watchdog only reaps while the app is
  alive). Fix: reap stale sidecars at startup — a PID+port file in app-data written
  on spawn and swept in `.setup()` (like `cleanup_stale_audio`), verifying the PID
  is actually our llama-server before killing (guard against PID reuse).
- **Gemma Terms prominence.** *(compliance — MEDIUM)* Move the notice into the
  model-download confirmation ("by downloading you accept…") + README/About, rather
  than the 10 px panel footnote. No lawyer reviewed the mirror-vs-gated-repo choice;
  decision recorded as acceptable good-faith posture for now.
- **Windows llama-server** *(reliability — untested)*: verify the `.exe` starts on a
  clean machine (static CRT / VC++ redist) and CPU-only speed on a real box.
- **Cancel latency** *(MEDIUM)*: a hung single request (≤300 s) still blocks cancel;
  wrap the per-cue request in a `select!` on the cancel flag.
- **Model download not cancelable** *(MEDIUM)*; **corrupt keys.enc.json bricks key
  ops** (quarantine + continue) *(MEDIUM)*; **master-key-lost → misleading "API key
  required"** (dedicated message + clear dead entry) *(MEDIUM)*.
- **Sequential per-cue throughput** *(MEDIUM, documented)*: parallel slots (`-np`)
  only if long-file CPU runs prove too slow — conflicts with the idle/low-RAM
  profile, so keep 1 slot unless measured otherwise.
- **CI cache for the sidecar** *(LOW — repo is public, so speed not cost)*:
  `actions/cache` on `llama-server-*` keyed by llama.cpp tag+platform.
- LOW: AES-GCM AAD binding provider; `get_api_key` blocking IO off the async thread;
  stale `originalSubtitles` after re-transcription/version-restore; "which key is
  saved" hint; onboarding copy mentioning the free local model.

## Local / offline translation — SHIPPED (TranslateGemma 4B), follow-ups below

Decision (2026-07-12, user call): **TranslateGemma 4B**, implemented on branch
`claude/project-backlog-review-b93e6c` as provider "local" — static `llama-server`
sidecar (pinned llama.cpp tag, `scripts/build-llama-server.sh`, no OpenSSL/dylibs),
GGUF downloaded on demand from the ungated mradermacher mirror with pinned size +
SHA-256, hand-rolled Gemma-turn prompt via `/completion` with `--no-jinja` (the GGUF
chat template crashes llama-server — upstream #20305), per-cue requests (alignment-safe,
prompt-cache absorbs the prefix), partial results on cancel, e2e-tested PL→EN on macOS.

Follow-ups:
- **Release compliance (Gemma Terms):** in-app notice is shown in the translation panel;
  still need the use-restrictions pass-through clause in the app EULA/ToS before a
  public release that bundles/downloads the model.
- **Orphaned llama-server on hard kill.** Menu quit / window close / ExitRequested all
  kill the sidecar; a SIGKILL/crash of the app leaves it running (same class of issue
  as ffmpeg). Consider a startup sweep that kills processes whose cmdline points at our
  model path, or a watchdog.
- **Windows validation:** static build script has an untested MSVC path (`build-llama-server.sh
  windows` in CI); verify CPU-only speed on a real GPU-less machine and consider showing a
  "this may take a while" hint for long files.
- **Quality bake-off, later:** Hy-MT2-1.8B (Apache 2.0, 1.13 GB, WMT25-champion lineage —
  possibly better AND smaller) and MiLMMT-46-4B remain worth an in-house PL↔EN subtitle
  bake-off; TranslateGemma won on independent validation (Alconost subtitle benchmark) and
  55-language coverage, but no public benchmark isolates Polish. Also watch for a
  "TranslateGemma 2" on Gemma 4 (Apache 2.0). Full research notes: rejected NLLB/
  SeamlessM4T/Tower+ (non-commercial), GemmaX2-28 (no UK), MADLAD-400, Seed-X-7B,
  Qwen-MT (API-only), Argos/OPUS-MT (quality), Bielik (Polish-only, 6.7 GB; possible
  future "premium Polish" option via Minitron-7B).
- **Batching optimization:** per-cue requests are correctness-first; if users report
  slow long files on x86 CPUs, add multi-cue batching (numbered-lines with per-line
  fallback) and/or `--parallel` slots.

## P2 — soon, before wider release

- **Partial results on API error.** *(Translation — low/medium effort)* Providers return
  partial translations on user *cancel*; a mid-batch API error still drops the whole batch.
  Keep the already-translated chunks on error too — the partial-results plumbing from the
  cancel path already exists, this extends it to the error path. Saves paid API calls on
  large batches.
- **Cmd+Q guard on Windows.** *(Platform — verification task)* The unsaved-changes guard was
  verified on macOS (custom menu intercepting Quit). Verify the window-close / quit paths on
  Windows before shipping Windows builds — it protects against data loss on a shipped target.
  (Linux is not a shipping target; verify opportunistically.)
- **Inverted-time feedback.** *(Editor / UX — low/medium effort)* The blocking start<end
  validation was removed (it blocked the legitimate "move a segment by editing start first"
  flow). Replace with a non-blocking signal: highlight rows where start ≥ end, and/or validate
  at export time so broken timings can't ship silently.
- **Model / ffmpeg checksums.** *(Security — low/medium effort)* Verify SHA-256 of downloaded
  Whisper models (published on HuggingFace) and the bundled ffmpeg sidecar (pin at build/CI
  time). Currently HTTPS-trust only. Applies to the future TranslateGemma GGUF download too.

## P3 — nice to have / wait for a signal

- **Virtualize the subtitle list.** *(Editor / UX — high effort)* `React.memo` is in place and
  covers current sizes; virtualization (react-window / virtuoso) needs care around auto-scroll
  and word drag & drop. Pick up when real transcripts show measurable lag, not before.
- **Offline onboarding.** *(Platform — low effort, niche)* The onboarding wizard's model step
  currently requires a download; allow completing it offline.
- **ffmpeg WAV cleanup on quit.** *(Reliability — cosmetic)* If the app quits mid-extraction,
  the killed ffmpeg child can leave a 0-byte WAV — harmless, already cleaned at next startup
  via `cleanup_stale_audio`. Optionally remove the in-progress output on the exit path too.
- **`assetProtocol` scope.** *(Security — likely wontfix)* Currently `**` to allow media from
  arbitrary user-chosen paths; a file-open app can't easily narrow this without breaking the
  core flow. Revisit only if Tauri grows a dynamic-scope API; otherwise document the decision.

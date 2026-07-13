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
key-migration writes-before-deletes; **Windows CI green** (disabled the server Web
UI build — `LLAMA_BUILD_UI=OFF`). Merged as PR #19 (merge commit `a341897`).

Second follow-up pass (2026-07-13, branch `claude/review-followups`) — the review
backlog is now cleared:

- ✅ **Orphaned llama-server on hard kill / crash** — reaped at startup via a
  PID file (`llama-server.pid`) written on spawn and swept in `.setup()`, verifying
  the PID is really a llama-server (ps/tasklist) before killing. **Verified live**:
  hard-killed the app → orphan survived → relaunch reaped it.
- ✅ **Gemma Terms prominence** — acceptance notice now shown in the download block
  ("by downloading you accept…") + README.
- ✅ **Cancel latency** — per-cue request raced against the cancel flag (`select!`).
- ✅ **Model download cancelable** — cancel flag + command + X button.
- ✅ **Corrupt keys.enc.json** — quarantined to `.corrupt-<ts>` and treated as empty
  (+ `fsync` before rename in `write_store`).
- ✅ **Master-key-lost** — `KeyLookup::Unreadable` → clear message + dead entry cleared.
- ✅ **get_api_key** off the async thread (`spawn_blocking`).
- ✅ **Stale `originalSubtitles`** cleared after re-transcription and version-restore.
- ✅ **"Which key is saved"** — Settings shows the save date (date only; storing key
  chars in the plaintext file was deliberately avoided).
- ✅ **Onboarding copy** mentions the free offline model.

A review OF this branch (2026-07-13) found follow-up bugs, all fixed in-branch:
llama-server reap could hit a live server (added single-instance guard, tightened
PID identity to the model-file/sidecar name, remove pidfile on cancelled start);
`Unreadable` no longer deletes the key (data-loss on transient master-key loss) —
dedicated localized error instead; removed the duplicate Gemma notice; download
cancel is now prompt even on a frozen connection; save-date uses the app locale.

**Still open (deliberately deferred):**

- **Windows llama-server runtime** *(untested)*: CI builds the `.exe`, but nobody has
  run it on a clean machine (static CRT / VC++ redist) or measured CPU-only speed.
- **Gemma Terms — legal sign-off**: the mirror-vs-gated-repo choice and EULA
  pass-through are an engineering good-faith posture; a lawyer hasn't reviewed them.
- **AES-GCM AAD binding provider** *(LOW — won't do now)*: would bind each ciphertext
  to its provider, but adding it invalidates every existing `keys.enc.json` entry
  (forces key re-entry) to defend only against someone who can already write to your
  app-data — poor trade for a local-only app. Revisit only on a future store-format bump.
- **Sequential per-cue throughput** *(MEDIUM, documented)*: parallel slots (`-np`)
  only if long-file CPU runs prove too slow — conflicts with the idle/low-RAM profile.
- **CI cache for the sidecar** *(LOW — repo is public, so speed not cost)*.

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

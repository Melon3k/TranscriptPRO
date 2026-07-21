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

Done in the 2026-07-17 pass (branch `claude/backlog-implementation-399bde`):

- ✅ **Partial results on API error** — turned out to be already shipped in PR #19
  (the "partial-results-on-error for all translation providers" fix); the entry here
  was stale.
- ✅ **Inverted-time feedback** — rows with start ≥ end get a red border + warning line
  and red timestamps (non-blocking, so the "edit start first" flow still works), and
  exporting any timed format (SRT / Word SRT / VTT / ASS) with inverted cues asks for
  confirmation with the count and first offending index.
- ✅ **Model / ffmpeg checksums** — Whisper model downloads are now verified against
  SHA-256 pins taken from the HuggingFace LFS metadata (the pin table doubles as the
  download whitelist); `download-ffmpeg.sh` pins the SHA-256 of all three upstream
  archives (macOS pins confirmed bit-identical to the binaries shipped since May 2026;
  Windows pin is gyan.dev's published checksum, URL switched from the floating
  `release-essentials` alias to the versioned 8.1.2 package). The inline PowerShell
  ffmpeg steps in `ci.yml`/`release.yml` got the same pinned URL + hash check.
  The TranslateGemma GGUF was already pinned.

Still open:

- **Cmd+Q guard on Windows.** *(Platform — verification task)* The unsaved-changes guard was
  verified on macOS (custom menu intercepting Quit). Verify the window-close / quit paths on
  Windows before shipping Windows builds — it protects against data loss on a shipped target.
  (Linux is not a shipping target; verify opportunistically.)

## P3 — nice to have / wait for a signal

- ✅ **Offline onboarding** *(done 2026-07-17)* — the model step now has a
  "Skip — download later" action, so the wizard completes with no network.
- **Virtualize the subtitle list.** *(Editor / UX — high effort)* `React.memo` is in place and
  covers current sizes; virtualization (react-window / virtuoso) needs care around auto-scroll
  and word drag & drop. Pick up when real transcripts show measurable lag, not before.
- **ffmpeg WAV cleanup on quit.** *(Reliability — cosmetic)* If the app quits mid-extraction,
  the killed ffmpeg child can leave a 0-byte WAV — harmless, already cleaned at next startup
  via `cleanup_stale_audio`. Optionally remove the in-progress output on the exit path too.
- **`assetProtocol` scope.** *(Security — likely wontfix)* Currently `**` to allow media from
  arbitrary user-chosen paths; a file-open app can't easily narrow this without breaking the
  core flow. Revisit only if Tauri grows a dynamic-scope API; otherwise document the decision.

## New design (redesign UI) — SHIPPED (items A–G, 2026-07 AI-agent pass)

The `feat/new-design` redesign (PR #23) shipped the full new UI with the styling
panels **built but grayed**. The 2026-07 AI-agent pass (branch
`claude/new-design-features`, one workflow run per item: spec → implement →
verify → adversarial review) made all of them real. Accepted decisions:
**one global `CaptionStyle`/`CaptionAnimation`** (per-segment overrides remain a
future additive field), and **honest export** — only fields ASS can faithfully
carry are exported; the rest are marked "preview only" in the UI.

- ✅ **F1 — Style foundation.** `CaptionStyle` type + persisted `styleStore`;
  Player overlay bound to it (anchored to the video frame, no background pill);
  Outfit/Inter/JetBrains Mono bundled locally via `@fontsource` (SIL OFL) with
  `font-src 'self' data:` added to the CSP.
- ✅ **F2 — ASS serialization.** `export_ass` generates `[V4+ Styles]` from the
  style (Script Info `PlayResX/Y 1920×1080`, `ScaledBorderAndShadow`); uppercase
  applied in Rust, braces escaped. `lineHeight`/`glow`/`align` are preview-only.
- ✅ **A — Inspector tab live.** Font/size/spacing/line-height, L/C/R, B/I/TT,
  outline/shadow/glow + strengths, four colour pickers, 3×3 box grid (visual→ASS
  numpad map), width, distance, reset. Preview-only badges on glow/line-height/align.
- ✅ **B — Draggable caption box.** "Position" mode on the player; drag snaps the
  numpad column/row and sets `marginVPct`/`widthPct` live, syncing bidirectionally
  with the Inspector (no free X — ASS Alignment is discrete, `\pos` out of scope).
- ✅ **D — Effects/presets tab.** Named `CaptionStyle` snapshots: four built-ins +
  user presets with live previews, New/Duplicate/Save/Delete/rename/search,
  persisted; applying reuses `setStyle` so export stays faithful.
- ✅ **C — Animations tab.** One global `CaptionAnimation`: fade (ASS `\fad`) and
  karaoke (ASS `\k` + Primary/Secondary split) exported end-to-end; slide/pop/
  typewriter/blur were preview-only here but **all now export too** (see the
  follow-on below). Default `none`. Animation editor modal deliberately deferred.
- ✅ **E — Export preview modal.** "Preview & export" opens SRT/VTT tabs rendering
  the exact serializer output (read-only `preview_export` command) + Download;
  inverted timings shown as an inline banner (no double prompt). Word SRT/ASS/TXT
  keep their direct menu entries.
- ✅ **G — Drag-and-drop regression fixed.** Word DnD reimplemented on pointer
  events (`useWordDrag`), so native Tauri file drop is re-enabled
  (`dragDropEnabled: true`) with a drop overlay.

### Video export + fidelity follow-on (2026-07-21, same branch)

After A–G, the user asked for the real goal — **burn the styled/animated
subtitles into an MP4** — plus a batch of QA fixes from live testing. All done on
`claude/new-design-features` (each its own commit; workflow spec→impl→verify→review,
or a single focused agent where the workflow's spec phase kept failing):

- ✅ **MP4 burn-in export.** New "Eksportuj wideo (MP4)" in the Rail export menu →
  `export_video` runs the bundled ffmpeg over the ASS the app already generates
  (`-vf ass=…`, H.264 + AAC), progress + cancel, temp cleanup. Path-escaping solved
  by writing the `.ass` to a per-export temp dir and running ffmpeg with `current_dir`
  there (bare basename in the filtergraph). **ASS is now invisible internal plumbing**,
  not a user deliverable.
- ✅ **Bundled TTF fonts for the burn.** Static Regular+Bold of Outfit/Inter/JetBrains
  Mono (SIL OFL) shipped in `src-tauri/fonts/` (bundle resource); burn copies them into
  the temp dir + `fontsdir=.` so the video matches the preview. Family names verified
  to equal the ASS `Fontname`. Degrades to system substitution (reported) if unavailable.
- ✅ **System fonts.** `list_system_fonts` (fontdb) → searchable font picker (bundled
  pinned on top). `fontId` generalized to a family-name string (legacy ids migrate).
  System-font burns embed the located face via fontdb so libass matches by name.
- ✅ **Colour picker with alpha.** react-colorful popover (sat/hue/alpha + Hex/R/G/B/A),
  colours now `#RRGGBBAA`; alpha flows to preview, ASS (`&HAABBGGRR` inverse-alpha) and
  the burn. Migration of persisted styles/presets on load.
- ✅ **All animations now export/burn** (was fade+karaoke only): pop `\fscx/\t`, blur
  `\blur24\t`, slide `\move`, typewriter per-char `\alpha` cascade. easing + per-word
  delay stay preview-only.
- ✅ **Glow exported** as a soft fill-shape halo (blurred glyph copy in the glow colour
  on a layer behind the caption) — matches the CSS preview; replaced a first attempt that
  rendered a chunky border ring.
- ✅ **QA fixes from testing:** light-theme animation/preset card labels made readable;
  translation *comparison* view scoped to the Translate workspace (was leaking into
  transcription and hiding progress); stale word-selection after a cross-segment move
  fixed (orphaned-id prune + clear-on-row-click); **custom tooltips** app-wide (native
  `title` doesn't render in the macOS WKWebView).

### To take care of (known limitations / follow-ups)

- **Everything here was verified by `tsc` + `vitest` + `cargo test` and, for the burn,
  by inspecting fixture frames — but NOT by a real `tauri build` + release run.** Font
  bundling fidelity and resource paths only fully manifest in a packaged build; do a
  build + smoke before any release.
- **Windows unverified** for the new surfaces: system-font enumeration, burn-in fonts,
  and the still-open **Cmd+Q guard** (P2) need a Windows pass. `tauri-driver` E2E is
  Linux/Windows-only (no macOS), so automated end-to-end stays CI-only.
- **Test automation deferred** (user's call): the UI/burn behaviours are covered by unit
  tests + manual QA only. No component (jsdom/RTL) or burn-smoke tests yet — EDT-1 in
  particular shipped without a regression test. First automation slice, when wanted:
  component tests + a cargo burn-smoke.
- **libass effect limits (documented, accepted):** blur reads as a shrinking halo, not a
  photographic defocus; typewriter is a per-char fade cascade, not a hard slice; a long
  multi-line *slide* cue may wrap slightly differently under `\move`.
- **Bundle size:** the three TTFs add ~1–1.5 MB to the installer/updater artifact.
- Still deferred by design: per-segment style/animation overrides; the animation editor
  modal; free per-cue `\pos`; preview tabs for Word SRT/ASS/TXT.

Not on this list (these work): Whisper transcription + speaker detection, translation
(Gemini/Claude/local Gemma), SRT import, SRT/VTT/ASS/TXT/Word SRT export, editing/segments,
version history + diff, logs, settings, updates.

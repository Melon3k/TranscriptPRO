# Backlog

Deferred items and ideas, ordered by priority (impact × effort).

## 2026-07-27 — AI review delta pass (PR #30, shipped in v2.0.0)

4-reviewer AI review of the delta since PR #18 (video export, styling/animations,
local model, ASS/VTT, new Player): 2 CRITICAL, 21 HIGH, 30 MEDIUM, 18 LOW.
The release gate + a proxy feature found during runtime testing were fixed and
verified (tsc clean · vitest 121/121 · cargo test 107/107 · manual runtime pass).

**Done (in v2.0.0):** C1 burn-in can't overwrite the source video; C2 unsaved-changes
guard on open/recent/drop/restore; H1 ASS/VTT no longer mark saved; H2 reliable
history autosave (dirty only cleared after a confirmed write); H4 startup cleanup of
`tpro_burn_*`/`tpro_proxy_*`; H5 video-export re-entrancy guard (no zombie ffmpeg);
H6/REL-12 `export_ass` uses real font metrics like the burn (shared `OnceLock` fontdb,
`spawn_blocking`); H7 `<video>` error handling; H8 empty-segment placeholder; H9
`colorShift` uses real text colour; H10 overlay auto-on in Style; H11 MP4 export runs
the inverted-timing/animation warnings; H12 API-key redaction + non-auto-dismiss error
banners; H13 local-model status retry; H14 removed unused shell/fs webview permissions.
**New feature:** media-preview proxy (WKWebView can't render 4K H.264 + 90° rotation —
`preview.rs` transcodes a 720p rotation-baked proxy). Plus: opening a new file clears the
old transcription immediately.

**Still open — deferred from this review (not blocking v2.0.0):**

- **Security (MEDIUM/LOW):** `extract_audio` input not validated + no `-protocol_whitelist`
  (SSRF surface, LOW on desktop); CSP `connect-src` still lists dead DeepL/Google domains;
  llama-server port-identity check before sending the bearer token; ASS brace-escape edge
  (`\{`) and speaker-prefix `\n` sanitization; model-download hard size cap before SHA;
  `keys.enc.json` mode 0600 on Unix. *(Web-app variant cancelled → the "web-app only" SEC
  risks are now theoretical.)*
- **Performance (measure first):** virtualize the subtitle list (still P3 below — reconfirmed
  for 2h+ transcripts; blocked on drag & drop + auto-scroll rework); incremental version
  history (currently 50 full snapshots re-serialized per autosave → up to ~65 MB); `diff.ts`
  `Int32Array` + trim; stream WAV into `Vec<f32>` (avoid ~230 MB peak); cap `decode`-animation
  ASS events (513k lines on 1500 cue); per-field zustand selectors (4Hz tick re-renders the
  tree); split Player overlay from transport (60Hz); translation resume (don't re-pay for
  already-translated chunks); local-model batching (`-np`, trade-off — see below).
- **Reliability/UX (MEDIUM):** retry/backoff for Claude (429/529); confirm/auto-snapshot before
  version restore; don't overwrite an in-progress edit when a background op finishes; cleanup
  children on updater `relaunch()`; cancelled-translation shows a "cancelled X/Y" label not a
  green success; quarantine a corrupt history file; code-signing/notarization (release infra).
- **Product (MEDIUM):** surface translation cost/"paid API" in the UI (TERMS already discloses
  it); MP4 export ETA + optional background mode; preserve word-timings on a typo edit (don't
  re-tokenize when the word count is unchanged); CompareView should pair by `id`, not index.
- **Architectural decisions (pick before building further):** (1) a canonical project format —
  today `words[]`/`speaker`/style survive only in version history; (2) single owner/definition
  of `dirty`; (3) preview==export parity — there are 3 measurement paths (Player CSS, `export_ass`
  Rough was fixed to real metrics, burn); (4) `PlayResX/Y` is hard-coded 1920×1080 — revisit for
  vertical/other aspect ratios (the proxy fixed *playback*, not any subtitle-scaling mismatch).

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

### Inspector styling follow-on (2026-07-22, branch `claude/verify-backlog-changelog-ddbde3`)

Live-feedback pass on the running app (each verified `tsc` + `vitest` + `cargo test`):

- ✅ **Alignment now EXPORTS.** Was preview-only; ass.rs `effective_alignment` maps
  `align` to the numpad Alignment COLUMN (justification) while `boxPosition` drives the
  box REGION. L/C/R letters → alignment icons.
- ✅ **Line-height REMOVED.** No honest ASS/libass mapping the ffmpeg `ass` filter can
  carry (confirmed: only the `ass_set_line_spacing` C-API, not exposed) → dropped the
  control rather than ship a preview-only knob.
- ✅ **Background pill (NEW):** color+alpha / corner radius / spread, text-hugging,
  rounded `\p` drawing on a behind-layer. Sizing MEASURES the text in Rust (ttf-parser,
  own greedy wrap → hard `\N`, WrapStyle 2) — bundled+system fonts via fontdb.
- ✅ **Rich shadow:** angle/distance/size/blur/alpha as an offset behind-layer (replaced
  the single depth). z-order background < shadow < glow < text.
- ✅ **Colors moved into each category** (Text/Outline/Shadow/Glow/Background); the
  separate "Colors" section is gone.
- ✅ **Animation preview-only knobs removed** (`perWordDelayMs`, `easing`) — TS + Rust +
  i18n + tests; all animation TYPES still export.
- ✅ **Outline preview fixed** — 8-direction shadow ring (was 4 corners at w·√2, which
  left the cardinal edges bare and looked "torn").
- ✅ **Background pill vertical hug fixed** — sized to real glyph bounding-box INK
  (first/last line), not the loose font em box, so it no longer "sticks out above the
  text". Verified by burning a test frame and inspecting it. Diacritics stay covered.

Known limits carried forward: pill hug exact for Latin/Cyrillic, APPROXIMATE for complex
scripts/ligatures/emoji/glyph-fallback (documented, accepted); a speaker cue + background
reserves the "[Speaker] " width on line 0 (F2 fix). Still uncommitted-then-committed on
this branch; NOT yet through a real `tauri build` or Windows pass.

### Release-prep pass (2026-07-22)

- ✅ **macOS packaged `tauri build` + burn smoke.** Built `TranscriptPRO.app` (release,
  `--bundles app`; `createUpdaterArtifacts` temporarily off — the updater signing key
  lives only in CI). Verified the bundle: 6 caption TTFs in `Contents/Resources/fonts/`,
  the real ffmpeg sidecar (~50 MB) in `Contents/MacOS/ffmpeg`. Then burned a frame with
  the **bundled** ffmpeg over the **bundled** Outfit font (`fontsdir` → the packaged
  fonts) → Polish text + outline + background band render correctly. So font bundling
  fidelity and `resource_dir()` paths are confirmed in a packaged build (the thing that
  can't be seen in dev). NOTE: `llama-server` sidecar was a 0-byte placeholder for this
  smoke — a real release must ship the built sidecar; local translation was out of scope.
- ✅ **Gemma Terms — draft in-repo.** Added `TERMS.md` (use-restrictions pass-through
  clause for the TranslateGemma model + Whisper/FFmpeg/font component terms) + a `README`
  pointer, marked **DRAFT pending legal review** (the mirror-vs-gated + final ToS wording
  still need a lawyer — see the open item below).

### To take care of (known limitations / follow-ups)

- **DMG/updater packaged build still unverified.** The macOS smoke built only the `.app`
  with updater artifacts OFF; a real release build (`dmg` + `createUpdaterArtifacts: true`,
  signed with the CI key) hasn't been run end-to-end locally. CI does the signed
  build+bundle on every PR, so this is covered there.
- **Windows unverified (runtime).** CI builds + tests Windows green, but nobody has run
  the packaged `.exe` on a real machine: system-font enumeration, burn-in fonts,
  llama-server runtime, and the still-open **Cmd+Q guard** (P2) need a Windows pass.
  `tauri-driver` E2E is Linux/Windows-only (no macOS), so automated end-to-end stays
  CI-only.
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

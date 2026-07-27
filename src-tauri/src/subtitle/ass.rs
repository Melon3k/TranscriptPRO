use super::style::{ass_font_name, CaptionAnimation, CaptionStyle};
use super::types::Subtitle;
use std::path::Path;
use std::sync::OnceLock;

/// Process-wide system font database, enumerated ONCE on first use and shared by
/// `resolve_font_metrics`, the burn-in's `copy_system_family_faces`, and
/// `export_ass`. Loading the system fonts is a tens-to-hundreds-of-ms scan of
/// hundreds of faces; doing it per call (previously twice per export) needlessly
/// blocked the runtime. Font files don't change within a session — the same
/// assumption `list_system_fonts` / the FontPicker already make.
///
/// This caches which font FILES exist at first use; it deliberately does NOT
/// assert a file still exists on disk. Callers that must be truthful about
/// whether a face was actually embedded (the burn's "system" vs "substituted"
/// tag) re-read the file by path, so a font uninstalled mid-session degrades to
/// "substituted" there regardless of this cache — the honesty invariant holds.
pub fn system_fontdb() -> &'static fontdb::Database {
    static DB: OnceLock<fontdb::Database> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

// Reference canvas — matches the Player overlay, which scales fontSize/1080
// (Player.tsx). All CaptionStyle pixel values are defined at this resolution.
const PLAY_RES_X: f64 = 1920.0;
const PLAY_RES_Y: f64 = 1080.0;

/// Resolved caption font bytes for glyph measurement (the text-hugging
/// background pill). Holds the whole font file so a `ttf_parser::Face` can be
/// (re)parsed on demand — `Face<'a>` borrows its data, so we cannot store it
/// directly without a self-referential struct.
///
/// Resolution lives in the callers (they own the resource dir / fontdb); see
/// `resolve_font_metrics`. `write_ass` (pure, no I/O) stays the default entry
/// point; `write_ass_with_metrics` is the sibling that takes the resolved font
/// so the background can be sized. When `None` (or the parse fails), background
/// sizing DEGRADES to a rough average-advance estimate (see `Measurer::Rough`).
pub struct FontMetrics {
    data: Vec<u8>,
    index: u32,
}

impl FontMetrics {
    /// Read a font file and keep its bytes for later `Face` parsing. Returns
    /// `None` on any I/O error (caller degrades to the rough estimate).
    pub fn from_file(path: &Path, index: u32) -> Option<Self> {
        let data = std::fs::read(path).ok()?;
        // Sanity-parse once so a corrupt file degrades now, not mid-measure.
        ttf_parser::Face::parse(&data, index).ok()?;
        Some(FontMetrics { data, index })
    }
}

/// Resolve the caption font for measurement. Bundled families (Outfit / Inter /
/// JetBrains Mono) load their Regular/Bold TTF from `bundled_dir` (the app's
/// `resource_dir()/fonts`, or `src-tauri/fonts` in tests); any other family is
/// looked up on disk via fontdb (same source the picker used), picking the
/// Bold or Regular face per `style.bold`. Returns `None` when nothing resolves
/// — the background then falls back to a rough average-advance estimate.
pub fn resolve_font_metrics(style: &CaptionStyle, bundled_dir: Option<&Path>) -> Option<FontMetrics> {
    let family = style.font_id.trim();
    // Bundled families ship as TTFs we control — a guaranteed exact match.
    let bundled_file = match family {
        "Outfit" => Some(if style.bold { "Outfit-Bold.ttf" } else { "Outfit-Regular.ttf" }),
        "Inter" => Some(if style.bold { "Inter-Bold.ttf" } else { "Inter-Regular.ttf" }),
        "JetBrains Mono" => Some(if style.bold {
            "JetBrainsMono-Bold.ttf"
        } else {
            "JetBrainsMono-Regular.ttf"
        }),
        _ => None,
    };
    if let (Some(name), Some(dir)) = (bundled_file, bundled_dir) {
        if let Some(m) = FontMetrics::from_file(&dir.join(name), 0) {
            return Some(m);
        }
    }

    // System family: locate the installed face via the shared process-wide
    // fontdb (the same enumeration the picker used), matched on family + weight.
    let db = system_fontdb();
    let weight = if style.bold {
        fontdb::Weight::BOLD
    } else {
        fontdb::Weight::NORMAL
    };
    let query = fontdb::Query {
        families: &[fontdb::Family::Name(family)],
        weight,
        ..Default::default()
    };
    let id = db.query(&query)?;
    let info = db.face(id)?;
    let index = info.index;
    match &info.source {
        fontdb::Source::File(p) | fontdb::Source::SharedFile(p, _) => {
            FontMetrics::from_file(p, index)
        }
        // Binary sources (rare) aren't backed by a file path we can re-read;
        // degrade to the rough estimate rather than plumbing the bytes through.
        fontdb::Source::Binary(_) => None,
    }
}

/// Metrics-free convenience wrapper (rough background sizing). Since H6 both the
/// `.ass` export and the MP4 burn resolve real metrics and call
/// `write_ass_with_metrics` directly, so this now has no non-test caller; it's
/// retained as the documented rough-fallback entry point and is exercised by the
/// unit / burn-smoke tests.
#[allow(dead_code)]
pub fn write_ass(subtitles: &[Subtitle], style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    write_ass_with_metrics(subtitles, style, animation, None)
}

/// Like `write_ass`, but with the resolved caption font so the background pill
/// can be sized to the measured text. Background off ⇒ byte-identical to
/// `write_ass` (no measurement, `WrapStyle: 0`, no extra layers).
pub fn write_ass_with_metrics(
    subtitles: &[Subtitle],
    style: &CaptionStyle,
    animation: &CaptionAnimation,
    metrics: Option<&FontMetrics>,
) -> String {
    let mut output = String::new();

    // When the background pill is on we MEASURE the text and wrap it ourselves
    // (hard `\N`), then tell libass NOT to re-wrap (`WrapStyle: 2`) so the lines
    // it renders match the lines we measured — the pill hugs the real text.
    // Background off keeps the historical `WrapStyle: 0` (byte-identical golden
    // output). A `Face` is parsed once here; if it fails, `Measurer::Rough`
    // supplies an average-advance estimate so the pill still draws.
    let face = metrics.and_then(|m| ttf_parser::Face::parse(&m.data, m.index).ok());
    // Positioned per-unit motion (slide/staircase) and karaoke highlight boxes
    // reconstruct the layout from measured advances, so they need a measurer too
    // — not just the background pill.
    let karaoke_boxes =
        animation.anim_type == "karaoke" && matches!(animation.karaoke_highlight.as_str(), "background" | "both");
    let need_measure = style.background
        || wants_positioned_motion(animation)
        || karaoke_boxes
        || animation.anim_type == "decode";
    let measurer = if need_measure {
        match &face {
            Some(f) => Measurer::Real(f),
            None => Measurer::Rough,
        }
    } else {
        Measurer::Rough // unused
    };
    let manual_wrap = style.background;
    let wrap_style = if manual_wrap { 2 } else { 0 };

    output.push_str("[Script Info]\n");
    output.push_str("Title: TranscriptPRO Export\n");
    output.push_str("ScriptType: v4.00+\n");
    output.push_str("Collisions: Normal\n");
    output.push_str("PlayDepth: 0\n");
    output.push_str("PlayResX: 1920\n");
    output.push_str("PlayResY: 1080\n");
    output.push_str(&format!("WrapStyle: {}\n", wrap_style));
    output.push_str("ScaledBorderAndShadow: yes\n\n");

    output.push_str("[V4+ Styles]\n");
    output.push_str("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");
    output.push_str(&style_line(style, animation));
    output.push('\n');

    output.push_str("[Events]\n");
    output.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");

    let (evt_ml, evt_mr, evt_mv) = dialogue_margins(style, animation);
    for sub in subtitles {
        let start = format_ass_timestamp(sub.start_time);
        let end = format_ass_timestamp(sub.end_time);

        // Manual word-wrap into the caption region width, applied to the LOGICAL
        // text (before escaping / animation) so glow, shadow, background and the
        // real text all agree. Skipped when background is off — the cue text is
        // untouched and libass wraps as before.
        let wrapped;
        let sub_ref: &Subtitle = if manual_wrap {
            wrapped = wrap_subtitle(sub, style, &measurer);
            &wrapped
        } else {
            sub
        };

        // Karaoke highlight boxes (background/both): behind-layer rounded rects,
        // one per word, each with its OWN start time (when the word is sung) held
        // to the cue end. Emitted first at Layer 0 so the caption text draws on
        // top of them.
        if karaoke_boxes {
            for (box_start, drawing) in karaoke_box_events(sub_ref, style, animation, &measurer) {
                output.push_str(&format!(
                    "Dialogue: 0,{},{},Default,,{},{},{},,{}\n",
                    format_ass_timestamp(box_start),
                    end,
                    evt_ml,
                    evt_mr,
                    evt_mv,
                    drawing
                ));
            }
        }

        // Z-ORDER: layers render low→high (behind→front). Assign incrementally in
        // the order background < shadow < glow < text, so a cue with no
        // decorations keeps the real text at Layer 0 (byte-identical golden
        // output) and a glow-only cue keeps glow=0/text=1 (unchanged).
        let mut layer = 0u32;
        let mut emit = |out: &mut String, text: String| {
            out.push_str(&format!(
                "Dialogue: {},{},{},Default,,{},{},{},,{}\n",
                layer, start, end, evt_ml, evt_mr, evt_mv, text
            ));
            layer += 1;
        };

        if style.background {
            let bg = background_text(sub_ref, style, animation, &measurer);
            emit(&mut output, bg);
        }
        if style.shadow {
            let sh = shadow_text(sub_ref, style, animation);
            emit(&mut output, sh);
        }
        if style.glow {
            let gl = glow_text(sub_ref, style, animation);
            emit(&mut output, gl);
        }
        // decode: positioned per-character scramble → settled events, each with
        // its own time window. Emitted above any decoration (fixed high layer)
        // since it IS the caption text. Falls back to the inline form if there's
        // nothing to place.
        if animation.anim_type == "decode" {
            let events = positioned_decode_events(sub_ref, style, animation, &measurer);
            if events.is_empty() {
                emit(&mut output, dialogue_text(sub_ref, style, animation));
            } else {
                for (s, e, text) in events {
                    output.push_str(&format!(
                        "Dialogue: 5,{},{},Default,,{},{},{},,{}\n",
                        format_ass_timestamp(s),
                        format_ass_timestamp(e),
                        evt_ml,
                        evt_mr,
                        evt_mv,
                        text
                    ));
                }
            }
        }
        // Positioned per-unit motion (slide/staircase): one \move event per unit,
        // replacing the single caption line. Falls back to the inline whole-line
        // form when there's no visible text to place.
        else if wants_positioned_motion(animation) {
            let events = positioned_motion_events(sub_ref, style, animation, &measurer);
            if events.is_empty() {
                emit(&mut output, dialogue_text(sub_ref, style, animation));
            } else {
                for ev in events {
                    emit(&mut output, ev);
                }
            }
        } else {
            emit(&mut output, dialogue_text(sub_ref, style, animation));
        }
    }

    output
}

/// Blur-entrance start radius. libass `\blur` on a thick bold fill reads as a
/// faint edge halo, not a defocus — radius 8 was invisible on large captions;
/// 24 reads clearly as an entrance blur that resolves to 0.
const BLUR_ENTRANCE_RADIUS: i64 = 24;

/// Per-cue Dialogue MarginL/MarginR/MarginV.
///
/// For types that emit a `\move`/`\pos` (slide, staircase, blurDrop, and blur
/// with a left/right direction) this returns the box margins; for every other
/// type it is `0,0,0` (inherit the Style margins). libass treats a `\move`/`\pos`
/// event with 0 event-margins as full-frame width for line wrapping (it stops
/// inheriting the Style MarginL/R), so such a cue would wrap wider than every
/// other type. Emitting the box margins explicitly pins the wrap box back to the
/// configured width; the `\move` coordinates still drive the final position.
fn uses_positional_move(animation: &CaptionAnimation) -> bool {
    match animation.anim_type.as_str() {
        "slide" | "staircase" | "blurDrop" => true,
        "blur" => matches!(animation.direction.as_str(), "left" | "right"),
        _ => false,
    }
}

fn dialogue_margins(style: &CaptionStyle, animation: &CaptionAnimation) -> (i64, i64, i64) {
    if uses_positional_move(animation) {
        box_margins(style)
    } else {
        (0, 0, 0)
    }
}

/// Build the Dialogue text payload for one cue, applying the animation.
///
/// The base body is always produced exactly as before: escape literal braces
/// (renderers would otherwise parse `{...}` as an override-tag block), convert
/// newlines to `\N`, add the optional `[Speaker]` prefix, and Unicode-uppercase
/// when `style.uppercase` is set. Then per animation type:
///   - `fade`      → prefix `{\fad(d,d)}` (in+out ms; ASS \fad is linear).
///   - `karaoke`   → rebuild the body as `{\k<cs>}<token>` tokens with the
///                   speaker prefix (if any) kept as leading plain text. Uses
///                   real word timings when present, else an even centisecond
///                   split of the raw cue text on whitespace (newlines
///                   included, so they act as token boundaries) — mirroring the
///                   frontend karaokeSegments fallback (`sub.text.split(/\s+/)`)
///                   so preview and export agree.
///   - `pop`       → prefix `{\fscx0\fscy0\t(0,d,\fscx100\fscy100)}` (scale-in).
///   - `blur`      → prefix `{\blur24\t(0,d,\blur0)}` (resolve from blurred).
///   - `slide`     → prefix `{\an<a>\move(x,y1,x,y,0,d)}` rising into the rest
///                   anchor (see `dialogue_margins` for the wrap-box pinning).
///   - `typewriter`→ per-character staggered `\alpha` reveal over `d` ms.
///   - `none`      → plain body.
/// Every branch other than `none`/`karaoke` builds on `plain()` (the escaped,
/// newline-converted, optionally speaker-prefixed body).
fn dialogue_text(sub: &Subtitle, style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    let maybe_upper = |s: String| -> String { maybe_uppercase(s, style) };

    // Base body without the speaker prefix (braces escaped, \n -> \N).
    let body = escaped_body(sub, style);
    // Speaker prefix "[Speaker] " (with trailing space), escaped + uppercased
    // the same way, kept separate so karaoke can lead with it as plain text.
    let speaker_prefix = speaker_prefix(sub, style);

    let plain = || match &speaker_prefix {
        Some(p) => format!("{}{}", p, body),
        None => body.clone(),
    };

    match animation.anim_type.as_str() {
        "fade" => format!("{}{}", animation_prefix(style, animation).unwrap_or_default(), plain()),
        "karaoke" => {
            // "background" mode highlights via per-word boxes (emitted separately
            // in write_ass), so the caption text itself stays plain — no \k sweep.
            if animation.karaoke_highlight == "background" {
                return plain();
            }
            // (centiseconds, token-text) pairs.
            let tokens: Vec<(i64, String)> = if !sub.words.is_empty() {
                sub.words
                    .iter()
                    .map(|w| {
                        let dur_ms = w.end_time.saturating_sub(w.start_time);
                        let cs = ((dur_ms as f64) / 10.0).round() as i64;
                        (cs.max(0), maybe_upper(escape_braces(&w.text)))
                    })
                    .collect()
            } else {
                // Split the RAW cue text (not `body`, whose newlines are already
                // the literal two-char `\N`): `split_whitespace` treats real
                // newlines/tabs/spaces as boundaries, matching the frontend's
                // `sub.text.split(/\s+/)`. Braces are escaped and uppercase is
                // applied per token, as in the word-timings branch above.
                let toks: Vec<&str> = sub.text.split_whitespace().collect();
                let n = toks.len() as i64;
                if n == 0 {
                    return speaker_prefix.unwrap_or_default().trim_end().to_string();
                }
                // Distribute the cue duration (centiseconds) evenly across
                // tokens; the remainder goes to the leading tokens so the \k
                // durations sum to exactly round((end-start)/10).
                let total_cs =
                    (((sub.end_time.saturating_sub(sub.start_time)) as f64) / 10.0).round() as i64;
                let total_cs = total_cs.max(0);
                let base = total_cs / n;
                let rem = total_cs % n;
                toks.iter()
                    .enumerate()
                    .map(|(i, tk)| {
                        let cs = base + if (i as i64) < rem { 1 } else { 0 };
                        (cs.max(0), maybe_upper(escape_braces(tk)))
                    })
                    .collect()
            };

            let mut out = speaker_prefix.unwrap_or_default();
            for (cs, tok) in &tokens {
                out.push_str(&format!("{{\\k{}}}{} ", cs, tok));
            }
            out.trim_end().to_string()
        }
        // Whole-line entrance tags (position/blur/color) then the plain body.
        "blur" | "blurDrop" => {
            format!("{}{}", animation_prefix(style, animation).unwrap_or_default(), plain())
        }
        // Per-unit scale-in cascade: each unit starts at scale 0 and pops to 100
        // over durationMs, staggered by staggerMs. Layout-safe (\fscx doesn't
        // reflow neighbours). `line` units are rejoined with \N.
        "scale" => {
            let d = animation.duration_ms.round().max(0.0) as i64;
            let step = animation.stagger_ms.round().max(0.0) as i64;
            let g = animation.granularity.as_str();
            let units = animation_units(sub, style, g);
            let sep = if g == "line" { "\\N" } else { "" };
            let body = units
                .iter()
                .enumerate()
                .map(|(i, u)| {
                    let t0 = (i as i64) * step;
                    format!(
                        "{{\\fscx0\\fscy0\\t({},{},\\fscx100\\fscy100)}}{}",
                        t0,
                        t0 + d,
                        u
                    )
                })
                .collect::<Vec<_>>()
                .join(sep);
            format!("{}{}", speaker_prefix.unwrap_or_default(), body)
        }
        // slide / staircase: a whole-line directional \move (from animation_prefix)
        // plus a per-unit \alpha cascade so units resolve in sequence. True
        // per-unit translation isn't expressible inline in libass, so the motion
        // is the shared line drift + staggered reveal (approximate, but burns).
        "slide" | "staircase" => {
            let d = animation.duration_ms.round().max(0.0) as i64;
            let step = animation.stagger_ms.round().max(0.0) as i64;
            let g = animation.granularity.as_str();
            let units = animation_units(sub, style, g);
            let sep = if g == "line" { "\\N" } else { "" };
            let move_prefix = animation_prefix(style, animation).unwrap_or_default();
            let body = units
                .iter()
                .enumerate()
                .map(|(i, u)| {
                    let t0 = (i as i64) * step;
                    format!("{{\\alpha&HFF&\\t({},{},\\alpha&H00&)}}{}", t0, t0 + d, u)
                })
                .collect::<Vec<_>>()
                .join(sep);
            format!("{}{}{}", move_prefix, speaker_prefix.unwrap_or_default(), body)
        }
        // colorShift: sweep the fill colour to the accent by mid-entrance, then
        // back to the base text colour. \1c takes BGR (the last 6 hex of the
        // &HAABBGGRR conversion).
        "colorShift" => {
            let d = animation.duration_ms.round().max(0.0) as i64;
            let half = d / 2;
            let accent = hex_to_ass_color(&animation.highlight_color, "22D3EE");
            let text = hex_to_ass_color(&style.text_color, "FFFFFF");
            let accent_bgr = &accent[4..];
            let text_bgr = &text[4..];
            format!(
                "{{\\t(0,{},\\1c&H{}&)\\t({},{},\\1c&H{}&)}}{}",
                half,
                accent_bgr,
                half,
                d,
                text_bgr,
                plain()
            )
        }
        // decode: burn-safe "shuffle" — per-char \alpha reveal in a stable random
        // order (hash-seeded by cue id, matching the preview), each char resolving
        // over durationMs once its ranked window opens.
        "decode" => {
            let d = animation.duration_ms.round().max(0.0) as i64;
            let step = animation.stagger_ms.round().max(1.0) as i64;
            let raw = maybe_upper(sub.text.clone());
            let chars: Vec<char> = raw.chars().collect();
            let ranks = decode_ranks(&sub.id, chars.len());
            let mut out = speaker_prefix.unwrap_or_default();
            for (i, c) in chars.iter().enumerate() {
                if *c == '\n' {
                    out.push_str("\\N");
                    continue;
                }
                let t0 = (ranks[i] as i64) * step;
                out.push_str(&format!(
                    "{{\\alpha&HFF&\\t({},{},\\alpha&H00&)}}{}",
                    t0,
                    t0 + d,
                    escape_braces(&c.to_string())
                ));
            }
            out
        }
        "typewriter" => {
            // Per-character staggered \alpha reveal, left-to-right. Each logical
            // char is hidden (\alpha&HFF&) until its own time window, then \t
            // reveals it (\alpha&H00&).
            //
            // Units are built from the RAW cue text (not the pre-escaped `body`):
            // a real newline becomes a plain "\N" that still consumes one reveal
            // step, and every other char is brace-escaped individually so a
            // literal "{"/"}" stays a single "\{"/"\}" reveal unit. Parsing the
            // already-escaped `body` instead would split the escape pair "\{" into
            // a stray "\" unit and a raw "{" unit — the raw "{" would immediately
            // follow a "}" (…"}{"), re-opening an ASS override block and dropping
            // the character. It would also misread a literal "\N" in source text
            // (e.g. "C:\Name") as a newline. Working from the raw text avoids both.
            let d = animation.duration_ms.round().max(0.0) as i64;
            let prefix = speaker_prefix.clone().unwrap_or_default();

            // (is_newline, escaped_text) reveal units from the maybe-uppercased
            // raw text. Uppercase is applied to the whole string first (so
            // multi-char foldings like ß→SS are correct), then escaping per char.
            let raw = maybe_upper(sub.text.clone());
            let units: Vec<(bool, String)> = raw
                .chars()
                .map(|c| {
                    if c == '\n' {
                        (true, String::new())
                    } else {
                        (false, escape_braces(&c.to_string()))
                    }
                })
                .collect();
            let n = units.len() as i64;
            if n == 0 {
                return plain();
            }
            let mut out = prefix;
            for (idx, (is_newline, unit)) in units.iter().enumerate() {
                if *is_newline {
                    out.push_str("\\N");
                } else {
                    let t1 = ((idx as f64) * (d as f64) / (n as f64)).round() as i64;
                    let t2 = (((idx as f64) + 1.0) * (d as f64) / (n as f64)).round() as i64;
                    out.push_str(&format!(
                        "{{\\alpha&HFF&\\t({},{},\\alpha&H00&)}}{}",
                        t1, t2, unit
                    ));
                }
            }
            out
        }
        // none — preview-only / transform-free, plain body.
        _ => plain(),
    }
}

/// Unicode-uppercase `s` when `style.uppercase` is set, else pass through.
/// Applied to the whole string first so multi-char foldings (ß→SS) are correct.
fn maybe_uppercase(s: String, style: &CaptionStyle) -> String {
    if style.uppercase {
        s.to_uppercase()
    } else {
        s
    }
}

/// The escaped, newline-converted, maybe-uppercased cue body WITHOUT the speaker
/// prefix (braces escaped, `\n` -> `\N`).
fn escaped_body(sub: &Subtitle, style: &CaptionStyle) -> String {
    maybe_uppercase(escape_braces(&sub.text).replace('\n', "\\N"), style)
}

/// The `[Speaker] ` prefix (trailing space), escaped + uppercased the same way,
/// or `None` when the cue has no speaker.
fn speaker_prefix(sub: &Subtitle, style: &CaptionStyle) -> Option<String> {
    sub.speaker
        .as_ref()
        .map(|sp| maybe_uppercase(format!("[{}] ", escape_braces(sp)), style))
}

/// The plain whole-text body (speaker prefix + escaped body), with no
/// per-token/per-char animation splitting.
fn plain_body(sub: &Subtitle, style: &CaptionStyle) -> String {
    match speaker_prefix(sub, style) {
        Some(p) => format!("{}{}", p, escaped_body(sub, style)),
        None => escaped_body(sub, style),
    }
}

/// Split raw cue text into the units that animate as one staggered step,
/// mirroring the frontend `splitUnits` in Player.tsx so preview and export
/// agree. Word/sentence tokens keep their trailing whitespace so inter-token
/// spacing survives; each unit is then brace-escaped and its `\n` → `\N`.
/// (`line` units carry no `\N`; the caller rejoins them with `\N`.)
fn animation_units(sub: &Subtitle, style: &CaptionStyle, granularity: &str) -> Vec<String> {
    let raw = maybe_uppercase(sub.text.clone(), style);
    let units: Vec<String> = match granularity {
        "char" => raw.chars().map(|c| c.to_string()).collect(),
        "line" => raw.split('\n').map(|s| s.to_string()).collect(),
        "sentence" => split_sentences(&raw),
        // "word" (default): runs of non-whitespace + trailing whitespace.
        _ => split_words(&raw),
    };
    units
        .into_iter()
        .map(|u| escape_braces(&u).replace('\n', "\\N"))
        .collect()
}

/// `\S+\s*` tokeniser: each token is one word plus the whitespace that follows
/// it; leading whitespace before the first word is dropped (matches the regex).
fn split_words(s: &str) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        while i < n && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= n {
            break;
        }
        let start = i;
        while i < n && !chars[i].is_whitespace() {
            i += 1;
        }
        while i < n && chars[i].is_whitespace() {
            i += 1;
        }
        out.push(chars[start..i].iter().collect());
    }
    if out.is_empty() {
        out.push(s.to_string());
    }
    out
}

/// `[^.!?]+[.!?]*\s*` tokeniser: text up to and including a run of sentence
/// terminators plus trailing whitespace.
fn split_sentences(s: &str) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        let start = i;
        while i < n && !matches!(chars[i], '.' | '!' | '?') {
            i += 1;
        }
        while i < n && matches!(chars[i], '.' | '!' | '?') {
            i += 1;
        }
        while i < n && chars[i].is_whitespace() {
            i += 1;
        }
        if i > start {
            out.push(chars[start..i].iter().collect());
        } else {
            break;
        }
    }
    if out.is_empty() {
        out.push(s.to_string());
    }
    out
}

/// FNV-1a 32-bit hash, mirroring the frontend `hashStr` (Player.tsx) so the
/// `decode` scramble order matches the preview for a given cue id.
fn hash_str(s: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for c in s.chars() {
        h ^= c as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

/// Stable per-cue reveal RANK for each char index of a `decode` cue: sort the
/// indices by `hash(id:i)` (stable), then invert to per-index rank. Identical
/// ordering to the frontend `decodeRanks`.
fn decode_ranks(id: &str, n: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| hash_str(&format!("{}:{}", id, i)));
    let mut rank = vec![0usize; n];
    for (pos, &ci) in order.iter().enumerate() {
        rank[ci] = pos;
    }
    rank
}

/// Vertical entrance travel (px) for slide/staircase/blurDrop `\move`, and
/// horizontal travel for blur left/right — both derived from the font size so
/// the motion scales with the caption.
fn move_off_v(style: &CaptionStyle) -> i64 {
    style.font_size.round().max(24.0) as i64
}
fn move_off_h(style: &CaptionStyle) -> i64 {
    (style.font_size.round().max(24.0) as i64) * 3
}

/// The shared positional/entrance animation override block that leads a line,
/// for the types that express as a single leading `{...}` block. Both the real
/// caption line and the glow line prepend this so the halo stays locked to the
/// moving/scaling text. Returns `None` for `karaoke` (interleaves `\k` per
/// token), `typewriter` (interleaves `\alpha` per char) and `none` — none of
/// which have a single shareable prefix.
///   - `fade`  → `{\fad(d,d)}` (in+out ms; ASS \fad is linear).
///   - `pop`   → `{\fscx0\fscy0\t(0,d,\fscx100\fscy100)}` (scale-in). No \org —
///               in libass \org only relocates the ROTATION origin, not the
///               scale origin; the line's Alignment point is the scale anchor.
///   - `blur`  → `{\blur24\t(0,d,\blur0)}` (resolve from blurred to sharp).
///   - `slide` → `{\an<a>\move(x,y1,x,y,0,d)}` rising one line-height into the
///               rest anchor. \move (like \pos) makes libass ignore the Style
///               MarginL/R, but the computed x reproduces them (see
///               `dialogue_margins` for the wrap-box pinning).
fn animation_prefix(style: &CaptionStyle, animation: &CaptionAnimation) -> Option<String> {
    let d = animation.duration_ms.round().max(0.0) as i64;
    match animation.anim_type.as_str() {
        "fade" => Some(format!("{{\\fad({},{})}}", d, d)),
        // scale reuses the old pop scale-in as the WHOLE-LINE approximation for
        // shadow/glow; the real caption line does the per-unit stagger itself.
        "scale" => Some(format!("{{\\fscx0\\fscy0\\t(0,{},\\fscx100\\fscy100)}}", d)),
        "blur" => match animation.direction.as_str() {
            // Motion-blur in from the left/right edge: horizontal \move + deblur.
            "left" | "right" => {
                let (x, y, an) = anchor_point(style);
                let off = move_off_h(style);
                let x1 = if animation.direction == "left" { x - off } else { x + off };
                Some(format!(
                    "{{\\an{}\\move({},{},{},{},0,{})\\blur{}\\t(0,{},\\blur0)}}",
                    an, x1, y, x, y, d, BLUR_ENTRANCE_RADIUS, d
                ))
            }
            _ => Some(format!("{{\\blur{}\\t(0,{},\\blur0)}}", BLUR_ENTRANCE_RADIUS, d)),
        },
        // blurDrop: whole-line drop from the top ("up") or rise from the bottom
        // ("down"), deblurring on the way in.
        "blurDrop" => {
            let (x, y, an) = anchor_point(style);
            let off = move_off_v(style);
            let y1 = if animation.direction == "down" { y + off } else { y - off };
            Some(format!(
                "{{\\an{}\\move({},{},{},{},0,{})\\blur{}\\t(0,{},\\blur0)}}",
                an, x, y1, x, y, d, BLUR_ENTRANCE_RADIUS, d
            ))
        }
        // slide always rises up from one travel-step below the rest anchor.
        "slide" => {
            let (x, y, an) = anchor_point(style);
            let y1 = y + move_off_v(style);
            Some(format!("{{\\an{}\\move({},{},{},{},0,{})}}", an, x, y1, x, y, d))
        }
        // staircase: whole-line directional drift; the per-unit \alpha cascade
        // (added in dialogue_text) makes it read as a stepping reveal.
        "staircase" => {
            let (x, y, an) = anchor_point(style);
            let off = move_off_v(style);
            let y1 = if animation.direction == "down" { y + off } else { y - off };
            Some(format!("{{\\an{}\\move({},{},{},{},0,{})}}", an, x, y1, x, y, d))
        }
        // colorShift / decode / typewriter / karaoke / none have no single
        // shareable positional prefix.
        _ => None,
    }
}

/// The glow override block painted on the BEHIND (Layer 0) line: the letter
/// SHAPES filled in the glow colour, with NO border and NO shadow, then blurred
/// — so a soft coloured halo bleeds out from behind the real caption. This
/// mirrors the in-app preview, whose CSS glow is `text-shadow: 0 0 <strength>
/// glowColor` (a blurred copy of the glyphs, not an outline). An earlier
/// border-based version (`\bord`+`\blur`) read as a chunky rounded ring/slab on
/// bold, tightly-spaced multi-line captions — the fill-shape blur is the softer,
/// correct glow. `glow_strength` drives the blur radius `\blur` (clamp 4..=40).
/// The glow colour goes through the same hex→ASS `&HAABBGGRR` conversion; its
/// alpha byte is folded into the fill alpha `\1a` and the BGR into `\1c`.
///
/// When the animation type is `blur`, its own `\blur`/`\t(...,\blur0)` already
/// drives the line's blur; emitting the glow's static `\blur<r>` too would
/// double-apply the tag, so we omit the glow's static blur in that one case and
/// let the animation drive it.
fn glow_prefix(style: &CaptionStyle, anim_is_blur: bool) -> String {
    // "&HAABBGGRR" — always "&H" + 8 hex digits (valid parse or 6-digit
    // fallback), so the byte slices below are always in range.
    let ass = hex_to_ass_color(&style.glow_color, "22D3EE");
    let hexpart = &ass[2..]; // "AABBGGRR"
    let alpha = &hexpart[0..2]; // "AA"
    let bgr = &hexpart[2..]; // "BBGGRR"
    let r = style.glow_strength.round().clamp(4.0, 40.0) as i64;
    if anim_is_blur {
        format!("{{\\bord0\\shad0\\1c&H{}&\\1a&H{}&}}", bgr, alpha)
    } else {
        format!("{{\\bord0\\shad0\\1c&H{}&\\1a&H{}&\\blur{}}}", bgr, alpha, r)
    }
}

/// Build the BEHIND glow line's Dialogue text: the shared entrance/position
/// animation prefix (so the halo tracks the moving text), then the glow
/// override block, then the plain whole-text body (no karaoke `\k` / typewriter
/// `\alpha` splitting — the halo is whole-text).
fn glow_text(sub: &Subtitle, style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    let anim = animation_prefix(style, animation).unwrap_or_default();
    let glow = glow_prefix(style, animation.anim_type == "blur");
    format!("{}{}{}", anim, glow, plain_body(sub, style))
}

/// Text measurer for background-pill sizing. `Real` reads ttf-parser glyph
/// advances + hhea vertical metrics; `Rough` is the graceful fallback used when
/// no caption font could be resolved/parsed — an average advance (≈ 0.5 em) and
/// line height (≈ 1.2 em) — so the pill still draws instead of panicking or
/// dropping the cue.
///
/// ACCEPTED CAVEATS (explicitly approved best-effort): exact for Latin/Cyrillic;
/// only APPROXIMATE for complex scripts (Arabic/Indic shaping), ligatures, emoji
/// and glyph fallback — if the font lacks a glyph, libass substitutes a
/// different face whose advance differs from the one measured here, so the pill
/// width can be slightly off. This was signed off as acceptable.
enum Measurer<'a> {
    Real(&'a ttf_parser::Face<'a>),
    Rough,
}

impl Measurer<'_> {
    /// Horizontal advance of one char in px at `font_size` (no letter-spacing).
    fn char_advance(&self, ch: char, font_size: f64) -> f64 {
        match self {
            Measurer::Real(face) => {
                let upm = face.units_per_em() as f64;
                if upm <= 0.0 {
                    return font_size * 0.5;
                }
                let adv = face
                    .glyph_index(ch)
                    .and_then(|g| face.glyph_hor_advance(g))
                    .map(|a| a as f64)
                    // Missing glyph → libass substitutes; approximate at 0.5 em.
                    .unwrap_or(upm * 0.5);
                adv / upm * font_size
            }
            Measurer::Rough => font_size * 0.5,
        }
    }

    /// Advance of a whole line: Σ char advances + `letter_spacing` per inter-char
    /// gap (mirroring the ASS Spacing field, applied between glyphs).
    fn line_advance(&self, line: &str, font_size: f64, letter_spacing: f64) -> f64 {
        let mut total = 0.0;
        let mut count: i64 = 0;
        for ch in line.chars() {
            total += self.char_advance(ch, font_size);
            count += 1;
        }
        if count > 1 {
            total += letter_spacing * (count - 1) as f64;
        }
        total
    }

    /// Font ascent/descent in px at `font_size` (descent returned POSITIVE).
    /// This is the em-box libass stacks lines by. Prefers OS/2 typographic
    /// metrics, falls back to hhea, then to 0.8/0.2·em.
    fn v_metrics(&self, font_size: f64) -> (f64, f64) {
        match self {
            Measurer::Real(face) => {
                let upm = face.units_per_em() as f64;
                if upm <= 0.0 {
                    return (font_size * 0.8, font_size * 0.2);
                }
                let (asc, desc) =
                    match (face.typographic_ascender(), face.typographic_descender()) {
                        (Some(a), Some(d)) if a as i32 - d as i32 > 0 => (a as f64, d as f64),
                        _ => (face.ascender() as f64, face.descender() as f64),
                    };
                (asc / upm * font_size, -desc / upm * font_size)
            }
            Measurer::Rough => (font_size * 0.8, font_size * 0.2),
        }
    }

    /// One line's em-box height in px — the vertical step libass uses BETWEEN
    /// stacked lines. (Ascent + descent from `v_metrics`.)
    fn line_height(&self, font_size: f64) -> f64 {
        let (a, d) = self.v_metrics(font_size);
        a + d
    }

    /// Actual INK extents of `line` in px at `font_size`: (max glyph top above
    /// baseline, max glyph depth below baseline, both >= 0), from per-glyph
    /// bounding boxes. This is TIGHTER than the em box — the font ascender sits
    /// well above the caps/diacritics, so sizing the background pill to the em
    /// box leaves a big empty band at the top. Measuring real ink (which still
    /// includes accents like ą/ś because they're in the glyph bbox) lets the
    /// pill hug the visible text symmetrically. Falls back to `v_metrics` when
    /// no glyph is measurable (Rough, or a line of only spaces/unknowns).
    fn ink_extents(&self, line: &str, font_size: f64) -> (f64, f64) {
        match self {
            Measurer::Real(face) => {
                let upm = face.units_per_em() as f64;
                if upm <= 0.0 {
                    return self.v_metrics(font_size);
                }
                let mut top = f64::NEG_INFINITY;
                let mut bot = f64::NEG_INFINITY; // tracks max(-y_min)
                for ch in line.chars() {
                    if let Some(bb) = face.glyph_index(ch).and_then(|g| face.glyph_bounding_box(g)) {
                        top = top.max(bb.y_max as f64);
                        bot = bot.max(-(bb.y_min as f64));
                    }
                }
                if !top.is_finite() {
                    return self.v_metrics(font_size);
                }
                (
                    (top.max(0.0)) / upm * font_size,
                    (bot.max(0.0)) / upm * font_size,
                )
            }
            Measurer::Rough => self.v_metrics(font_size),
        }
    }
}

/// The caption region width in px at the 1920 canvas (PlayResX minus the box
/// margins) — the wrap target for the background pill.
fn region_width(style: &CaptionStyle) -> f64 {
    let (ml, mr, _mv) = box_margins(style);
    (PLAY_RES_X - ml as f64 - mr as f64).max(1.0)
}

/// Greedy word-wrap `text` to `max_width` px. Existing newlines are FORCED
/// breaks (each paragraph wraps independently). A single word wider than the
/// region is left on its own overflowing line (no mid-word splitting) — the
/// background still hugs it (best-effort).
///
/// `first_line_reserve` is px already consumed on the VERY FIRST rendered line
/// by a prefix that is prepended later (the "[Speaker] " label): the first
/// line's budget is `max_width - first_line_reserve` so prefix + line-0 words
/// stay inside the box. Every later line uses the full `max_width`.
fn wrap_text(
    text: &str,
    font_size: f64,
    letter_spacing: f64,
    max_width: f64,
    first_line_reserve: f64,
    m: &Measurer,
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    // Consumed once the first line is emitted; only line 0 carries the prefix.
    let mut first_line = true;
    let budget = |first: bool| {
        if first {
            (max_width - first_line_reserve).max(1.0)
        } else {
            max_width
        }
    };
    for paragraph in text.split('\n') {
        let words: Vec<&str> = paragraph.split_whitespace().collect();
        if words.is_empty() {
            out.push(String::new());
            first_line = false;
            continue;
        }
        let mut current = String::new();
        for w in words {
            if current.is_empty() {
                current.push_str(w);
                continue;
            }
            let candidate = format!("{} {}", current, w);
            if m.line_advance(&candidate, font_size, letter_spacing) <= budget(first_line) {
                current = candidate;
            } else {
                out.push(std::mem::take(&mut current));
                first_line = false;
                current.push_str(w);
            }
        }
        if !current.is_empty() {
            out.push(current);
            first_line = false;
        }
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// Re-wrap a cue's text to the caption region width so the rendered lines match
/// the lines we measured for the pill (the caller sets `WrapStyle: 2` so libass
/// honours these hard breaks). Returns a clone with `text` rewrapped; all other
/// fields (words/speaker) are preserved.
fn wrap_subtitle(sub: &Subtitle, style: &CaptionStyle, measurer: &Measurer) -> Subtitle {
    let fs = style.font_size.max(0.0);
    let ls = style.letter_spacing;
    // The "[Speaker] " label is prepended to the first rendered line by
    // `dialogue_text`/`plain_body`, so reserve its measured width when wrapping
    // line 0 — otherwise a speaker cue near the width limit overflows the box on
    // line 1 (and the pill, which measures prefix+line-0, overflows with it).
    // Measured from the RAW "[name] " (no brace-escaping, which would inflate
    // the width); uppercased to match how the prefix actually renders.
    let reserve = sub.speaker.as_ref().map_or(0.0, |sp| {
        let prefix = maybe_uppercase(format!("[{}] ", sp), style);
        measurer.line_advance(&prefix, fs, ls)
    });
    let lines = wrap_text(&sub.text, fs, ls, region_width(style), reserve, measurer);
    Subtitle {
        text: lines.join("\n"),
        ..sub.clone()
    }
}

/// Shadow offset vector (px, rounded) from `shadow_angle`/`shadow_distance`.
/// Screen coords: 0° = +x (right), 90° = +y (down).
fn shadow_offset(style: &CaptionStyle) -> (i64, i64) {
    let theta = style.shadow_angle.to_radians();
    let d = style.shadow_distance;
    let dx = (d * theta.cos()).round() as i64;
    let dy = (d * theta.sin()).round() as i64;
    (dx, dy)
}

/// The BEHIND shadow line: an OFFSET duplicate of the whole cue text, filled in
/// `shadow_color` with its own `\bord`(shadow_size)/`\blur`(shadow_blur) and NO
/// ASS shadow, positioned by `\pos` shifted from the text anchor by
/// `shadow_offset`. Composes with animations like `glow_text`: fade/pop/blur
/// reuse their position-independent entrance tags on top of the offset `\pos`,
/// and `slide` offsets both `\move` endpoints. karaoke/typewriter/none render
/// the static whole-text copy (like glow). Under the blur ENTRANCE animation the
/// shadow's own static `\blur` is omitted so the entrance `\blur` isn't
/// double-applied (matching `glow_prefix`).
fn shadow_text(sub: &Subtitle, style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    let (ax, ay, an) = anchor_point(style);
    let (dx, dy) = shadow_offset(style);
    let sx = ax + dx;
    let sy = ay + dy;

    // "&HAABBGGRR" — always "&H" + 8 hex digits, so these slices are in range.
    let ass = hex_to_ass_color(&style.shadow_color, "000000");
    let hexpart = &ass[2..];
    let alpha = &hexpart[0..2];
    let bgr = &hexpart[2..];
    let size = style.shadow_size.max(0.0);
    let blur = style.shadow_blur.max(0.0);
    // Both blur entrances animate their own \blur in the pos_block, so the
    // static shadow \blur is omitted to avoid double-applying it.
    let anim_has_blur = matches!(animation.anim_type.as_str(), "blur" | "blurDrop");
    let style_block = if anim_has_blur {
        format!("\\bord{}\\shad0\\1c&H{}&\\1a&H{}&", fmt_num(size), bgr, alpha)
    } else {
        format!(
            "\\bord{}\\shad0\\1c&H{}&\\1a&H{}&\\blur{}",
            fmt_num(size),
            bgr,
            alpha,
            fmt_num(blur)
        )
    };

    let d = animation.duration_ms.round().max(0.0) as i64;
    let off_v = move_off_v(style);
    let pos_block = match animation.anim_type.as_str() {
        "slide" => {
            let y1 = sy + off_v;
            format!("\\an{}\\move({},{},{},{},0,{})", an, sx, y1, sx, sy, d)
        }
        // scale/staircase per-unit motion is on the real line; the shadow tracks
        // the whole-line approximation so its halo follows the caption.
        "staircase" => {
            let y1 = if animation.direction == "down" { sy + off_v } else { sy - off_v };
            format!("\\an{}\\move({},{},{},{},0,{})", an, sx, y1, sx, sy, d)
        }
        "blurDrop" => {
            let y1 = if animation.direction == "down" { sy + off_v } else { sy - off_v };
            format!(
                "\\an{}\\move({},{},{},{},0,{})\\blur{}\\t(0,{},\\blur0)",
                an, sx, y1, sx, sy, d, BLUR_ENTRANCE_RADIUS, d
            )
        }
        "fade" => format!("\\an{}\\pos({},{})\\fad({},{})", an, sx, sy, d, d),
        "scale" => format!(
            "\\an{}\\pos({},{})\\fscx0\\fscy0\\t(0,{},\\fscx100\\fscy100)",
            an, sx, sy, d
        ),
        "blur" => match animation.direction.as_str() {
            "left" | "right" => {
                let off = move_off_h(style);
                let x1 = if animation.direction == "left" { sx - off } else { sx + off };
                format!(
                    "\\an{}\\move({},{},{},{},0,{})\\blur{}\\t(0,{},\\blur0)",
                    an, x1, sy, sx, sy, d, BLUR_ENTRANCE_RADIUS, d
                )
            }
            _ => format!(
                "\\an{}\\pos({},{})\\blur{}\\t(0,{},\\blur0)",
                an, sx, sy, BLUR_ENTRANCE_RADIUS, d
            ),
        },
        // colorShift / decode / typewriter / karaoke / none → static copy.
        _ => format!("\\an{}\\pos({},{})", an, sx, sy),
    };

    format!("{{{}{}}}{}", pos_block, style_block, plain_body(sub, style))
}

/// Kappa constant: control-handle length for approximating a quarter circle of
/// radius 1 with a cubic Bézier.
const BEZIER_KAPPA: f64 = 0.5522847498307936;

/// An ASS `\p` vector path for a rounded rectangle: local coords, top-left at
/// (0,0), size `w`×`h`, corner radius `r` (clamped to ≤ min(w,h)/2). The four
/// corners are `b` (cubic Bézier) quarter-circle approximations; edges are `l`.
/// Coordinates are rounded to integers (best-effort; sub-pixel corner error is
/// negligible at caption sizes).
fn rounded_rect_drawing(w: f64, h: f64, r: f64) -> String {
    let r = r.max(0.0).min(w.min(h) / 2.0);
    let f = |v: f64| -> i64 { v.round() as i64 };
    if r <= 0.5 {
        // Degenerate radius → plain rectangle.
        return format!("m 0 0 l {} 0 {} {} 0 {} 0 0", f(w), f(w), f(h), f(h));
    }
    let c = r * BEZIER_KAPPA;
    let r_ = f(r);
    let wr = f(w - r);
    let wrc = f(w - r + c);
    let w_ = f(w);
    let rc = f(r - c);
    let hr = f(h - r);
    let hrc = f(h - r + c);
    let h_ = f(h);
    format!(
        "m {r_} 0 l {wr} 0 b {wrc} 0 {w_} {rc} {w_} {r_} l {w_} {hr} \
         b {w_} {hrc} {wrc} {h_} {wr} {h_} l {r_} {h_} \
         b {rc} {h_} 0 {hrc} 0 {hr} l 0 {r_} b 0 {rc} {rc} 0 {r_} 0"
    )
}

/// The BEHIND background line: a filled rounded-rectangle vector drawing sized
/// to hug the (already-wrapped) cue text. Positioned with `\an7\pos` at the
/// pill's top-left corner (with `\an7` libass aligns the drawing bbox's
/// top-left to `\pos`, and the path's bbox top-left is (0,0) — so local (0,0)
/// lands exactly at the corner). The corner is derived from the text-block bbox
/// (placed by `anchor_point`'s alignment at the anchor) expanded by
/// `background_spread` on all four sides. Fills `\1c`(background_color) +
/// `\1a`(its alpha), `\bord0\shad0`. Fades with the text when the animation is
/// `fade`; other animations leave the pill static (best-effort).
fn background_text(
    sub: &Subtitle,
    style: &CaptionStyle,
    animation: &CaptionAnimation,
    m: &Measurer,
) -> String {
    let fs = style.font_size.max(0.0);
    let ls = style.letter_spacing;

    // `sub` is already wrapped (hard newlines == rendered lines). Measure each
    // line; the first line also carries the "[Speaker] " prefix the real text
    // prepends, so the pill covers it too.
    let prefix = sub
        .speaker
        .as_ref()
        .map(|sp| format!("[{}] ", sp))
        .unwrap_or_default();
    let lines: Vec<&str> = sub.text.split('\n').collect();
    let block_w = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            if i == 0 && !prefix.is_empty() {
                m.line_advance(&format!("{}{}", prefix, l), fs, ls)
            } else {
                m.line_advance(l, fs, ls)
            }
        })
        .fold(0.0_f64, f64::max);
    // Em-box block height (the step libass stacks lines by) — used to place the
    // block relative to the anchor. The visible INK is tighter: the font
    // ascender sits well above the caps and the last line's descent may be
    // shallow, so a pill sized to the em box leaves an empty band (top-heavy —
    // "sticks out above the text"). Trim the em box down to the real ink of the
    // first (top) and last (bottom) rendered lines so the pill hugs the glyphs
    // symmetrically. Accents (ą/ś/…) stay inside because they're in the bbox.
    let block_h = lines.len().max(1) as f64 * m.line_height(fs);
    let (font_asc, font_desc) = m.v_metrics(fs);
    let first_line = match (lines.first(), prefix.is_empty()) {
        (Some(l), false) => format!("{}{}", prefix, l),
        (Some(l), true) => (*l).to_string(),
        (None, _) => String::new(),
    };
    let last_line = lines.last().copied().unwrap_or("");
    let (ink_asc, _) = m.ink_extents(&first_line, fs);
    let (_, ink_desc) = m.ink_extents(last_line, fs);
    let top_trim = (font_asc - ink_asc).max(0.0);
    let bot_trim = (font_desc - ink_desc).max(0.0);
    let ink_h = (block_h - top_trim - bot_trim).max(0.0);

    let (ax, ay, an) = anchor_point(style);
    let spread = style.background_spread.max(0.0);
    let pill_w = block_w + 2.0 * spread;
    let pill_h = ink_h + 2.0 * spread;

    // Text block bbox relative to the anchor, from the numpad alignment.
    let col = (an - 1) % 3; // 0=left 1=center 2=right
    let row = (an - 1) / 3; // 0=bottom 1=middle 2=top
    let text_left = match col {
        0 => ax as f64,
        2 => ax as f64 - block_w,
        _ => ax as f64 - block_w / 2.0,
    };
    // Em-box top per row, then drop to the ink top (skip the empty ascender band).
    let em_top = match row {
        0 => ay as f64 - block_h,
        1 => ay as f64 - block_h / 2.0,
        _ => ay as f64,
    };
    let ink_top = em_top + top_trim;
    let px = (text_left - spread).round() as i64;
    let py = (ink_top - spread).round() as i64;

    let radius = style
        .background_radius
        .max(0.0)
        .min(pill_w.min(pill_h) / 2.0);
    let drawing = rounded_rect_drawing(pill_w, pill_h, radius);

    let ass = hex_to_ass_color(&style.background_color, "000000");
    let hexpart = &ass[2..];
    let alpha = &hexpart[0..2];
    let bgr = &hexpart[2..];

    let fade = if animation.anim_type == "fade" {
        let d = animation.duration_ms.round().max(0.0) as i64;
        format!("\\fad({},{})", d, d)
    } else {
        String::new()
    };

    format!(
        "{{\\an7\\pos({},{})\\bord0\\shad0\\1c&H{}&\\1a&H{}&{}\\p1}}{}",
        px, py, bgr, alpha, fade, drawing
    )
}

// ── Positioned per-unit layout (slide/staircase motion + karaoke boxes) ──────
//
// libass can't translate a sub-span of an auto-laid-out line independently, so
// true per-word/-line motion is emitted as SEPARATE positioned Dialogue events,
// one per unit. To rest exactly where a normal line sits, we reconstruct the
// layout (wrap → per-line justification → per-word advance) from the same
// anchor_point / region / measurer the background pill already uses. Positions
// are exact for Latin/Cyrillic and approximate for complex scripts (the measurer
// caveat) — accepted, matching the pill.

/// One laid-out text run: escaped-later RAW text plus its canvas geometry. Used
/// for both whole lines and individual words (an4 middle-left reference).
struct LaidRun {
    text: String,
    left: f64,
    mid_y: f64,
}

/// Position pre-split lines: per-line left edge from the justification column,
/// vertical middle from the box-position band stacked by line height. Mirrors
/// anchor_point + background_text so a positioned unit rests where libass would
/// draw the normal line.
fn place_lines(lines: &[String], style: &CaptionStyle, m: &Measurer) -> Vec<LaidRun> {
    let fs = style.font_size.max(0.0);
    let ls = style.letter_spacing;
    let (ax, ay, an) = anchor_point(style);
    let acol = (an - 1) % 3; // 0=left 1=center 2=right
    let row = (an - 1) / 3; // 0=bottom 1=middle 2=top
    let lh = m.line_height(fs);
    let n = lines.len().max(1) as f64;
    let block_h = n * lh;
    let block_top = match row {
        0 => ay as f64 - block_h,
        1 => ay as f64 - block_h / 2.0,
        _ => ay as f64,
    };
    lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let width = m.line_advance(line, fs, ls);
            let left = match acol {
                0 => ax as f64,
                2 => ax as f64 - width,
                _ => ax as f64 - width / 2.0,
            };
            LaidRun {
                text: line.clone(),
                left,
                mid_y: block_top + (i as f64 + 0.5) * lh,
            }
        })
        .collect()
}

/// Wrap the (uppercased) cue text to the region — speaker prefix on line 0 — and
/// position the resulting lines.
fn wrap_and_place(sub: &Subtitle, style: &CaptionStyle, m: &Measurer) -> Vec<LaidRun> {
    let fs = style.font_size.max(0.0);
    let ls = style.letter_spacing;
    let text = maybe_uppercase(sub.text.clone(), style);
    let prefix = sub
        .speaker
        .as_ref()
        .map(|sp| maybe_uppercase(format!("[{}] ", sp), style))
        .unwrap_or_default();
    let reserve = if prefix.is_empty() {
        0.0
    } else {
        m.line_advance(&prefix, fs, ls)
    };
    let mut lines = wrap_text(&text, fs, ls, region_width(style), reserve, m);
    if lines.is_empty() {
        lines.push(String::new());
    }
    if !prefix.is_empty() {
        lines[0] = format!("{}{}", prefix, lines[0]);
    }
    place_lines(&lines, style, m)
}

/// Per-word runs within a placed line: each word's left edge is the line left
/// plus the advance of everything before it (measured, so no cumulative drift).
fn words_in_line(line: &LaidRun, style: &CaptionStyle, m: &Measurer) -> Vec<LaidRun> {
    let fs = style.font_size.max(0.0);
    let ls = style.letter_spacing;
    let mut acc = String::new();
    let mut out = Vec::new();
    for w in split_words(&line.text) {
        let left = if acc.is_empty() {
            line.left
        } else {
            line.left + m.line_advance(&acc, fs, ls) + ls
        };
        out.push(LaidRun {
            left,
            mid_y: line.mid_y,
            text: w.clone(),
        });
        acc.push_str(&w);
    }
    out
}

/// The laid-out units for a motion type's granularity: whole lines, per-word
/// runs (flattened across wrapped lines), or one sentence per stacked row.
fn motion_units(sub: &Subtitle, style: &CaptionStyle, granularity: &str, m: &Measurer) -> Vec<LaidRun> {
    match granularity {
        "line" => wrap_and_place(sub, style, m),
        "sentence" => {
            let text = maybe_uppercase(sub.text.clone(), style);
            place_lines(&split_sentences(&text), style, m)
        }
        // "word" (default)
        _ => wrap_and_place(sub, style, m)
            .iter()
            .flat_map(|l| words_in_line(l, style, m))
            .collect(),
    }
}

/// slide / staircase as positioned per-unit `\move` events (one Dialogue payload
/// per unit). Each unit enters from a directional offset with per-unit stagger
/// and rests at its laid-out position. Empty when the cue has no visible text
/// (the caller then falls back to the inline whole-line form).
fn positioned_motion_events(
    sub: &Subtitle,
    style: &CaptionStyle,
    animation: &CaptionAnimation,
    m: &Measurer,
) -> Vec<String> {
    let d = animation.duration_ms.round().max(0.0) as i64;
    let step = animation.stagger_ms.round().max(0.0) as i64;
    let off = move_off_v(style);
    let units = motion_units(sub, style, animation.granularity.as_str(), m);
    // slide always rises from below; staircase honours direction (up = from top).
    let from_top = animation.anim_type == "staircase" && animation.direction != "down";
    units
        .iter()
        .filter(|u| !u.text.trim().is_empty())
        .enumerate()
        .map(|(i, u)| {
            let t1 = (i as i64) * step;
            let t2 = t1 + d;
            let wx = u.left.round() as i64;
            let wy = u.mid_y.round() as i64;
            let sy = if from_top { wy - off } else { wy + off };
            let esc = escape_braces(&u.text).replace('\n', "\\N");
            format!(
                "{{\\an4\\move({},{},{},{},{},{})\\alpha&HFF&\\t({},{},\\alpha&H00&)}}{}",
                wx, sy, wx, wy, t1, t2, t1, t2, esc
            )
        })
        .collect()
}

/// Whether this cue+animation should emit positioned per-unit motion events
/// (instead of the inline whole-line form) — requires a resolved measurer.
fn wants_positioned_motion(animation: &CaptionAnimation) -> bool {
    matches!(animation.anim_type.as_str(), "slide" | "staircase")
}

/// Glyph pool for the `decode` scramble (ASCII only, so libass never has to
/// substitute a face mid-scramble). Mirrors the preview's DECODE_GLYPHS.
const DECODE_GLYPHS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*<>/\\";
/// Milliseconds each scramble glyph is shown before flipping.
const DECODE_GLYPH_MS: i64 = 45;
/// Cap on scramble glyph events per character (keeps the .ass bounded).
const DECODE_MAX_FRAMES: i64 = 8;

/// Per-character runs within a placed line (cumulative advance per char).
fn chars_in_line(line: &LaidRun, style: &CaptionStyle, m: &Measurer) -> Vec<LaidRun> {
    let fs = style.font_size.max(0.0);
    let ls = style.letter_spacing;
    let mut acc = String::new();
    let mut out = Vec::new();
    for ch in line.text.chars() {
        let left = if acc.is_empty() {
            line.left
        } else {
            line.left + m.line_advance(&acc, fs, ls) + ls
        };
        out.push(LaidRun {
            left,
            mid_y: line.mid_y,
            text: ch.to_string(),
        });
        acc.push(ch);
    }
    out
}

/// `decode` as positioned per-character events: each printable char cycles a few
/// random glyphs during its scramble window, then a settled event holds the real
/// char to the cue end. Left-to-right: char `gi` starts at `gi * staggerMs`.
/// Returns (start_ms, end_ms, payload) — each glyph frame has its own window, so
/// these can't share the cue's fixed timing. Deterministic glyphs (hash-keyed by
/// cue id, char index, frame) mirror the preview. Empty when no visible chars.
fn positioned_decode_events(
    sub: &Subtitle,
    style: &CaptionStyle,
    animation: &CaptionAnimation,
    m: &Measurer,
) -> Vec<(u64, u64, String)> {
    let step = animation.stagger_ms.round().max(1.0) as i64;
    let scramble = animation.duration_ms.round().max(0.0) as i64;
    let n_glyphs = DECODE_GLYPHS.chars().count();
    let cue_end = sub.end_time;
    let mut out = Vec::new();
    let mut gi: i64 = 0; // global char index (spaces/line breaks consume a step)
    for line in wrap_and_place(sub, style, m) {
        for cr in chars_in_line(&line, style, m) {
            let ch = cr.text.chars().next().unwrap_or(' ');
            if ch.is_whitespace() {
                gi += 1;
                continue;
            }
            let x = cr.left.round() as i64;
            let y = cr.mid_y.round() as i64;
            let start = gi * step;
            let settle = start + scramble;
            // Scramble frames spanning the WHOLE window (bounded count): the last
            // frame holds to `settle` so there's no blank gap before the char
            // resolves. glyph_ms stretches when the cap would leave a hole.
            let frames = (scramble / DECODE_GLYPH_MS).clamp(1, DECODE_MAX_FRAMES);
            let glyph_ms = (scramble / frames).max(1);
            for f in 0..frames {
                let fs_ms = start + f * glyph_ms;
                let fe_ms = if f == frames - 1 { settle } else { start + (f + 1) * glyph_ms };
                let s = sub.start_time.saturating_add(fs_ms.max(0) as u64);
                let e = sub.start_time.saturating_add(fe_ms.max(0) as u64).min(cue_end);
                if e <= s {
                    break;
                }
                let idx = (hash_str(&format!("{}:{}:{}", sub.id, gi, f)) as usize) % n_glyphs.max(1);
                let g = DECODE_GLYPHS.chars().nth(idx).unwrap_or('#');
                out.push((s, e, format!("{{\\an4\\pos({},{})}}{}", x, y, escape_braces(&g.to_string()))));
            }
            // Settled real character, held to the cue end.
            let s = sub.start_time.saturating_add(settle.max(0) as u64).min(cue_end);
            if s < cue_end {
                out.push((s, cue_end, format!("{{\\an4\\pos({},{})}}{}", x, y, escape_braces(&cr.text))));
            }
            gi += 1;
        }
        gi += 1; // the line break between wrapped lines consumes a step too
    }
    out
}

/// Per-whitespace-token centisecond durations for karaoke — word timings when
/// present, else the even cue-duration split — matching `dialogue_text`.
fn karaoke_token_cs(sub: &Subtitle) -> Vec<i64> {
    if !sub.words.is_empty() {
        return sub
            .words
            .iter()
            .map(|w| {
                (((w.end_time.saturating_sub(w.start_time)) as f64) / 10.0)
                    .round()
                    .max(0.0) as i64
            })
            .collect();
    }
    let toks: Vec<&str> = sub.text.split_whitespace().collect();
    let n = toks.len() as i64;
    if n == 0 {
        return vec![];
    }
    let total = (((sub.end_time.saturating_sub(sub.start_time)) as f64) / 10.0)
        .round()
        .max(0.0) as i64;
    let base = total / n;
    let rem = total % n;
    (0..n).map(|i| base + if i < rem { 1 } else { 0 }).collect()
}

/// Per-word highlight boxes for karaoke background/both: a rounded-rect drawing
/// behind each word in the accent colour, each appearing at that word's sung
/// time and holding to the cue end. Returns (box_start_ms, drawing_payload).
fn karaoke_box_events(
    sub: &Subtitle,
    style: &CaptionStyle,
    animation: &CaptionAnimation,
    m: &Measurer,
) -> Vec<(u64, String)> {
    let fs = style.font_size.max(0.0);
    let ls = style.letter_spacing;
    let words: Vec<LaidRun> = wrap_and_place(sub, style, m)
        .iter()
        .flat_map(|l| words_in_line(l, style, m))
        .collect();
    let cs = karaoke_token_cs(sub);
    if words.is_empty() || cs.is_empty() {
        return vec![];
    }
    let (asc, desc) = m.v_metrics(fs);
    let box_h = asc + desc;
    let pad = (fs * 0.12).max(1.0);
    let ass = hex_to_ass_color(&animation.highlight_color, "22D3EE");
    let alpha = &ass[2..4];
    let bgr = &ass[4..];
    let mut out = Vec::new();
    let mut acc_ms: u64 = 0;
    let count = words.len().min(cs.len());
    for i in 0..count {
        let w = &words[i];
        let start_ms = sub.start_time + acc_ms;
        acc_ms += (cs[i].max(0) as u64) * 10;
        let trimmed = w.text.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        let ww = m.line_advance(trimmed, fs, ls);
        let bw = ww + 2.0 * pad;
        let bh = box_h + 2.0 * pad;
        let px = (w.left - pad).round() as i64;
        let py = (w.mid_y - box_h / 2.0 - pad).round() as i64;
        let radius = style.background_radius.max(0.0).min(bw.min(bh) / 2.0);
        let drawing = rounded_rect_drawing(bw, bh, radius);
        out.push((
            start_ms,
            format!(
                "{{\\an7\\pos({},{})\\bord0\\shad0\\1c&H{}&\\1a&H{}&\\p1}}{}",
                px, py, bgr, alpha, drawing
            ),
        ));
    }
    out
}

/// Escape literal `{` / `}` so ASS renderers show them instead of parsing an
/// override-tag block. `\{` / `\}` are the conventional literal-brace escapes.
fn escape_braces(text: &str) -> String {
    text.replace('{', "\\{").replace('}', "\\}")
}

/// Generate the Style line from a CaptionStyle. `align` IS exported via the
/// numpad Alignment (see `effective_alignment`). glow* IS exported, but not here: it becomes a second
/// BEHIND Dialogue line per cue (see `glow_text`), not a Style field.
/// Compute (margin_l, margin_r, margin_v) at PlayRes 1920x1080, mirroring
/// captionBoxCss in src/lib/caption-style.ts: 2% side inset for left/right
/// columns, symmetric (100 - width) / 2 for the center column. Applies the same
/// clamps as style_line (boxPosition→2 if out of 1..=9, width 10..=100,
/// marginV 0..=45) so its output is byte-identical to the old inline block.
fn box_margins(style: &CaptionStyle) -> (i64, i64, i64) {
    let box_position = if (1..=9).contains(&style.box_position) {
        style.box_position
    } else {
        2
    };
    let width_pct = style.width_pct.clamp(10.0, 100.0);
    let margin_v_pct = style.margin_v_pct.clamp(0.0, 45.0);

    let col = (box_position - 1) % 3; // 0=left 1=center 2=right
    let side = (PLAY_RES_X * 0.02).round() as i64; // 38
    let rest = (PLAY_RES_X * (98.0 - width_pct) / 100.0).round() as i64;
    let (margin_l, margin_r) = match col {
        0 => (side, rest),
        2 => (rest, side),
        _ => {
            let m = (PLAY_RES_X * (100.0 - width_pct) / 200.0).round() as i64;
            (m, m)
        }
    };
    let margin_l = margin_l.max(0);
    let margin_r = margin_r.max(0);
    let margin_v = ((PLAY_RES_Y * margin_v_pct / 100.0).round() as i64).max(0);
    (margin_l, margin_r, margin_v)
}

/// Horizontal justification column from the `align` field: 0=left, 1=center,
/// 2=right. Unknown values fall back to center (the style default).
fn align_col(align: &str) -> u8 {
    match align {
        "left" => 0,
        "right" => 2,
        _ => 1,
    }
}

/// The numpad row base (1=bottom, 4=middle, 7=top) — the VERTICAL band the
/// caption box sits in — from the clamped box_position.
fn row_base(box_position: u8) -> u8 {
    let bp = if (1..=9).contains(&box_position) {
        box_position
    } else {
        2
    };
    if bp <= 3 {
        1
    } else if bp <= 6 {
        4
    } else {
        7
    }
}

/// Effective ASS numpad Alignment: vertical band from `box_position`, horizontal
/// justification from `align`. Decoupling these is what lets text justification
/// (left/center/right *within* the positioned box) round-trip to the export,
/// matching the CSS preview's `text-align`. The box's on-screen REGION is still
/// driven by box_position via `box_margins`; alignment only justifies text
/// inside that region.
fn effective_alignment(style: &CaptionStyle) -> u8 {
    row_base(style.box_position) + align_col(&style.align)
}

/// Compute the on-canvas anchor point (x, y, an) for a cue. `an` is the
/// effective alignment (vertical band from box_position, justification from
/// align); the reference point x/y matches where the Style Alignment + margins
/// place the line, so \pos/\move-based animations rest exactly where a
/// non-animated line would sit — justified per `align` too.
fn anchor_point(style: &CaptionStyle) -> (i64, i64, u8) {
    let bp: u8 = if (1..=9).contains(&style.box_position) {
        style.box_position
    } else {
        2
    };
    let (ml, mr, mv) = box_margins(style);
    let acol = align_col(&style.align); // 0=left 1=center 2=right
    let x = match acol {
        0 => ml,
        2 => (PLAY_RES_X as i64) - mr,
        _ => (ml + (PLAY_RES_X as i64 - mr)) / 2,
    };
    let y = if bp <= 3 {
        (PLAY_RES_Y as i64) - mv
    } else if bp <= 6 {
        (PLAY_RES_Y as i64) / 2
    } else {
        mv
    };
    (x, y, effective_alignment(style))
}

fn style_line(style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    // Clamp everything crossing IPC before use. The numpad Alignment field is
    // `effective_alignment` (box_position row + align column), so text
    // justification is honoured in the export, not just the preview.
    let font_size = style.font_size.max(0.0);
    let outline_width = style.outline_width.max(0.0);

    // Karaoke uses ASS \k semantics: unsung text is SecondaryColour (the base
    // text colour) and sweeps to PrimaryColour (the highlight) as it's "sung".
    // In "background" mode the highlight is a per-word box, not a text recolour,
    // so the fill stays the base colour (Primary = Secondary). Every other type
    // also keeps Primary = Secondary = base text colour.
    let karaoke_recolours =
        animation.anim_type == "karaoke" && animation.karaoke_highlight != "background";
    let (primary, secondary) = if karaoke_recolours {
        (
            hex_to_ass_color(&animation.highlight_color, "FFFFFF"),
            hex_to_ass_color(&style.text_color, "FFFFFF"),
        )
    } else {
        let p = hex_to_ass_color(&style.text_color, "FFFFFF");
        (p.clone(), p)
    };
    let outline_colour = hex_to_ass_color(&style.outline_color, "000000");
    let back_colour = hex_to_ass_color(&style.shadow_color, "000000");

    let (margin_l, margin_r, margin_v) = box_margins(style);

    format!(
        "Style: Default,{},{},{},{},{},{},{},{},0,0,100,100,{},0,1,{},{},{},{},{},{},1\n",
        ass_font_name(&style.font_id),
        fmt_num(font_size),
        primary,
        secondary,
        outline_colour,
        back_colour,
        if style.bold { -1 } else { 0 },
        if style.italic { -1 } else { 0 },
        fmt_num(style.letter_spacing),
        if style.outline {
            fmt_num(outline_width)
        } else {
            "0".to_string()
        },
        // Shadow is rendered as a separate OFFSET behind-layer copy of the cue
        // (see `shadow_text`), never the ASS Style `Shadow` depth field — always 0.
        "0",
        effective_alignment(style),
        margin_l,
        margin_r,
        margin_v,
    )
}

/// Parse "#RRGGBB" or "#RRGGBBAA" (case-insensitive) into ASS
/// "&HAABBGGRR" (alpha first, BGR byte order). ASS transparency is the
/// INVERSE of RGBA alpha: 00 = fully opaque, FF = fully transparent, so
/// `ass_alpha = 255 - rgba_alpha`. A 6-digit value is treated as opaque
/// (rgba_alpha = 255 → ass_alpha 00), keeping opaque defaults byte-identical.
/// On malformed input returns "&H00" + `fallback` (opaque), where `fallback`
/// is already in BGR order (e.g. "FFFFFF" / "000000").
///
/// Used for PrimaryColour, SecondaryColour (karaoke), OutlineColour and
/// BackColour in `style_line`, so alpha encodes for all four with no other
/// changes. Because F2's `write_ass` also feeds the MP4 burn-in
/// (video_export.rs:83), alpha burns into the MP4 for free via this function.
fn hex_to_ass_color(hex: &str, fallback: &str) -> String {
    let parsed = hex.strip_prefix('#').and_then(|h| {
        if !h.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let (r, g, b, rgba_alpha) = match h.len() {
            6 => (
                u8::from_str_radix(&h[0..2], 16).ok()?,
                u8::from_str_radix(&h[2..4], 16).ok()?,
                u8::from_str_radix(&h[4..6], 16).ok()?,
                255u8,
            ),
            8 => (
                u8::from_str_radix(&h[0..2], 16).ok()?,
                u8::from_str_radix(&h[2..4], 16).ok()?,
                u8::from_str_radix(&h[4..6], 16).ok()?,
                u8::from_str_radix(&h[6..8], 16).ok()?,
            ),
            _ => return None,
        };
        let ass_alpha = 255 - rgba_alpha;
        Some(format!("&H{:02X}{:02X}{:02X}{:02X}", ass_alpha, b, g, r))
    });
    parsed.unwrap_or_else(|| format!("&H00{}", fallback))
}

/// Format a numeric Style field: integer when whole (after rounding to 2
/// decimals), otherwise up to 2 decimals with trailing zeros trimmed.
fn fmt_num(v: f64) -> String {
    let rounded = (v * 100.0).round() / 100.0;
    if rounded.fract() == 0.0 {
        format!("{}", rounded as i64)
    } else {
        let s = format!("{:.2}", rounded);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

// ASS timestamp format: H:MM:SS.cs (centiseconds, not milliseconds)
fn format_ass_timestamp(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1_000;
    let centis = (ms % 1_000) / 10;
    format!("{}:{:02}:{:02}.{:02}", hours, minutes, seconds, centis)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitle::types::Subtitle;
    use uuid::Uuid;

    fn make_sub(index: usize, start_ms: u64, end_ms: u64, text: &str) -> Subtitle {
        Subtitle {
            id: Uuid::new_v4().to_string(),
            index,
            start_time: start_ms,
            end_time: end_ms,
            text: text.to_string(),
            words: Vec::new(),
            speaker: None,
        }
    }

    #[test]
    fn test_ass_structure() {
        let subs = vec![make_sub(1, 1000, 3500, "Hello world")];
        let out = write_ass(&subs, &CaptionStyle::default(), &CaptionAnimation::default());
        assert!(out.contains("[Script Info]"));
        assert!(out.contains("[V4+ Styles]"));
        assert!(out.contains("[Events]"));
        assert!(out.contains("Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world"));
    }

    #[test]
    fn test_ass_timestamp_centiseconds() {
        // 1500 ms = 1 second 500 ms = 1 second 50 centiseconds
        assert_eq!(format_ass_timestamp(1_500), "0:00:01.50");
        assert_eq!(format_ass_timestamp(3_661_500), "1:01:01.50");
    }

    #[test]
    fn test_ass_newline_escape() {
        let subs = vec![make_sub(1, 0, 1000, "line one\nline two")];
        let out = write_ass(&subs, &CaptionStyle::default(), &CaptionAnimation::default());
        assert!(out.contains("line one\\Nline two"));
    }

    #[test]
    fn test_default_style_golden_line() {
        let out = write_ass(&[], &CaptionStyle::default(), &CaptionAnimation::default());
        assert!(out.contains(
            "Style: Default,Outfit,48,&H00FFFFFF,&H00FFFFFF,&H00160F0B,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,365,365,86,1"
        ));
    }

    #[test]
    fn test_script_info_play_res() {
        let out = write_ass(&[], &CaptionStyle::default(), &CaptionAnimation::default());
        assert!(out.contains("PlayResX: 1920\n"));
        assert!(out.contains("PlayResY: 1080\n"));
        assert!(out.contains("WrapStyle: 0\n"));
        assert!(out.contains("ScaledBorderAndShadow: yes\n"));
    }

    #[test]
    fn test_bold_italic_flags() {
        let style = CaptionStyle {
            bold: false,
            italic: true,
            ..CaptionStyle::default()
        };
        let line = style_line(&style, &CaptionAnimation::default());
        // Bold 0, Italic -1, Underline 0, StrikeOut 0
        assert!(line.contains(",0,-1,0,0,"));

        let default_line = style_line(&CaptionStyle::default(), &CaptionAnimation::default());
        // Bold -1, Italic 0
        assert!(default_line.contains(",-1,0,0,0,"));
    }

    #[test]
    fn test_hex_to_ass_color() {
        // 6-digit treated as opaque (ass_alpha 00).
        assert_eq!(hex_to_ass_color("#22D3EE", "FFFFFF"), "&H00EED322");
        assert_eq!(hex_to_ass_color("#ffffff", "000000"), "&H00FFFFFF");
        // Malformed input falls back (fallback is already BGR).
        assert_eq!(hex_to_ass_color("oops", "FFFFFF"), "&H00FFFFFF");
        assert_eq!(hex_to_ass_color("#12345", "000000"), "&H00000000");
    }

    #[test]
    fn test_hex_to_ass_color_alpha() {
        // 8-digit opaque: AA=FF → ass_alpha 255-255=0 → &H00.
        assert_eq!(hex_to_ass_color("#22D3EEFF", "FFFFFF"), "&H00EED322");
        // 50%-ish: AA=0x80=128 → ass_alpha 255-128=127=0x7F.
        assert_eq!(hex_to_ass_color("#22D3EE80", "FFFFFF"), "&H7FEED322");
        // Fully transparent: AA=00 → ass_alpha 255=FF.
        assert_eq!(hex_to_ass_color("#22D3EE00", "FFFFFF"), "&HFFEED322");
        // Case-insensitive 8-digit.
        assert_eq!(hex_to_ass_color("#22d3ee80", "FFFFFF"), "&H7FEED322");
        // 7-digit is malformed → fallback.
        assert_eq!(hex_to_ass_color("#22D3EE8", "000000"), "&H00000000");
    }

    #[test]
    fn test_style_line_alpha_encodes_primary_and_back() {
        // Semi-transparent text and shadow colours (AA=0x80 → ass_alpha 0x7F).
        let style = CaptionStyle {
            shadow: true,
            shadow_color: "#00000080".to_string(),
            text_color: "#FFFFFF80".to_string(),
            ..CaptionStyle::default()
        };
        let line = style_line(&style, &CaptionAnimation::default());
        // PrimaryColour = &H7FFFFFFF, BackColour = &H7F000000.
        assert!(line.contains("&H7FFFFFFF"), "PrimaryColour alpha; got: {line}");
        assert!(line.contains("&H7F000000"), "BackColour alpha; got: {line}");
    }

    #[test]
    fn test_outline_shadow_fields() {
        // The ASS Style Shadow depth field is ALWAYS 0 now — the drop shadow is
        // a separate offset behind-layer copy (see `shadow_text`), not the Style
        // Shadow field. Even with shadow ON, the Style line shows Shadow = 0.
        let style = CaptionStyle {
            outline: false,
            shadow: true,
            ..CaptionStyle::default()
        };
        let line = style_line(&style, &CaptionAnimation::default());
        // ...Angle,BorderStyle,Outline,Shadow,Alignment... → 0,1,0,0,2
        assert!(line.contains(",0,1,0,0,2,"), "Style Shadow must be 0; got: {line}");
    }

    #[test]
    fn test_uppercase_dialogue_unicode() {
        let style = CaptionStyle {
            uppercase: true,
            ..CaptionStyle::default()
        };
        let subs = vec![make_sub(1, 0, 1000, "żółć gęś")];
        let out = write_ass(&subs, &style, &CaptionAnimation::default());
        assert!(out.contains("ŻÓŁĆ GĘŚ"));
        // Timestamps stay untouched.
        assert!(out.contains("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ŻÓŁĆ GĘŚ"));

        let mut with_speaker = make_sub(1, 0, 1000, "hello");
        with_speaker.speaker = Some("Speaker 1".to_string());
        let out = write_ass(&[with_speaker], &style, &CaptionAnimation::default());
        assert!(out.contains("[SPEAKER 1] HELLO"));
    }

    #[test]
    fn test_brace_escaping() {
        let subs = vec![make_sub(1, 0, 1000, "{whispers} come here")];
        let out = write_ass(&subs, &CaptionStyle::default(), &CaptionAnimation::default());
        assert!(out.contains(",,\\{whispers\\} come here\n"));
        assert!(!out.contains(",,{whispers}"));

        // Speaker names with braces are escaped too.
        let mut sub = make_sub(1, 0, 1000, "use {x} here");
        sub.speaker = Some("{Narrator}".to_string());
        let out = write_ass(&[sub], &CaptionStyle::default(), &CaptionAnimation::default());
        assert!(out.contains("[\\{Narrator\\}] use \\{x\\} here"));

        // Escaping survives the uppercase transform.
        let style = CaptionStyle {
            uppercase: true,
            ..CaptionStyle::default()
        };
        let subs = vec![make_sub(1, 0, 1000, "{quiet} ok")];
        let out = write_ass(&subs, &style, &CaptionAnimation::default());
        assert!(out.contains("\\{QUIET\\} OK"));

        assert_eq!(escape_braces("plain"), "plain");
        assert_eq!(escape_braces("{a}{b}"), "\\{a\\}\\{b\\}");
    }

    #[test]
    fn test_alignment_and_margins() {
        // box_position picks the REGION (margins) + vertical band; `align` picks
        // the numpad COLUMN (justification). Default align is center.
        // Top-left cell, default (center) align -> numpad 8 (top-CENTER),
        // MarginL 38 (2% side inset), MarginR = round(1920*(98-62)/100) = 691,
        // MarginV 86. The region still hugs the left (box_position col 0).
        let style = CaptionStyle {
            box_position: 7,
            margin_v_pct: 8.0,
            ..CaptionStyle::default()
        };
        assert!(style_line(&style, &CaptionAnimation::default()).contains(",8,38,691,86,1"));

        // Bottom-left region, default center -> numpad 2, same margins.
        let left = CaptionStyle {
            box_position: 1,
            margin_v_pct: 8.0,
            ..CaptionStyle::default()
        };
        assert!(style_line(&left, &CaptionAnimation::default()).contains(",2,38,691,86,1"));

        // Out-of-range boxPosition clamps to 2 (bottom-center region + band).
        let bad = CaptionStyle {
            box_position: 0,
            ..CaptionStyle::default()
        };
        assert!(style_line(&bad, &CaptionAnimation::default()).contains(",2,365,365,86,1"));
    }

    #[test]
    fn test_align_drives_numpad_column_independent_of_box_position() {
        // Same top-left region (box_position 7 -> row base 7, margins hug left);
        // `align` alone moves the numpad column, matching the preview's
        // text-align within the positioned box.
        let base = CaptionStyle {
            box_position: 7,
            margin_v_pct: 8.0,
            ..CaptionStyle::default()
        };
        let left = CaptionStyle { align: "left".into(), ..base.clone() };
        let center = CaptionStyle { align: "center".into(), ..base.clone() };
        let right = CaptionStyle { align: "right".into(), ..base.clone() };
        // Region margins are identical (38/691); only the numpad digit changes.
        assert!(style_line(&left, &CaptionAnimation::default()).contains(",7,38,691,86,1"));
        assert!(style_line(&center, &CaptionAnimation::default()).contains(",8,38,691,86,1"));
        assert!(style_line(&right, &CaptionAnimation::default()).contains(",9,38,691,86,1"));

        // Bottom band (box_position 2) keeps the same columns: 1 / 2 / 3.
        let bl = CaptionStyle { align: "left".into(), box_position: 2, ..CaptionStyle::default() };
        let br = CaptionStyle { align: "right".into(), box_position: 2, ..CaptionStyle::default() };
        assert!(style_line(&bl, &CaptionAnimation::default()).contains(",1,365,365,86,1"));
        assert!(style_line(&br, &CaptionAnimation::default()).contains(",3,365,365,86,1"));

        // Unknown align falls back to center (column 1).
        let weird = CaptionStyle { align: "justify".into(), box_position: 2, ..CaptionStyle::default() };
        assert!(style_line(&weird, &CaptionAnimation::default()).contains(",2,365,365,86,1"));
    }

    #[test]
    fn test_empty_font_falls_back_to_outfit() {
        let style = CaptionStyle {
            font_id: "".to_string(),
            ..CaptionStyle::default()
        };
        assert!(style_line(&style, &CaptionAnimation::default()).starts_with("Style: Default,Outfit,"));
    }

    #[test]
    fn test_system_family_passes_through() {
        let style = CaptionStyle {
            font_id: "Arial".to_string(),
            ..CaptionStyle::default()
        };
        assert!(style_line(&style, &CaptionAnimation::default()).starts_with("Style: Default,Arial,"));
    }

    #[test]
    fn test_fractional_font_size_formatting() {
        let style = CaptionStyle {
            font_size: 48.5,
            ..CaptionStyle::default()
        };
        assert!(style_line(&style, &CaptionAnimation::default()).contains("Style: Default,Outfit,48.5,"));
        assert_eq!(fmt_num(48.5), "48.5");
        assert_eq!(fmt_num(48.0), "48");
        assert_eq!(fmt_num(48.50), "48.5");
        assert_eq!(fmt_num(1.25), "1.25");
    }

    #[test]
    fn test_animation_fade_prefixes_fad_tag() {
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "fade".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(out.contains(",,{\\fad(400,400)}hello world\n"));
        // Rounds the duration and applies in+out symmetrically.
        let anim = CaptionAnimation {
            anim_type: "fade".to_string(),
            duration_ms: 249.6,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(out.contains("{\\fad(250,250)}hello world"));
    }

    #[test]
    fn test_animation_karaoke_even_split_and_style_colours() {
        // No word timings → even centisecond split across whitespace tokens.
        // 2000 ms = 200 cs over 2 tokens = 100 cs each.
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "karaoke".to_string(),
            highlight_color: "#22D3EE".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(out.contains(",,{\\k100}hello {\\k100}world\n"));

        // Style line: PrimaryColour = highlight (#22D3EE → &H00EED322),
        // SecondaryColour = base text colour (#FFFFFF → &H00FFFFFF).
        let line = style_line(&CaptionStyle::default(), &anim);
        assert!(line.contains(",&H00EED322,&H00FFFFFF,"));
    }

    #[test]
    fn test_animation_karaoke_fallback_splits_on_newline() {
        // Multi-line cue with no word timings (common after translation, which
        // empties sub.words). The newline must act as a token boundary — two
        // \k tokens, matching the frontend karaokeSegments fallback which splits
        // sub.text on /\s+/ — not one fused "hello\Nworld" token.
        let subs = vec![make_sub(1, 0, 2000, "hello\nworld")];
        let anim = CaptionAnimation {
            anim_type: "karaoke".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(",,{\\k100}hello {\\k100}world\n"),
            "newline should split into two tokens; got: {out}"
        );
        // The fused single-token form must not appear.
        assert!(!out.contains("\\Nworld"), "tokens must not fuse across \\N");
    }

    #[test]
    fn test_animation_karaoke_uses_word_timings() {
        let mut sub = make_sub(1, 0, 1000, "hi there");
        sub.words = vec![
            crate::subtitle::types::Word {
                text: "hi".to_string(),
                start_time: 0,
                end_time: 300,
            },
            crate::subtitle::types::Word {
                text: "there".to_string(),
                start_time: 300,
                end_time: 1000,
            },
        ];
        let anim = CaptionAnimation {
            anim_type: "karaoke".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&[sub], &CaptionStyle::default(), &anim);
        // 300 ms = 30 cs, 700 ms = 70 cs.
        assert!(out.contains(",,{\\k30}hi {\\k70}there\n"));
    }

    #[test]
    fn test_animation_karaoke_keeps_speaker_prefix_and_escapes() {
        let mut sub = make_sub(1, 0, 2000, "{a} b");
        sub.speaker = Some("Speaker 1".to_string());
        let anim = CaptionAnimation {
            anim_type: "karaoke".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&[sub], &CaptionStyle::default(), &anim);
        // Speaker prefix leads as plain text; braces escaped per token.
        assert!(out.contains(",,[Speaker 1] {\\k100}\\{a\\} {\\k100}b\n"));
    }

    #[test]
    fn test_animation_scale_per_word_stagger() {
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        // Default granularity "word", stagger 40 → word 0 pops 0..400, word 1
        // pops 40..440, each from scale 0 to 100.
        let anim = CaptionAnimation {
            anim_type: "scale".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(
                ",,{\\fscx0\\fscy0\\t(0,400,\\fscx100\\fscy100)}hello \
                 {\\fscx0\\fscy0\\t(40,440,\\fscx100\\fscy100)}world\n"
            ),
            "got: {out}"
        );
    }

    #[test]
    fn test_animation_scale_line_granularity_joins_with_newline() {
        let subs = vec![make_sub(1, 0, 2000, "top\nbottom")];
        let anim = CaptionAnimation {
            anim_type: "scale".to_string(),
            duration_ms: 400.0,
            granularity: "line".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        // Two line-units, rejoined with \N, staggered by 40 ms.
        assert!(
            out.contains(
                ",,{\\fscx0\\fscy0\\t(0,400,\\fscx100\\fscy100)}top\
                 \\N{\\fscx0\\fscy0\\t(40,440,\\fscx100\\fscy100)}bottom\n"
            ),
            "got: {out}"
        );
    }

    #[test]
    fn test_animation_blur_left_moves_and_deblurs() {
        let subs = vec![make_sub(1, 0, 2000, "hi")];
        // blur + direction left → horizontal \move (x - 3·fontSize = 960-144=816)
        // into place, deblurring over the duration.
        let anim = CaptionAnimation {
            anim_type: "blur".to_string(),
            duration_ms: 400.0,
            direction: "left".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(",,{\\an2\\move(816,994,960,994,0,400)\\blur24\\t(0,400,\\blur0)}hi\n"),
            "got: {out}"
        );
    }

    #[test]
    fn test_animation_blurdrop_from_top() {
        let subs = vec![make_sub(1, 0, 2000, "hi")];
        // blurDrop "up" (from top): y starts one travel-step above (994-48=946).
        let anim = CaptionAnimation {
            anim_type: "blurDrop".to_string(),
            duration_ms: 400.0,
            direction: "up".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(",,{\\an2\\move(960,946,960,994,0,400)\\blur24\\t(0,400,\\blur0)}hi\n"),
            "got: {out}"
        );
    }

    #[test]
    fn test_animation_colorshift_sweeps_to_accent_and_back() {
        let subs = vec![make_sub(1, 0, 2000, "hi")];
        // Accent #22D3EE → BGR EED322; base text #FFFFFF → FFFFFF. Sweep to
        // accent by 200 ms, back to text by 400 ms.
        let anim = CaptionAnimation {
            anim_type: "colorShift".to_string(),
            duration_ms: 400.0,
            highlight_color: "#22D3EE".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(",,{\\t(0,200,\\1c&HEED322&)\\t(200,400,\\1c&HFFFFFF&)}hi\n"),
            "got: {out}"
        );
    }

    #[test]
    fn test_animation_decode_positions_chars_left_to_right() {
        let subs = vec![make_sub(1, 0, 2000, "abc")];
        // step 40 (default), scramble 300 → char 0 settles at 300 ms, char 1 at
        // 340, char 2 at 380 (left→right). Rough measurer: "abc" width 72, centred
        // → 'a' left 924, 'b' 948, 'c' 972; mid_y 970.
        let anim = CaptionAnimation {
            anim_type: "decode".to_string(),
            duration_ms: 300.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        // Each char settles as a positioned event, staggered left→right.
        assert!(
            out.contains("Dialogue: 5,0:00:00.30,0:00:02.00,Default,,0,0,0,,{\\an4\\pos(924,970)}a\n"),
            "char 'a' settles first at its slot; got: {out}"
        );
        assert!(
            out.contains("Dialogue: 5,0:00:00.34,0:00:02.00,Default,,0,0,0,,{\\an4\\pos(948,970)}b\n"),
            "char 'b' settles later, next slot; got: {out}"
        );
        assert!(
            out.contains("Dialogue: 5,0:00:00.38,0:00:02.00,Default,,0,0,0,,{\\an4\\pos(972,970)}c\n"),
            "char 'c' settles last; got: {out}"
        );
        // The scramble adds several extra timed events at each char's slot.
        assert!(
            out.matches("\\an4\\pos(924,970)").count() > 1,
            "char 'a' should scramble (multiple timed glyph events) before settling; got: {out}"
        );
    }

    #[test]
    fn test_animation_staircase_positions_words_and_cascades() {
        let subs = vec![make_sub(1, 0, 2000, "a b")];
        // staircase down (from bottom): each word is its OWN positioned \move
        // event rising from +off, staggered by 40 ms. Rough measurer (no metrics):
        // 0.5·em advances → "a b" (3 chars) width 72, centred at x=960 → left 924,
        // mid_y 965; word "a " left 924, "b" left 972; off=48 → start y 1013.
        let anim = CaptionAnimation {
            anim_type: "staircase".to_string(),
            duration_ms: 400.0,
            direction: "down".to_string(),
            granularity: "word".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(
                ",,{\\an4\\move(924,1018,924,970,0,400)\\alpha&HFF&\\t(0,400,\\alpha&H00&)}a \n"
            ),
            "word 0 positioned event; got: {out}"
        );
        assert!(
            out.contains(
                ",,{\\an4\\move(972,1018,972,970,40,440)\\alpha&HFF&\\t(40,440,\\alpha&H00&)}b\n"
            ),
            "word 1 positioned event; got: {out}"
        );
    }

    #[test]
    fn test_animation_blur() {
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "blur".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(",,{\\blur24\\t(0,400,\\blur0)}hello world\n"),
            "got: {out}"
        );
    }

    #[test]
    fn test_glow_off_single_layer0_line_unchanged() {
        // glow off (default) → exactly one Dialogue line at Layer 0, no glow tags.
        let subs = vec![make_sub(1, 1000, 3500, "Hello world")];
        let out = write_ass(&subs, &CaptionStyle::default(), &CaptionAnimation::default());
        let dialogue_lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(dialogue_lines.len(), 1, "glow off must emit one line; got: {out}");
        assert!(dialogue_lines[0].starts_with("Dialogue: 0,"), "got: {out}");
        assert!(!out.contains("\\1c&HEED322&"), "no glow tags when glow off; got: {out}");
        // Byte-identical to the pre-glow golden line.
        assert!(out.contains("Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world\n"));
    }

    #[test]
    fn test_glow_on_emits_behind_line_and_bumps_real_line() {
        // glow on → a Layer 0 glow line (glyph shapes filled in the glow
        // colour, no border, blurred) BEHIND, and the real text bumped to Layer 1.
        let style = CaptionStyle {
            glow: true,
            ..CaptionStyle::default()
        };
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let out = write_ass(&subs, &style, &CaptionAnimation::default());
        let dialogue_lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(dialogue_lines.len(), 2, "glow on must emit two lines; got: {out}");

        // Glow line: Layer 0, whole-text halo. Default glowStrength 12 →
        // \blur round(12)=12; glowColor #22D3EE → &H00EED322 → \1c&HEED322&, \1a&H00&.
        assert!(
            dialogue_lines[0].contains(
                "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\bord0\\shad0\\1c&HEED322&\\1a&H00&\\blur12}hello world"
            ),
            "glow line; got: {out}"
        );
        // Real text bumped to Layer 1, unchanged body.
        assert!(
            dialogue_lines[1].contains(
                "Dialogue: 1,0:00:00.00,0:00:02.00,Default,,0,0,0,,hello world"
            ),
            "real line bumped to Layer 1; got: {out}"
        );
    }

    #[test]
    fn test_glow_on_carries_animation_prefix_on_both_lines() {
        // The glow line must carry the same entrance prefix as the real line so
        // the halo tracks the moving text — here fade.
        let style = CaptionStyle {
            glow: true,
            ..CaptionStyle::default()
        };
        let anim = CaptionAnimation {
            anim_type: "fade".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let out = write_ass(&subs, &style, &anim);
        let dialogue_lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        // Glow line: fade prefix, then glow block, then body.
        assert!(
            dialogue_lines[0].contains(",,{\\fad(400,400)}{\\bord0\\shad0\\1c&HEED322&\\1a&H00&\\blur12}hello world"),
            "glow line carries fade prefix; got: {out}"
        );
        // Real line: fade prefix, Layer 1.
        assert!(
            dialogue_lines[1].contains("Dialogue: 1,") && dialogue_lines[1].contains(",,{\\fad(400,400)}hello world"),
            "real line; got: {out}"
        );
    }

    #[test]
    fn test_glow_on_blur_animation_omits_static_blur() {
        // With animation=blur, the glow line must NOT emit its own static
        // \blur (the animation prefix's \blur drives it) — no double-apply.
        let style = CaptionStyle {
            glow: true,
            ..CaptionStyle::default()
        };
        let anim = CaptionAnimation {
            anim_type: "blur".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let out = write_ass(&subs, &style, &anim);
        let dialogue_lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        // Glow block has no \blur<r> (the entrance \blur24 leads and drives it).
        assert!(
            dialogue_lines[0].contains(",,{\\blur24\\t(0,400,\\blur0)}{\\bord0\\shad0\\1c&HEED322&\\1a&H00&}hello world"),
            "glow line omits static blur under blur animation; got: {out}"
        );
    }

    #[test]
    fn test_glow_color_alpha_folds_into_1a() {
        // A glowColor with alpha folds the inverse-alpha byte into the fill
        // alpha \1a and the BGR into \1c. #22D3EE80 → &H7FEED322 → \1a&H7F&,
        // \1c&HEED322&.
        let style = CaptionStyle {
            glow: true,
            glow_color: "#22D3EE80".to_string(),
            glow_strength: 20.0,
            ..CaptionStyle::default()
        };
        let subs = vec![make_sub(1, 0, 2000, "hi")];
        let out = write_ass(&subs, &style, &CaptionAnimation::default());
        // glowStrength 20 → \blur round(20)=20.
        assert!(
            out.contains("{\\bord0\\shad0\\1c&HEED322&\\1a&H7F&\\blur20}hi"),
            "glow alpha folded into \\1a; got: {out}"
        );
    }

    #[test]
    fn test_glow_strength_clamps() {
        // Tiny strength clamps \blur to 4 (no border in the fill-based glow).
        let style = CaptionStyle {
            glow: true,
            glow_strength: 1.0,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 1000, "x")], &style, &CaptionAnimation::default());
        assert!(out.contains("\\1c&HEED322&\\1a&H00&\\blur4}x"), "low clamp; got: {out}");

        // Huge strength clamps \blur to 40.
        let style = CaptionStyle {
            glow: true,
            glow_strength: 500.0,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 1000, "x")], &style, &CaptionAnimation::default());
        assert!(out.contains("\\1c&HEED322&\\1a&H00&\\blur40}x"), "high clamp; got: {out}");
    }

    #[test]
    fn test_animation_slide_positions_words() {
        // slide = per-word positioned \move events rising from +off (48), staggered
        // by 40 ms. Rough measurer: "hello world" (11 chars) width 264, centred at
        // x=960 → left 828, mid_y 970; "hello " left 828, "world" left 972.
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "slide".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(
                ",,{\\an4\\move(828,1018,828,970,0,400)\\alpha&HFF&\\t(0,400,\\alpha&H00&)}hello \n"
            ),
            "word 0; got: {out}"
        );
        assert!(
            out.contains(
                ",,{\\an4\\move(972,1018,972,970,40,440)\\alpha&HFF&\\t(40,440,\\alpha&H00&)}world\n"
            ),
            "word 1; got: {out}"
        );
    }

    #[test]
    fn test_animation_typewriter() {
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "typewriter".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        // Payload begins with the first char's hidden-until-window tag.
        let payload = out
            .split(",,")
            .last()
            .unwrap_or("");
        assert!(
            payload.starts_with("{\\alpha&HFF&\\t(0,"),
            "payload should start with staggered alpha tag; got: {out}"
        );
        // First reveal targets the first char.
        assert!(out.contains("\\alpha&H00&)}h"), "got: {out}");
        // No other animation tags leak in.
        assert!(!out.contains("\\fad"), "typewriter must not emit \\fad");
        assert!(!out.contains("{\\k"), "typewriter must not emit \\k");
        assert!(!out.contains("\\fscx"), "typewriter must not emit \\fscx");
        assert!(!out.contains("\\blur"), "typewriter must not emit \\blur");
        assert!(!out.contains("\\move"), "typewriter must not emit \\move");
    }

    #[test]
    fn test_animation_typewriter_escapes_braces() {
        // A cue with literal braces must keep each brace as one escaped reveal
        // unit ("\{"/"\}") — never a bare "{"/"}" that re-opens an override block.
        let subs = vec![make_sub(1, 0, 300, "{x}")];
        let anim = CaptionAnimation {
            anim_type: "typewriter".to_string(),
            duration_ms: 300.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        // Braces are escaped and sit right after their reveal block.
        assert!(out.contains("\\alpha&H00&)}\\{"), "opening brace escaped; got: {out}");
        assert!(out.contains("\\alpha&H00&)}\\}"), "closing brace escaped; got: {out}");
        // The old char-splitting bug emitted a bare brace right after a block
        // close ("...)}{" ), re-opening an override block. It must not appear.
        assert!(!out.contains("\\alpha&H00&)}{"), "no raw brace after a reveal block; got: {out}");
    }

    #[test]
    fn test_animation_typewriter_newline_reveals_across_lines() {
        // A real newline is a plain \N reveal step; the surrounding chars still
        // reveal one at a time (no fused unit, no stray backslash).
        let subs = vec![make_sub(1, 0, 300, "a\nb")];
        let anim = CaptionAnimation {
            anim_type: "typewriter".to_string(),
            duration_ms: 300.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        // 3 units: 'a' (0-100), '\N' (plain), 'b' (200-300).
        assert!(out.contains("\\alpha&H00&)}a\\N{\\alpha&HFF&\\t(200,300"), "got: {out}");
    }

    #[test]
    fn test_animation_slide_emits_box_margins_on_event() {
        // Default style box margins are 365/365/86; slide must emit them on the
        // Dialogue event so libass wraps at the box width under \move.
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "slide".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        // Positioned per-word events still carry the box margins on each line.
        assert!(
            out.contains("Default,,365,365,86,,{\\an4\\move("),
            "slide should carry box margins on the event; got: {out}"
        );

        // Non-move types keep 0,0,0 (inherit Style margins). scale is per-unit
        // \fscx with no \move, so it stays on the inherited margins.
        let anim = CaptionAnimation {
            anim_type: "scale".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(out.contains("Default,,0,0,0,,{\\fscx0"), "got: {out}");
    }

    #[test]
    fn test_karaoke_background_emits_per_word_boxes() {
        let mut sub = make_sub(1, 0, 1000, "hi there");
        sub.words = vec![
            crate::subtitle::types::Word { text: "hi".to_string(), start_time: 0, end_time: 300 },
            crate::subtitle::types::Word { text: "there".to_string(), start_time: 300, end_time: 1000 },
        ];
        let anim = CaptionAnimation {
            anim_type: "karaoke".to_string(),
            karaoke_highlight: "background".to_string(),
            highlight_color: "#22D3EE".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&[sub], &CaptionStyle::default(), &anim);

        // background mode → caption text stays plain (no \k sweep) and the Style
        // keeps Primary = Secondary = base text colour (no fill recolour).
        assert!(out.contains(",,hi there\n"), "text should be plain; got: {out}");
        assert!(!out.contains("{\\k"), "background mode must not emit \\k; got: {out}");
        let line = style_line(&CaptionStyle::default(), &anim);
        assert!(line.contains(",&H00FFFFFF,&H00FFFFFF,"), "no fill recolour; got: {line}");

        // Two behind-layer accent boxes (Rough measurer: "hi there" width 192,
        // centred → left 864; "hi " left 864, "there" left 936; mid_y 970).
        assert_eq!(out.matches("\\p1}m ").count(), 2, "one box per word; got: {out}");
        // Box 0 appears at the cue start; box 1 when "there" is sung (300 ms).
        assert!(
            out.contains("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\an7\\pos(858,940)\\bord0\\shad0\\1c&HEED322&\\1a&H00&\\p1}m "),
            "box 0 at word 0 position/time; got: {out}"
        );
        assert!(
            out.contains("Dialogue: 0,0:00:00.30,0:00:01.00,Default,,0,0,0,,{\\an7\\pos(930,940)"),
            "box 1 appears at 'there' sung time; got: {out}"
        );
    }

    #[test]
    fn test_karaoke_both_keeps_k_sweep_and_boxes() {
        let subs = vec![make_sub(1, 0, 1000, "hi there")];
        let anim = CaptionAnimation {
            anim_type: "karaoke".to_string(),
            karaoke_highlight: "both".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        // both → \k fill sweep (text recolours) AND per-word boxes.
        assert!(out.contains("{\\k"), "both mode keeps \\k sweep; got: {out}");
        assert_eq!(out.matches("\\p1}m ").count(), 2, "both mode still draws boxes; got: {out}");
    }

    #[test]
    fn test_animation_none_yields_plain_body() {
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        for t in ["none"] {
            let anim = CaptionAnimation {
                anim_type: t.to_string(),
                ..CaptionAnimation::default()
            };
            let out = write_ass(&subs, &CaptionStyle::default(), &anim);
            assert!(out.contains(",,hello world\n"), "type {t} should be plain");
            assert!(!out.contains("\\fad"), "type {t} must not emit \\fad");
            assert!(!out.contains("\\k"), "type {t} must not emit \\k");
            assert!(!out.contains("\\fscx"), "type {t} must not emit \\fscx");
            assert!(!out.contains("\\blur"), "type {t} must not emit \\blur");
            assert!(!out.contains("\\move"), "type {t} must not emit \\move");
            assert!(!out.contains("\\t("), "type {t} must not emit \\t");
            // none keeps Primary = Secondary = base text colour.
            let line = style_line(&CaptionStyle::default(), &anim);
            assert!(line.contains(",&H00FFFFFF,&H00FFFFFF,"));
        }
    }

    // ---- Drop shadow (offset behind-layer copy) ----

    #[test]
    fn test_shadow_offset_pos_math() {
        // Shadow on → an offset behind-layer copy at Layer 0, real text at
        // Layer 1. angle 0°, distance 10 → offset (+10, 0). Default anchor is
        // (960, 994) with numpad an 2 → shadow \pos(970, 994).
        let style = CaptionStyle {
            shadow: true,
            shadow_angle: 0.0,
            shadow_distance: 10.0,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 2000, "hi")], &style, &CaptionAnimation::default());
        let lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(lines.len(), 2, "shadow behind + text; got: {out}");
        // Default shadow_color #000000FF → &H00000000 (alpha 00), bord 0, blur 4.
        assert!(
            lines[0].starts_with("Dialogue: 0,")
                && lines[0].contains(
                    ",,{\\an2\\pos(970,994)\\bord0\\shad0\\1c&H000000&\\1a&H00&\\blur4}hi"
                ),
            "shadow offset \\pos + style block; got: {}",
            lines[0]
        );
        assert!(
            lines[1].starts_with("Dialogue: 1,") && lines[1].contains(",,hi"),
            "real text is the front (Layer 1) line; got: {}",
            lines[1]
        );

        // 90° → straight down: distance 6 → (0, +6) → \pos(960,1000).
        let s90 = CaptionStyle {
            shadow: true,
            shadow_angle: 90.0,
            shadow_distance: 6.0,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 2000, "x")], &s90, &CaptionAnimation::default());
        assert!(out.contains("\\pos(960,1000)"), "90° offset down; got: {out}");

        // Default angle 135°, distance 4 → (-3, +3) → \pos(957,997).
        let s135 = CaptionStyle { shadow: true, ..CaptionStyle::default() };
        let out = write_ass(&[make_sub(1, 0, 2000, "x")], &s135, &CaptionAnimation::default());
        assert!(out.contains("\\pos(957,997)"), "135° default offset; got: {out}");
    }

    #[test]
    fn test_shadow_color_alpha_bord_blur() {
        // #0000FF80 → BGR FF0000, alpha 0x80 → ass_alpha 255-128=127=0x7F.
        // shadow_size 2 → \bord2; shadow_blur 8 → \blur8.
        let style = CaptionStyle {
            shadow: true,
            shadow_color: "#0000FF80".to_string(),
            shadow_size: 2.0,
            shadow_blur: 8.0,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 1000, "x")], &style, &CaptionAnimation::default());
        assert!(
            out.contains("\\bord2\\shad0\\1c&HFF0000&\\1a&H7F&\\blur8}x"),
            "shadow colour/alpha/bord/blur; got: {out}"
        );
    }

    #[test]
    fn test_shadow_slide_offsets_both_move_endpoints() {
        // slide default: x=960, y=994, off=48, y1=1042. angle 0/distance 10 →
        // +10 x on both endpoints: \move(970,1042,970,994,0,400).
        let style = CaptionStyle {
            shadow: true,
            shadow_angle: 0.0,
            shadow_distance: 10.0,
            ..CaptionStyle::default()
        };
        let anim = CaptionAnimation {
            anim_type: "slide".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&[make_sub(1, 0, 2000, "hi")], &style, &anim);
        assert!(
            out.contains("\\an2\\move(970,1042,970,994,0,400)"),
            "shadow slide offsets both move endpoints; got: {out}"
        );
    }

    // ---- Background pill (measured rounded-rect drawing) ----

    #[test]
    fn test_background_rounded_rect_and_wrapstyle_and_alpha() {
        // Resolve the bundled Outfit font for real glyph measurement.
        let style = CaptionStyle { background: true, ..CaptionStyle::default() };
        let fonts = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let metrics = resolve_font_metrics(&style, Some(&fonts));
        assert!(metrics.is_some(), "bundled Outfit font should resolve for measurement");

        let subs = vec![make_sub(1, 0, 2000, "Hello")];
        let out = write_ass_with_metrics(&subs, &style, &CaptionAnimation::default(), metrics.as_ref());

        // Manual wrap ⇒ WrapStyle 2 so libass renders exactly our lines.
        assert!(out.contains("WrapStyle: 2\n"), "background on must set WrapStyle 2; got: {out}");

        let lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(lines.len(), 2, "background pill (behind) + real text; got: {out}");
        // Behind pill: Layer 0, an7-anchored, positioned, a filled rounded-rect
        // drawing (m … l … b … Bézier corners) in \p1 mode.
        assert!(lines[0].starts_with("Dialogue: 0,"), "bg is behind; got: {}", lines[0]);
        assert!(lines[0].contains("\\an7\\pos("), "bg positioned at pill top-left; got: {}", lines[0]);
        assert!(lines[0].contains("\\p1}m "), "bg enters drawing mode; got: {}", lines[0]);
        assert!(lines[0].contains(" b "), "rounded corners drawn with Bézier; got: {}", lines[0]);
        // Default background_color #000000A6 → alpha 0xA6=166 → ass_alpha 89=0x59.
        assert!(lines[0].contains("\\1c&H000000&"), "bg fill colour; got: {}", lines[0]);
        assert!(lines[0].contains("\\1a&H59&"), "bg alpha via hex_to_ass_color; got: {}", lines[0]);
        // Real text is the front (Layer 1) line.
        assert!(
            lines[1].starts_with("Dialogue: 1,") && lines[1].contains(",,Hello"),
            "real text front; got: {}",
            lines[1]
        );
    }

    #[test]
    fn test_ink_extents_hug_tighter_than_em_box() {
        // The pill sizes to real glyph ink, not the loose font em box — this is
        // what stops the background from "sticking out above the text".
        let fonts = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let data = std::fs::read(fonts.join("Outfit-Bold.ttf")).unwrap();
        let face = ttf_parser::Face::parse(&data, 0).unwrap();
        let m = Measurer::Real(&face);
        let fs = 48.0;
        let (font_asc, font_desc) = m.v_metrics(fs);

        // Caps sit well below the font ascender → ink ascent is strictly less.
        let (caps_asc, caps_desc) = m.ink_extents("HELLO", fs);
        assert!(caps_asc < font_asc, "caps ink top {caps_asc} must be below the ascender {font_asc}");
        assert!(caps_desc < font_desc + 0.5, "caps have ~no descent; got {caps_desc}");

        // A TOP accent (Ó = acute above O) rises above bare caps but still
        // stays inside the font ascender, so the pill keeps it covered.
        let (acc_asc, _) = m.ink_extents("Ó", fs);
        assert!(
            acc_asc > caps_asc && acc_asc <= font_asc + 0.5,
            "accent {acc_asc} must sit above caps {caps_asc} yet within ascender {font_asc}"
        );

        // Descenders push the ink below the baseline.
        let (_, desc_desc) = m.ink_extents("gjy", fs);
        assert!(desc_desc > caps_desc, "descenders extend ink below the baseline");
    }

    #[test]
    fn test_export_ass_uses_measured_wrapping_like_burn() {
        // H6: export_ass now serializes with resolved font metrics — the SAME
        // path the MP4 burn-in uses — so the exported .ass wraps and sizes its
        // background pill identically to the burned video. Previously export_ass
        // called write_ass (Measurer::Rough, ~0.5 em/char) while the burn
        // measured real advances, so a background cue diverged (different wrap
        // points / pill coords in the file vs on screen). This asserts the
        // measured path is what the export now emits AND that it genuinely
        // differs from the old rough path (else the fix would be a no-op).
        let style = CaptionStyle {
            background: true,
            font_id: "Outfit".to_string(),
            ..CaptionStyle::default()
        };
        let fonts = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let metrics = resolve_font_metrics(&style, Some(&fonts));
        assert!(metrics.is_some(), "bundled Outfit metrics must resolve");

        let subs = vec![make_sub(
            1,
            0,
            4000,
            "The quick brown fox jumps over the lazy dog while narrating a long caption",
        )];
        let anim = CaptionAnimation::default();

        // What export_ass (and export_video) now emit — measured wrapping/pill.
        let measured = write_ass_with_metrics(&subs, &style, &anim, metrics.as_ref());
        // What export_ass USED to emit — the rough fallback (write_ass = None).
        let rough = write_ass(&subs, &style, &anim);
        assert_ne!(
            measured, rough,
            "measured serialization must differ from the rough fallback for a background cue \
             (else H6 would be a no-op)"
        );

        // Deterministic: identical input ⇒ byte-identical output (the shared
        // fontdb cache introduces no run-to-run drift).
        let measured2 = write_ass_with_metrics(&subs, &style, &anim, metrics.as_ref());
        assert_eq!(measured, measured2, "measured serialization must be deterministic");
    }

    #[test]
    fn test_background_off_keeps_wrapstyle_zero() {
        // Background off (default) → WrapStyle 0, single Layer 0 text line.
        let out = write_ass(&[make_sub(1, 0, 2000, "Hello")], &CaptionStyle::default(), &CaptionAnimation::default());
        assert!(out.contains("WrapStyle: 0\n"), "background off keeps WrapStyle 0; got: {out}");
        let n = out.lines().filter(|l| l.starts_with("Dialogue:")).count();
        assert_eq!(n, 1, "no decorations → one line; got: {out}");
    }

    #[test]
    fn test_wrap_reserves_first_line_for_speaker_prefix() {
        // Rough measurer = 0.5em/char (deterministic). fs=48 ⇒ 24px/char, ls=0.
        // "aaa bbb ccc ddd" in a 300px region: with no reserve, line 0 packs
        // "aaa bbb ccc" (11 chars = 264px); a large first-line reserve (the
        // "[Speaker] " label) must shrink line 0 so the prefix + words fit.
        let m = Measurer::Rough;
        let text = "aaa bbb ccc ddd";
        let no_reserve = wrap_text(text, 48.0, 0.0, 300.0, 0.0, &m);
        let with_reserve = wrap_text(text, 48.0, 0.0, 300.0, 290.0, &m);
        assert!(
            with_reserve[0].split_whitespace().count() < no_reserve[0].split_whitespace().count(),
            "prefix reserve must shorten line 0: no_reserve={no_reserve:?} with_reserve={with_reserve:?}"
        );
        // Later lines still use the FULL width (reserve is line-0 only).
        assert!(with_reserve.len() >= 2 && !with_reserve[1].is_empty());
    }

    #[test]
    fn test_wrap_subtitle_measures_speaker_reserve() {
        // A speaker cue reserves a non-zero first-line budget; the same cue with
        // no speaker does not — so a speaker can force an extra wrap the plain
        // cue avoids (F2: keeps prefix + line 0 inside the box).
        let m = Measurer::Rough;
        // Narrow region via a small width_pct (clamped to 10 ⇒ ~192px region).
        let style = CaptionStyle { width_pct: 10.0, font_size: 48.0, ..CaptionStyle::default() };
        let mut with_sp = make_sub(1, 0, 2000, "aa bb");
        with_sp.speaker = Some("Speaker 1".to_string());
        let no_sp = make_sub(1, 0, 2000, "aa bb");
        let wrapped_sp = wrap_subtitle(&with_sp, &style, &m);
        let wrapped_plain = wrap_subtitle(&no_sp, &style, &m);
        assert!(
            wrapped_sp.text.matches('\n').count() >= wrapped_plain.text.matches('\n').count(),
            "speaker cue wraps at least as much as the plain cue: sp={:?} plain={:?}",
            wrapped_sp.text, wrapped_plain.text
        );
    }

    #[test]
    fn test_background_degrades_without_font() {
        // No metrics → rough average-advance estimate, but the pill still draws
        // (never a panic or a dropped cue).
        let style = CaptionStyle { background: true, ..CaptionStyle::default() };
        let out = write_ass_with_metrics(&[make_sub(1, 0, 2000, "Hello")], &style, &CaptionAnimation::default(), None);
        assert!(out.contains("WrapStyle: 2\n"), "rough path still manual-wraps; got: {out}");
        let lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(lines.len(), 2, "bg + text even without a font; got: {out}");
        assert!(lines[0].contains("\\p1}m "), "bg still drawn; got: {}", lines[0]);
    }

    #[test]
    fn test_rounded_rect_degenerate_radius_is_plain_rect() {
        // r ≤ 0.5 → a plain rectangle path (no Bézier corners).
        let d = rounded_rect_drawing(100.0, 40.0, 0.0);
        assert_eq!(d, "m 0 0 l 100 0 100 40 0 40 0 0");
        assert!(!d.contains('b'), "degenerate radius has no Bézier; got: {d}");
    }

    // ---- Z-order ----

    #[test]
    fn test_z_order_layers_background_shadow_glow_text() {
        // background(0) < shadow(1) < glow(2) < text(3), lowest renders behind.
        let style = CaptionStyle {
            background: true,
            shadow: true,
            glow: true,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 2000, "Hi")], &style, &CaptionAnimation::default());
        let lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(lines.len(), 4, "bg + shadow + glow + text; got: {out}");
        assert!(lines[0].starts_with("Dialogue: 0,") && lines[0].contains("\\p1}"), "bg Layer 0; got: {}", lines[0]);
        assert!(lines[1].starts_with("Dialogue: 1,") && lines[1].contains("\\pos("), "shadow Layer 1; got: {}", lines[1]);
        assert!(lines[2].starts_with("Dialogue: 2,") && lines[2].contains("\\blur"), "glow Layer 2; got: {}", lines[2]);
        assert!(lines[3].starts_with("Dialogue: 3,") && lines[3].contains(",,Hi"), "text Layer 3; got: {}", lines[3]);
    }
}

use super::style::{ass_font_name, CaptionAnimation, CaptionStyle};
use super::types::Subtitle;

// Reference canvas — matches the Player overlay, which scales fontSize/1080
// (Player.tsx). All CaptionStyle pixel values are defined at this resolution.
const PLAY_RES_X: f64 = 1920.0;
const PLAY_RES_Y: f64 = 1080.0;

pub fn write_ass(subtitles: &[Subtitle], style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    let mut output = String::new();

    output.push_str("[Script Info]\n");
    output.push_str("Title: TranscriptPRO Export\n");
    output.push_str("ScriptType: v4.00+\n");
    output.push_str("Collisions: Normal\n");
    output.push_str("PlayDepth: 0\n");
    output.push_str("PlayResX: 1920\n");
    output.push_str("PlayResY: 1080\n");
    output.push_str("WrapStyle: 0\n");
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
        // When glow is enabled we paint a colored-halo line BEHIND the real
        // caption: the glow line sits at Layer 0, the real text at Layer 1 (so
        // it draws on top). With glow off we emit a single Layer 0 line exactly
        // as before — byte-identical golden output.
        if style.glow {
            output.push_str(&format!(
                "Dialogue: 0,{},{},Default,,{},{},{},,{}\n",
                start,
                end,
                evt_ml,
                evt_mr,
                evt_mv,
                glow_text(sub, style, animation)
            ));
            output.push_str(&format!(
                "Dialogue: 1,{},{},Default,,{},{},{},,{}\n",
                start,
                end,
                evt_ml,
                evt_mr,
                evt_mv,
                dialogue_text(sub, style, animation)
            ));
        } else {
            output.push_str(&format!(
                "Dialogue: 0,{},{},Default,,{},{},{},,{}\n",
                start,
                end,
                evt_ml,
                evt_mr,
                evt_mv,
                dialogue_text(sub, style, animation)
            ));
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
/// For every type except `slide` this is `0,0,0`, which ASS reads as "inherit
/// the Style margins" — so wrapping and placement follow the Style box exactly
/// as before. `slide` uses `\move`, and libass treats a `\move`/`\pos` event
/// with 0 event-margins as full-frame width for line wrapping (it stops
/// inheriting the Style MarginL/R), so a long slide cue would wrap wider than
/// every other type. Emitting the box margins explicitly on the event pins the
/// wrap box back to the configured width, matching the non-slide cues and the
/// CSS preview. The `\move` coordinates still drive the final position.
fn dialogue_margins(style: &CaptionStyle, animation: &CaptionAnimation) -> (i64, i64, i64) {
    if animation.anim_type == "slide" {
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
        "pop" => format!("{}{}", animation_prefix(style, animation).unwrap_or_default(), plain()),
        "blur" => format!("{}{}", animation_prefix(style, animation).unwrap_or_default(), plain()),
        "slide" => format!("{}{}", animation_prefix(style, animation).unwrap_or_default(), plain()),
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
        "pop" => Some(format!("{{\\fscx0\\fscy0\\t(0,{},\\fscx100\\fscy100)}}", d)),
        "blur" => Some(format!("{{\\blur{}\\t(0,{},\\blur0)}}", BLUR_ENTRANCE_RADIUS, d)),
        "slide" => {
            let (x, y, an) = anchor_point(style);
            let off = style.font_size.round().max(24.0) as i64;
            let y1 = y + off;
            Some(format!("{{\\an{}\\move({},{},{},{},0,{})}}", an, x, y1, x, y, d))
        }
        _ => None,
    }
}

/// The glow override block painted on the BEHIND (Layer 0) line: a transparent
/// fill (`\1a&HFF&`) with an opaque, blurred, coloured border so only a soft
/// halo shows. `glow_strength` drives border width `\bord` (clamp 2..=20 of
/// half the strength) and blur radius `\blur` (clamp 4..=40 of the strength).
/// The glow colour goes through the same hex→ASS `&HAABBGGRR` conversion as the
/// Style colours; its alpha byte is folded into `\3a` and the BGR into `\3c`.
///
/// When the animation type is `blur`, its own `\blur`/`\t(...,\blur0)` already
/// drives the line's blur; emitting the glow's static `\blur<r>` too would
/// double-apply the tag (the later block would clobber the animation), so we
/// omit the glow's static blur in that one case and let the animation drive it.
fn glow_prefix(style: &CaptionStyle, anim_is_blur: bool) -> String {
    // "&HAABBGGRR" — always "&H" + 8 hex digits (valid parse or 6-digit
    // fallback), so the byte slices below are always in range.
    let ass = hex_to_ass_color(&style.glow_color, "22D3EE");
    let hexpart = &ass[2..]; // "AABBGGRR"
    let alpha = &hexpart[0..2]; // "AA"
    let bgr = &hexpart[2..]; // "BBGGRR"
    let b = (style.glow_strength * 0.5).round().clamp(2.0, 20.0) as i64;
    let r = style.glow_strength.round().clamp(4.0, 40.0) as i64;
    if anim_is_blur {
        format!(
            "{{\\1a&HFF&\\3a&H{}&\\3c&H{}&\\bord{}\\shad0}}",
            alpha, bgr, b
        )
    } else {
        format!(
            "{{\\1a&HFF&\\3a&H{}&\\3c&H{}&\\bord{}\\shad0\\blur{}}}",
            alpha, bgr, b, r
        )
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

/// Escape literal `{` / `}` so ASS renderers show them instead of parsing an
/// override-tag block. `\{` / `\}` are the conventional literal-brace escapes.
fn escape_braces(text: &str) -> String {
    text.replace('{', "\\{").replace('}', "\\}")
}

/// Generate the Style line from a CaptionStyle. lineHeight and align are
/// intentionally ignored — they are preview-only (no honest ASS Style mapping
/// exists for them). glow* IS exported, but not here: it becomes a second
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

/// Compute the on-canvas anchor point (x, y, an) for a cue, where `an` is the
/// clamped boxPosition (numpad alignment 1..=9, else 2). The point matches where
/// the Style Alignment + margins already place the line, so \pos/\move-based
/// animations rest exactly where a non-animated line would sit.
fn anchor_point(style: &CaptionStyle) -> (i64, i64, u8) {
    let a: u8 = if (1..=9).contains(&style.box_position) {
        style.box_position
    } else {
        2
    };
    let (ml, mr, mv) = box_margins(style);
    let col = (a - 1) % 3; // 0=left 1=center 2=right
    let x = match col {
        0 => ml,
        2 => (PLAY_RES_X as i64) - mr,
        _ => (ml + (PLAY_RES_X as i64 - mr)) / 2,
    };
    let y = if a <= 3 {
        (PLAY_RES_Y as i64) - mv
    } else if a <= 6 {
        (PLAY_RES_Y as i64) / 2
    } else {
        mv
    };
    (x, y, a)
}

fn style_line(style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    // Clamp everything crossing IPC before use.
    let box_position = if (1..=9).contains(&style.box_position) {
        style.box_position
    } else {
        2
    };
    let font_size = style.font_size.max(0.0);
    let outline_width = style.outline_width.max(0.0);
    let shadow_depth = style.shadow_depth.max(0.0);

    // Karaoke uses ASS \k semantics: unsung text is SecondaryColour (the base
    // text colour) and sweeps to PrimaryColour (the highlight) as it's "sung".
    // Every other type keeps Primary = Secondary = base text colour.
    let (primary, secondary) = if animation.anim_type == "karaoke" {
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
        if style.shadow {
            fmt_num(shadow_depth)
        } else {
            "0".to_string()
        },
        box_position,
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
        let style = CaptionStyle {
            outline: false,
            shadow: true,
            shadow_depth: 3.0,
            ..CaptionStyle::default()
        };
        let line = style_line(&style, &CaptionAnimation::default());
        // ...Angle,BorderStyle,Outline,Shadow,Alignment...
        assert!(line.contains(",0,1,0,3,2,"));
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
        let style = CaptionStyle {
            box_position: 7,
            margin_v_pct: 8.0,
            ..CaptionStyle::default()
        };
        let line = style_line(&style, &CaptionAnimation::default());
        // Alignment 7 (top-left column), MarginL 38 (2% side inset),
        // MarginR = round(1920*(98-62)/100) = 691, MarginV 86.
        assert!(line.contains(",7,38,691,86,1"));

        let left = CaptionStyle {
            box_position: 1,
            ..CaptionStyle::default()
        };
        assert!(style_line(&left, &CaptionAnimation::default()).contains(",1,38,691,86,1"));

        // Out-of-range boxPosition clamps to 2 (bottom-center).
        let bad = CaptionStyle {
            box_position: 0,
            ..CaptionStyle::default()
        };
        assert!(style_line(&bad, &CaptionAnimation::default()).contains(",2,365,365,86,1"));
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
    fn test_animation_pop() {
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "pop".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(",,{\\fscx0\\fscy0\\t(0,400,\\fscx100\\fscy100)}hello world\n"),
            "got: {out}"
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
        assert!(!out.contains("\\1a&HFF&"), "no glow tags when glow off; got: {out}");
        // Byte-identical to the pre-glow golden line.
        assert!(out.contains("Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world\n"));
    }

    #[test]
    fn test_glow_on_emits_behind_line_and_bumps_real_line() {
        // glow on → a Layer 0 glow line (transparent fill, opaque coloured
        // blurred border) BEHIND, and the real text bumped to Layer 1.
        let style = CaptionStyle {
            glow: true,
            ..CaptionStyle::default()
        };
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let out = write_ass(&subs, &style, &CaptionAnimation::default());
        let dialogue_lines: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(dialogue_lines.len(), 2, "glow on must emit two lines; got: {out}");

        // Glow line: Layer 0, whole-text halo. Default glowStrength 12 →
        // \bord round(12*0.5)=6, \blur round(12)=12; glowColor #22D3EE →
        // &H00EED322 → \3c&HEED322&, \3a&H00&.
        assert!(
            dialogue_lines[0].contains(
                "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\1a&HFF&\\3a&H00&\\3c&HEED322&\\bord6\\shad0\\blur12}hello world"
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
            dialogue_lines[0].contains(",,{\\fad(400,400)}{\\1a&HFF&\\3a&H00&\\3c&HEED322&\\bord6\\shad0\\blur12}hello world"),
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
        // Glow block ends at \shad0 (no \blur<r>); the entrance \blur24 leads.
        assert!(
            dialogue_lines[0].contains(",,{\\blur24\\t(0,400,\\blur0)}{\\1a&HFF&\\3a&H00&\\3c&HEED322&\\bord6\\shad0}hello world"),
            "glow line omits static blur under blur animation; got: {out}"
        );
    }

    #[test]
    fn test_glow_color_alpha_folds_into_3a() {
        // A glowColor with alpha folds the inverse-alpha byte into \3a and the
        // BGR into \3c. #22D3EE80 → &H7FEED322 → \3a&H7F&, \3c&HEED322&.
        let style = CaptionStyle {
            glow: true,
            glow_color: "#22D3EE80".to_string(),
            glow_strength: 20.0,
            ..CaptionStyle::default()
        };
        let subs = vec![make_sub(1, 0, 2000, "hi")];
        let out = write_ass(&subs, &style, &CaptionAnimation::default());
        // glowStrength 20 → \bord round(10)=10, \blur round(20)=20.
        assert!(
            out.contains("{\\1a&HFF&\\3a&H7F&\\3c&HEED322&\\bord10\\shad0\\blur20}hi"),
            "glow alpha folded into \\3a; got: {out}"
        );
    }

    #[test]
    fn test_glow_strength_clamps() {
        // Tiny strength clamps \bord to 2 and \blur to 4.
        let style = CaptionStyle {
            glow: true,
            glow_strength: 1.0,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 1000, "x")], &style, &CaptionAnimation::default());
        assert!(out.contains("\\bord2\\shad0\\blur4}x"), "low clamp; got: {out}");

        // Huge strength clamps \bord to 20 and \blur to 40.
        let style = CaptionStyle {
            glow: true,
            glow_strength: 500.0,
            ..CaptionStyle::default()
        };
        let out = write_ass(&[make_sub(1, 0, 1000, "x")], &style, &CaptionAnimation::default());
        assert!(out.contains("\\bord20\\shad0\\blur40}x"), "high clamp; got: {out}");
    }

    #[test]
    fn test_animation_slide() {
        // Default style: box 2, width 62, marginV 8%, fontSize 48.
        // x = 960 (center), y = 1080 - round(1080*0.08=86) = 994,
        // off = 48 → y1 = 1042, an = 2.
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        let anim = CaptionAnimation {
            anim_type: "slide".to_string(),
            duration_ms: 400.0,
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(
            out.contains(",,{\\an2\\move(960,1042,960,994,0,400)}hello world\n"),
            "got: {out}"
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
        assert!(
            out.contains("Default,,365,365,86,,{\\an2\\move("),
            "slide should carry box margins on the event; got: {out}"
        );

        // Non-slide types keep 0,0,0 (inherit Style margins) — unchanged.
        let anim = CaptionAnimation {
            anim_type: "pop".to_string(),
            ..CaptionAnimation::default()
        };
        let out = write_ass(&subs, &CaptionStyle::default(), &anim);
        assert!(out.contains("Default,,0,0,0,,{\\fscx0"), "got: {out}");
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
}

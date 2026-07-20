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

    for sub in subtitles {
        output.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            format_ass_timestamp(sub.start_time),
            format_ass_timestamp(sub.end_time),
            dialogue_text(sub, style, animation)
        ));
    }

    output
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
///   - everything else (none/slide/pop/typewriter/blur) → plain body.
fn dialogue_text(sub: &Subtitle, style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    let maybe_upper = |s: String| -> String {
        if style.uppercase {
            s.to_uppercase()
        } else {
            s
        }
    };

    // Base body without the speaker prefix (braces escaped, \n -> \N).
    let body = maybe_upper(escape_braces(&sub.text).replace('\n', "\\N"));
    // Speaker prefix "[Speaker] " (with trailing space), escaped + uppercased
    // the same way, kept separate so karaoke can lead with it as plain text.
    let speaker_prefix = sub
        .speaker
        .as_ref()
        .map(|sp| maybe_upper(format!("[{}] ", escape_braces(sp))));

    let plain = || match &speaker_prefix {
        Some(p) => format!("{}{}", p, body),
        None => body.clone(),
    };

    match animation.anim_type.as_str() {
        "fade" => {
            let d = animation.duration_ms.round().max(0.0) as i64;
            format!("{{\\fad({},{})}}{}", d, d, plain())
        }
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
        // none / slide / pop / typewriter / blur — preview-only, plain body.
        _ => plain(),
    }
}

/// Escape literal `{` / `}` so ASS renderers show them instead of parsing an
/// override-tag block. `\{` / `\}` are the conventional literal-brace escapes.
fn escape_braces(text: &str) -> String {
    text.replace('{', "\\{").replace('}', "\\}")
}

/// Generate the Style line from a CaptionStyle. lineHeight, glow*, and align
/// are intentionally ignored — they are preview-only per the decision in
/// docs/new-design-agents.md (no honest ASS mapping exists for them).
fn style_line(style: &CaptionStyle, animation: &CaptionAnimation) -> String {
    // Clamp everything crossing IPC before use.
    let box_position = if (1..=9).contains(&style.box_position) {
        style.box_position
    } else {
        2
    };
    let width_pct = style.width_pct.clamp(10.0, 100.0);
    let margin_v_pct = style.margin_v_pct.clamp(0.0, 45.0);
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

    // Margins at PlayRes 1920x1080, mirroring captionBoxCss in
    // src/lib/caption-style.ts: 2% side inset for left/right columns,
    // symmetric (100 - width) / 2 for the center column.
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
    fn test_unknown_font_falls_back_to_outfit() {
        let style = CaptionStyle {
            font_id: "nonsense".to_string(),
            ..CaptionStyle::default()
        };
        assert!(style_line(&style, &CaptionAnimation::default()).starts_with("Style: Default,Outfit,"));
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
    fn test_animation_preview_only_types_yield_plain_body() {
        let subs = vec![make_sub(1, 0, 2000, "hello world")];
        for t in ["none", "slide", "pop", "typewriter", "blur"] {
            let anim = CaptionAnimation {
                anim_type: t.to_string(),
                ..CaptionAnimation::default()
            };
            let out = write_ass(&subs, &CaptionStyle::default(), &anim);
            assert!(out.contains(",,hello world\n"), "type {t} should be plain");
            assert!(!out.contains("\\fad"), "type {t} must not emit \\fad");
            assert!(!out.contains("\\k"), "type {t} must not emit \\k");
            // Preview-only types keep Primary = Secondary = base text colour.
            let line = style_line(&CaptionStyle::default(), &anim);
            assert!(line.contains(",&H00FFFFFF,&H00FFFFFF,"));
        }
    }
}

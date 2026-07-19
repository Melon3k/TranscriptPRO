use super::style::{ass_font_name, CaptionStyle};
use super::types::Subtitle;

// Reference canvas — matches the Player overlay, which scales fontSize/1080
// (Player.tsx). All CaptionStyle pixel values are defined at this resolution.
const PLAY_RES_X: f64 = 1920.0;
const PLAY_RES_Y: f64 = 1080.0;

pub fn write_ass(subtitles: &[Subtitle], style: &CaptionStyle) -> String {
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
    output.push_str(&style_line(style));
    output.push('\n');

    output.push_str("[Events]\n");
    output.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");

    for sub in subtitles {
        // Escape literal braces first — ASS renderers would otherwise parse
        // {...} as an override-tag block and hide the text. \{ / \} render
        // as literal braces in libass/VLC/Aegisub.
        let text = escape_braces(&sub.text);
        // ASS uses \N for line breaks
        let text = text.replace('\n', "\\N");
        let text = if let Some(ref speaker) = sub.speaker {
            format!("[{}] {}", escape_braces(speaker), text)
        } else {
            text
        };
        // `uppercase: true` is honored by transforming the text payload itself
        // (Unicode-aware) — the timestamps/format around it are untouched.
        let text = if style.uppercase {
            text.to_uppercase()
        } else {
            text
        };
        output.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            format_ass_timestamp(sub.start_time),
            format_ass_timestamp(sub.end_time),
            text
        ));
    }

    output
}

/// Escape literal `{` / `}` so ASS renderers show them instead of parsing an
/// override-tag block. `\{` / `\}` are the conventional literal-brace escapes.
fn escape_braces(text: &str) -> String {
    text.replace('{', "\\{").replace('}', "\\}")
}

/// Generate the Style line from a CaptionStyle. lineHeight, glow*, and align
/// are intentionally ignored — they are preview-only per the decision in
/// docs/new-design-agents.md (no honest ASS mapping exists for them).
fn style_line(style: &CaptionStyle) -> String {
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

    let primary = hex_to_ass_color(&style.text_color, "FFFFFF");
    // SecondaryColour = PrimaryColour for now; item C karaoke differentiates.
    let secondary = primary.clone();
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

/// Parse "#RRGGBB" (case-insensitive) into ASS "&H00BBGGRR" (alpha 00 =
/// opaque, BGR byte order). On malformed input returns "&H00" + `fallback`,
/// where `fallback` is already in BGR order (e.g. "FFFFFF" / "000000").
fn hex_to_ass_color(hex: &str, fallback: &str) -> String {
    let parsed = hex.strip_prefix('#').and_then(|h| {
        if h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()) {
            let r = u8::from_str_radix(&h[0..2], 16).ok()?;
            let g = u8::from_str_radix(&h[2..4], 16).ok()?;
            let b = u8::from_str_radix(&h[4..6], 16).ok()?;
            Some(format!("&H00{:02X}{:02X}{:02X}", b, g, r))
        } else {
            None
        }
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
        let out = write_ass(&subs, &CaptionStyle::default());
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
        let out = write_ass(&subs, &CaptionStyle::default());
        assert!(out.contains("line one\\Nline two"));
    }

    #[test]
    fn test_default_style_golden_line() {
        let out = write_ass(&[], &CaptionStyle::default());
        assert!(out.contains(
            "Style: Default,Outfit,48,&H00FFFFFF,&H00FFFFFF,&H00160F0B,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,365,365,86,1"
        ));
    }

    #[test]
    fn test_script_info_play_res() {
        let out = write_ass(&[], &CaptionStyle::default());
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
        let line = style_line(&style);
        // Bold 0, Italic -1, Underline 0, StrikeOut 0
        assert!(line.contains(",0,-1,0,0,"));

        let default_line = style_line(&CaptionStyle::default());
        // Bold -1, Italic 0
        assert!(default_line.contains(",-1,0,0,0,"));
    }

    #[test]
    fn test_hex_to_ass_color() {
        assert_eq!(hex_to_ass_color("#22D3EE", "FFFFFF"), "&H00EED322");
        assert_eq!(hex_to_ass_color("#ffffff", "000000"), "&H00FFFFFF");
        // Malformed input falls back (fallback is already BGR).
        assert_eq!(hex_to_ass_color("oops", "FFFFFF"), "&H00FFFFFF");
        assert_eq!(hex_to_ass_color("#12345", "000000"), "&H00000000");
    }

    #[test]
    fn test_outline_shadow_fields() {
        let style = CaptionStyle {
            outline: false,
            shadow: true,
            shadow_depth: 3.0,
            ..CaptionStyle::default()
        };
        let line = style_line(&style);
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
        let out = write_ass(&subs, &style);
        assert!(out.contains("ŻÓŁĆ GĘŚ"));
        // Timestamps stay untouched.
        assert!(out.contains("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ŻÓŁĆ GĘŚ"));

        let mut with_speaker = make_sub(1, 0, 1000, "hello");
        with_speaker.speaker = Some("Speaker 1".to_string());
        let out = write_ass(&[with_speaker], &style);
        assert!(out.contains("[SPEAKER 1] HELLO"));
    }

    #[test]
    fn test_brace_escaping() {
        let subs = vec![make_sub(1, 0, 1000, "{whispers} come here")];
        let out = write_ass(&subs, &CaptionStyle::default());
        assert!(out.contains(",,\\{whispers\\} come here\n"));
        assert!(!out.contains(",,{whispers}"));

        // Speaker names with braces are escaped too.
        let mut sub = make_sub(1, 0, 1000, "use {x} here");
        sub.speaker = Some("{Narrator}".to_string());
        let out = write_ass(&[sub], &CaptionStyle::default());
        assert!(out.contains("[\\{Narrator\\}] use \\{x\\} here"));

        // Escaping survives the uppercase transform.
        let style = CaptionStyle {
            uppercase: true,
            ..CaptionStyle::default()
        };
        let subs = vec![make_sub(1, 0, 1000, "{quiet} ok")];
        let out = write_ass(&subs, &style);
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
        let line = style_line(&style);
        // Alignment 7 (top-left column), MarginL 38 (2% side inset),
        // MarginR = round(1920*(98-62)/100) = 691, MarginV 86.
        assert!(line.contains(",7,38,691,86,1"));

        let left = CaptionStyle {
            box_position: 1,
            ..CaptionStyle::default()
        };
        assert!(style_line(&left).contains(",1,38,691,86,1"));

        // Out-of-range boxPosition clamps to 2 (bottom-center).
        let bad = CaptionStyle {
            box_position: 0,
            ..CaptionStyle::default()
        };
        assert!(style_line(&bad).contains(",2,365,365,86,1"));
    }

    #[test]
    fn test_unknown_font_falls_back_to_outfit() {
        let style = CaptionStyle {
            font_id: "nonsense".to_string(),
            ..CaptionStyle::default()
        };
        assert!(style_line(&style).starts_with("Style: Default,Outfit,"));
    }

    #[test]
    fn test_fractional_font_size_formatting() {
        let style = CaptionStyle {
            font_size: 48.5,
            ..CaptionStyle::default()
        };
        assert!(style_line(&style).contains("Style: Default,Outfit,48.5,"));
        assert_eq!(fmt_num(48.5), "48.5");
        assert_eq!(fmt_num(48.0), "48");
        assert_eq!(fmt_num(48.50), "48.5");
        assert_eq!(fmt_num(1.25), "1.25");
    }
}

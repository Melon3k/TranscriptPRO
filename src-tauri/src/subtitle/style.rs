use serde::{Deserialize, Serialize};

/// Caption style crossing IPC from the frontend styleStore.
///
/// Mirror of `src/types/captionStyle.ts` + `DEFAULT_CAPTION_STYLE` in
/// `src/lib/caption-style.ts` — keep field names (camelCase over IPC) and
/// defaults in sync on both sides.
///
/// Container-level `#[serde(default)]` gives forward/backward compat: an
/// older/newer frontend omitting fields deserializes to the defaults below,
/// and unknown extra fields are ignored by serde.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptionStyle {
    /// Font FAMILY name (e.g. "Outfit", "Arial"); empty -> Outfit.
    pub font_id: String,
    /// px at the 1080p reference canvas.
    pub font_size: f64,
    /// px at reference; maps to ASS Spacing.
    pub letter_spacing: f64,
    /// "left" | "center" | "right" — exported as the numpad Alignment COLUMN
    /// (justification within the box); see `effective_alignment` in ass.rs.
    pub align: String,
    pub bold: bool,
    pub italic: bool,
    /// Applied by uppercasing Dialogue text in `write_ass`.
    pub uppercase: bool,
    pub outline: bool,
    pub outline_width: f64,
    /// Drop shadow, exported as an OFFSET behind-layer duplicate of the cue text
    /// (see `shadow_text` in ass.rs), NOT the ASS Style `Shadow` depth field.
    pub shadow: bool,
    /// Shadow direction in degrees. Screen coords: 0° = +x (right), 90° = +y
    /// (down). Drives the `\pos` offset `(distance*cos θ, distance*sin θ)`.
    pub shadow_angle: f64,
    /// Shadow offset length in px at the 1080p reference canvas.
    pub shadow_distance: f64,
    /// Shadow border thickness in px (`\bord` on the offset copy); 0 = none.
    pub shadow_size: f64,
    /// Shadow blur radius in px (`\blur` on the offset copy).
    pub shadow_blur: f64,
    /// Text-hugging rounded background pill, exported as a behind-layer ASS
    /// drawing (see the background block in ass.rs).
    pub background: bool,
    /// "#RRGGBBAA" fill colour for the background pill.
    pub background_color: String,
    /// Corner radius of the background pill in px at the 1080p reference canvas.
    pub background_radius: f64,
    /// Padding around the measured text block in px at 1080p (all four sides).
    pub background_spread: f64,
    /// Preview-only — no faithful ASS mapping.
    pub glow: bool,
    /// Preview-only.
    pub glow_strength: f64,
    /// "#RRGGBBAA"
    pub text_color: String,
    /// "#RRGGBBAA"
    pub outline_color: String,
    /// "#RRGGBBAA"
    pub shadow_color: String,
    /// Preview-only.
    pub glow_color: String,
    /// 1..=9 numpad convention. Drives the box REGION (margins) + vertical
    /// band; combined with `align`'s column into the exported ASS Alignment
    /// (see `effective_alignment`). Out-of-range -> clamp to 2.
    pub box_position: u8,
    /// Caption box width in % of the stage; clamp to 10.0..=100.0.
    pub width_pct: f64,
    /// Vertical margin in % of stage height; clamp to 0.0..=45.0.
    pub margin_v_pct: f64,
}

impl Default for CaptionStyle {
    // MUST mirror DEFAULT_CAPTION_STYLE in src/lib/caption-style.ts.
    fn default() -> Self {
        Self {
            font_id: "Outfit".to_string(),
            font_size: 48.0,
            letter_spacing: 0.0,
            align: "center".to_string(),
            bold: true,
            italic: false,
            uppercase: false,
            outline: true,
            outline_width: 2.0,
            shadow: false,
            shadow_angle: 135.0,
            shadow_distance: 4.0,
            shadow_size: 0.0,
            shadow_blur: 4.0,
            background: false,
            background_color: "#000000A6".to_string(),
            background_radius: 8.0,
            background_spread: 12.0,
            glow: false,
            glow_strength: 12.0,
            text_color: "#FFFFFFFF".to_string(),
            outline_color: "#0B0F16FF".to_string(),
            shadow_color: "#000000FF".to_string(),
            glow_color: "#22D3EEFF".to_string(),
            box_position: 2,
            width_pct: 62.0,
            margin_v_pct: 8.0,
        }
    }
}

/// Global caption animation crossing IPC from the frontend styleStore.
///
/// Mirror of `CaptionAnimation` in `src/types/captionStyle.ts` +
/// `DEFAULT_CAPTION_ANIMATION` in `src/lib/caption-animation.ts` — keep field
/// names (camelCase over IPC) and defaults in sync on both sides.
///
/// Every type except `none` is exported to ASS override tags by
/// `ass::dialogue_text`: `fade`→`\fad`, `karaoke`→`\k` + Primary/Secondary
/// colour split, `pop`→`\fscx/\fscy \t`, `blur`→`\blur \t`, `slide`→`\move`,
/// `typewriter`→ per-char `\alpha \t`. (Per-word stagger and CSS easing were
/// preview-only — ASS `\t`/`\fad` transitions are linear — and have been
/// removed so the UI only exposes what exports.)
///
/// Container-level `#[serde(default)]` gives forward/backward compat, matching
/// `CaptionStyle`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptionAnimation {
    /// "none" | "fade" | "slide" | "pop" | "typewriter" | "karaoke" | "blur".
    /// `type` is a Rust keyword → field renamed, serde maps it to "type".
    #[serde(rename = "type")]
    pub anim_type: String,
    /// Fade in+out length / entrance length, in ms.
    pub duration_ms: f64,
    /// "#RRGGBB" — karaoke sung-word colour → ASS PrimaryColour.
    pub highlight_color: String,
}

impl Default for CaptionAnimation {
    // MUST mirror DEFAULT_CAPTION_ANIMATION in src/lib/caption-animation.ts.
    fn default() -> Self {
        Self {
            anim_type: "none".to_string(),
            duration_ms: 400.0,
            highlight_color: "#22D3EE".to_string(),
        }
    }
}

/// ASS Fontname is the caption font FAMILY name written straight through
/// (the frontend stores the resolved family). The value is written verbatim
/// into the comma-delimited, newline-terminated ASS `Style:` line, which has
/// NO escaping for those separators — a family name may legally contain a
/// comma (fontdb name-table strings like "Foo, Condensed") or, if hand-edited,
/// a control char. Any such character is stripped: a stray comma would shift
/// every later Style field (libass then mis-parses size/colour/alignment or
/// rejects the style) and a newline would terminate the line early. Whatever
/// survives is what libass matches against installed faces; an empty result
/// (or empty input) -> "Outfit" (the bundled default) so the line is never
/// malformed.
pub fn ass_font_name(font_id: &str) -> String {
    // `is_control()` covers CR/LF/NUL and other control chars; the comma is the
    // Style-field separator and has no ASS escape.
    let cleaned: String = font_id
        .chars()
        .filter(|&c| c != ',' && !c.is_control())
        .collect();
    let f = cleaned.trim();
    if f.is_empty() { "Outfit".to_string() } else { f.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_matches_frontend_contract() {
        let s = CaptionStyle::default();
        assert_eq!(s.font_id, "Outfit");
        assert_eq!(s.font_size, 48.0);
        assert_eq!(s.box_position, 2);
        assert_eq!(s.width_pct, 62.0);
        assert_eq!(s.margin_v_pct, 8.0);
        assert!(s.bold && s.outline && !s.italic && !s.shadow && !s.glow);
        // New shadow + background contract.
        assert!(!s.background);
        assert_eq!(s.shadow_angle, 135.0);
        assert_eq!(s.shadow_distance, 4.0);
        assert_eq!(s.shadow_size, 0.0);
        assert_eq!(s.shadow_blur, 4.0);
        assert_eq!(s.background_color, "#000000A6");
        assert_eq!(s.background_radius, 8.0);
        assert_eq!(s.background_spread, 12.0);
        assert_eq!(s.shadow_color, "#000000FF");
    }

    #[test]
    fn test_legacy_shadow_depth_ignored_new_fields_default() {
        // Old persisted JSON carries `shadowDepth` (removed) and omits the new
        // shadow/background fields — serde(default) drops the unknown key and
        // fills the rest from Default. No migration needed in Rust.
        let s: CaptionStyle = serde_json::from_str(
            r##"{"shadow": true, "shadowDepth": 6, "shadowColor": "#112233FF"}"##,
        )
        .unwrap();
        assert!(s.shadow);
        assert_eq!(s.shadow_color, "#112233FF");
        assert_eq!(s.shadow_angle, 135.0);
        assert_eq!(s.shadow_distance, 4.0);
        assert_eq!(s.shadow_blur, 4.0);
        assert!(!s.background);
    }

    #[test]
    fn test_serde_default_and_unknown_fields() {
        // Older frontend omitting fields + newer frontend sending extras.
        let s: CaptionStyle =
            serde_json::from_str(r#"{"fontSize": 60, "futureField": true}"#).unwrap();
        assert_eq!(s.font_size, 60.0);
        assert_eq!(s.font_id, "Outfit");
        assert_eq!(s.box_position, 2);
    }

    #[test]
    fn test_animation_default_matches_frontend_contract() {
        let a = CaptionAnimation::default();
        assert_eq!(a.anim_type, "none");
        assert_eq!(a.duration_ms, 400.0);
        assert_eq!(a.highlight_color, "#22D3EE");
    }

    #[test]
    fn test_animation_serde_type_rename_and_defaults() {
        // `type` maps to anim_type; missing fields fall back to defaults.
        let a: CaptionAnimation =
            serde_json::from_str(r#"{"type": "karaoke", "durationMs": 600}"#).unwrap();
        assert_eq!(a.anim_type, "karaoke");
        assert_eq!(a.duration_ms, 600.0);
        assert_eq!(a.highlight_color, "#22D3EE");
        // A legacy payload with the removed preview-only keys still loads
        // (serde ignores unknown fields under the container `default`).
        let legacy: CaptionAnimation = serde_json::from_str(
            r#"{"type":"fade","perWordDelayMs":80,"easing":"linear"}"#,
        )
        .unwrap();
        assert_eq!(legacy.anim_type, "fade");
    }

    #[test]
    fn test_ass_font_name_mapping() {
        assert_eq!(ass_font_name("Outfit"), "Outfit");
        assert_eq!(ass_font_name("Arial"), "Arial");
        assert_eq!(ass_font_name("  Helvetica Neue "), "Helvetica Neue");
        assert_eq!(ass_font_name(""), "Outfit");
    }

    #[test]
    fn test_ass_font_name_strips_style_line_breakers() {
        // A comma would shift every later Style field; strip it.
        assert_eq!(ass_font_name("Foo, Condensed"), "Foo Condensed");
        // Newline / CR would terminate the Style line early.
        assert_eq!(ass_font_name("Foo\nBar"), "FooBar");
        assert_eq!(ass_font_name("Foo\r\nBar"), "FooBar");
        // A NUL (and other control chars) are dropped too.
        assert_eq!(ass_font_name("Foo\u{0}Bar"), "FooBar");
        // A name consisting only of separators collapses to the default.
        assert_eq!(ass_font_name(",,,"), "Outfit");
    }
}

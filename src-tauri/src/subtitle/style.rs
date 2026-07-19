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
    /// "outfit" | "inter" | "jetbrains-mono"; unknown -> Outfit.
    pub font_id: String,
    /// px at the 1080p reference canvas.
    pub font_size: f64,
    /// px at reference; maps to ASS Spacing.
    pub letter_spacing: f64,
    /// NOT exportable to ASS (no Style field) — carried for contract symmetry.
    pub line_height: f64,
    /// "left" | "center" | "right" — preview-only, not exported (ASS ties
    /// justification to the numpad Alignment, driven by `box_position`).
    pub align: String,
    pub bold: bool,
    pub italic: bool,
    /// Applied by uppercasing Dialogue text in `write_ass`.
    pub uppercase: bool,
    pub outline: bool,
    pub outline_width: f64,
    pub shadow: bool,
    pub shadow_depth: f64,
    /// Preview-only — no faithful ASS mapping.
    pub glow: bool,
    /// Preview-only.
    pub glow_strength: f64,
    /// "#RRGGBB"
    pub text_color: String,
    /// "#RRGGBB"
    pub outline_color: String,
    /// "#RRGGBB"
    pub shadow_color: String,
    /// Preview-only.
    pub glow_color: String,
    /// 1..=9 numpad convention; written straight into the ASS Style
    /// Alignment field. Out-of-range -> clamp to 2.
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
            font_id: "outfit".to_string(),
            font_size: 48.0,
            letter_spacing: 0.0,
            line_height: 1.15,
            align: "center".to_string(),
            bold: true,
            italic: false,
            uppercase: false,
            outline: true,
            outline_width: 2.0,
            shadow: false,
            shadow_depth: 2.0,
            glow: false,
            glow_strength: 12.0,
            text_color: "#FFFFFF".to_string(),
            outline_color: "#0B0F16".to_string(),
            shadow_color: "#000000".to_string(),
            glow_color: "#22D3EE".to_string(),
            box_position: 2,
            width_pct: 62.0,
            margin_v_pct: 8.0,
        }
    }
}

/// ASS Fontname for a caption font id. Mirrors `CAPTION_FONTS[*].assName`
/// in `src/lib/caption-style.ts` — keep in sync.
pub fn ass_font_name(font_id: &str) -> &'static str {
    match font_id {
        "outfit" => "Outfit",
        "inter" => "Inter",
        "jetbrains-mono" => "JetBrains Mono",
        _ => "Outfit",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_matches_frontend_contract() {
        let s = CaptionStyle::default();
        assert_eq!(s.font_id, "outfit");
        assert_eq!(s.font_size, 48.0);
        assert_eq!(s.box_position, 2);
        assert_eq!(s.width_pct, 62.0);
        assert_eq!(s.margin_v_pct, 8.0);
        assert!(s.bold && s.outline && !s.italic && !s.shadow && !s.glow);
    }

    #[test]
    fn test_serde_default_and_unknown_fields() {
        // Older frontend omitting fields + newer frontend sending extras.
        let s: CaptionStyle =
            serde_json::from_str(r#"{"fontSize": 60, "futureField": true}"#).unwrap();
        assert_eq!(s.font_size, 60.0);
        assert_eq!(s.font_id, "outfit");
        assert_eq!(s.box_position, 2);
    }

    #[test]
    fn test_ass_font_name_mapping() {
        assert_eq!(ass_font_name("outfit"), "Outfit");
        assert_eq!(ass_font_name("inter"), "Inter");
        assert_eq!(ass_font_name("jetbrains-mono"), "JetBrains Mono");
        assert_eq!(ass_font_name("nonsense"), "Outfit");
    }
}

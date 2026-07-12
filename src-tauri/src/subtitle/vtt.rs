use super::srt::sanitize_cue_text;
use super::types::Subtitle;

pub fn write_vtt(subtitles: &[Subtitle]) -> String {
    let mut output = String::from("WEBVTT\n\n");

    for (i, sub) in subtitles.iter().enumerate() {
        if i > 0 {
            output.push('\n');
        }
        output.push_str(&format!("{}\n", sub.index));
        output.push_str(&format!(
            "{} --> {}\n",
            format_vtt_timestamp(sub.start_time),
            format_vtt_timestamp(sub.end_time)
        ));
        if let Some(ref speaker) = sub.speaker {
            output.push_str(&format!("[{}] ", speaker));
        }
        output.push_str(&sanitize_cue_text(&sub.text));
        output.push('\n');
    }

    output
}

// WebVTT uses dot as millisecond separator: HH:MM:SS.mmm
fn format_vtt_timestamp(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1_000;
    let millis = ms % 1_000;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
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
    fn test_vtt_header_and_timestamp() {
        let subs = vec![make_sub(1, 1000, 3500, "Hello world")];
        let out = write_vtt(&subs);
        assert!(out.starts_with("WEBVTT\n\n"));
        assert!(out.contains("00:00:01.000 --> 00:00:03.500"));
        assert!(out.contains("Hello world"));
    }

    #[test]
    fn test_vtt_timestamp_format() {
        assert_eq!(format_vtt_timestamp(0), "00:00:00.000");
        assert_eq!(format_vtt_timestamp(3_661_500), "01:01:01.500");
    }
}

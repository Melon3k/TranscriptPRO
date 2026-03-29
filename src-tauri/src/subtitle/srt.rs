use super::types::{AppError, Subtitle};
use regex::Regex;
use uuid::Uuid;

/// Parse an SRT file content into a Vec<Subtitle>.
/// Accepts both comma and period as millisecond separator for compatibility.
pub fn parse_srt(content: &str) -> Result<Vec<Subtitle>, AppError> {
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    let blocks: Vec<&str> = content.split("\n\n").collect();

    let time_re = Regex::new(
        r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})",
    )
    .map_err(|e| AppError::Other(e.to_string()))?;

    let mut subtitles = Vec::new();

    for block in blocks {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        let lines: Vec<&str> = block.lines().collect();
        if lines.len() < 3 {
            continue;
        }

        // Line 0: sequence number (we re-index anyway)
        // Line 1: timestamps
        // Line 2+: text
        let Some(caps) = time_re.captures(lines[1]) else {
            continue;
        };

        let start_time = parse_ts_parts(
            caps[1].parse().unwrap_or(0),
            caps[2].parse().unwrap_or(0),
            caps[3].parse().unwrap_or(0),
            caps[4].parse().unwrap_or(0),
        );
        let end_time = parse_ts_parts(
            caps[5].parse().unwrap_or(0),
            caps[6].parse().unwrap_or(0),
            caps[7].parse().unwrap_or(0),
            caps[8].parse().unwrap_or(0),
        );

        let text = lines[2..].join("\n").trim().to_string();
        if text.is_empty() {
            continue;
        }

        subtitles.push(Subtitle {
            id: Uuid::new_v4().to_string(),
            index: subtitles.len() + 1,
            start_time,
            end_time,
            text,
            words: Vec::new(),
        });
    }

    Ok(subtitles)
}

/// Write subtitles as a Premiere Pro-compatible SRT string.
/// - Comma as millisecond separator (not period)
/// - UTF-8 encoding (no BOM)
/// - Sequential numbering from 1
/// - Blank line between entries
pub fn write_srt(subtitles: &[Subtitle]) -> String {
    let mut output = String::new();

    for (i, sub) in subtitles.iter().enumerate() {
        if i > 0 {
            output.push('\n');
        }
        output.push_str(&format!("{}\n", sub.index));
        output.push_str(&format!(
            "{} --> {}\n",
            format_timestamp(sub.start_time),
            format_timestamp(sub.end_time)
        ));
        output.push_str(&sub.text);
        output.push('\n');
    }

    output
}

/// Write subtitles as word-level SRT (each word = separate subtitle entry)
pub fn write_word_srt(subtitles: &[Subtitle]) -> String {
    let mut output = String::new();
    let mut index = 1;

    for sub in subtitles {
        if sub.words.is_empty() {
            // No word data — write entire segment as one entry
            if index > 1 {
                output.push('\n');
            }
            output.push_str(&format!("{}\n", index));
            output.push_str(&format!(
                "{} --> {}\n",
                format_timestamp(sub.start_time),
                format_timestamp(sub.end_time)
            ));
            output.push_str(&sub.text);
            output.push('\n');
            index += 1;
        } else {
            for word in &sub.words {
                if index > 1 {
                    output.push('\n');
                }
                output.push_str(&format!("{}\n", index));
                output.push_str(&format!(
                    "{} --> {}\n",
                    format_timestamp(word.start_time),
                    format_timestamp(word.end_time)
                ));
                output.push_str(&word.text);
                output.push('\n');
                index += 1;
            }
        }
    }

    output
}

/// Write subtitles as plain text (no timestamps, one segment per line)
pub fn write_txt(subtitles: &[Subtitle]) -> String {
    subtitles
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format milliseconds as SRT timestamp: HH:MM:SS,mmm
pub fn format_timestamp(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1_000;
    let millis = ms % 1_000;
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, seconds, millis)
}

fn parse_ts_parts(h: u64, m: u64, s: u64, ms: u64) -> u64 {
    h * 3_600_000 + m * 60_000 + s * 1_000 + ms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_and_write_roundtrip() {
        let srt = "1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:03,500 --> 00:00:06,200\nThis is a test\n";
        let subtitles = parse_srt(srt).unwrap();
        assert_eq!(subtitles.len(), 2);
        assert_eq!(subtitles[0].start_time, 1000);
        assert_eq!(subtitles[0].end_time, 3500);
        assert_eq!(subtitles[0].text, "Hello world");

        let output = write_srt(&subtitles);
        assert!(output.contains("00:00:01,000 --> 00:00:03,500"));
    }

    #[test]
    fn test_format_timestamp() {
        assert_eq!(format_timestamp(0), "00:00:00,000");
        assert_eq!(format_timestamp(1000), "00:00:01,000");
        assert_eq!(format_timestamp(3_661_500), "01:01:01,500");
    }
}

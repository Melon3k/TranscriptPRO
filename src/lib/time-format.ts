/**
 * Format milliseconds as SRT timestamp: HH:MM:SS,mmm
 */
export function formatTimestamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(millis, 3)}`;
}

/**
 * Parse SRT timestamp string to milliseconds.
 * Accepts both comma and period as millisecond separator.
 * Returns null if the format is invalid.
 */
export function parseTimestamp(str: string): number | null {
  const match = str.match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  const [, h, m, s, ms] = match.map(Number);
  return h * 3_600_000 + m * 60_000 + s * 1_000 + ms;
}

/**
 * Format seconds (float from HTMLVideoElement.currentTime) to HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}`;
  }
  return `${pad(m, 2)}:${pad(s, 2)}`;
}

function pad(n: number, digits: number): string {
  return String(Math.floor(n)).padStart(digits, "0");
}

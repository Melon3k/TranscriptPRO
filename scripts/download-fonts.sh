#!/usr/bin/env bash
#
# Downloads STATIC Regular+Bold TTFs for the three caption families
# (Outfit / Inter / JetBrains Mono) into src-tauri/fonts/ so the MP4 burn-in
# render uses the app's real fonts instead of libass fontconfig substitution.
#
# libass matches fonts by their INTERNAL name-table family (name ID 1), NOT by
# filename. Each TTF's family MUST equal the ASS Fontname that ass.rs emits:
#   Outfit-*.ttf         -> "Outfit"
#   Inter-*.ttf          -> "Inter"
#   JetBrainsMono-*.ttf  -> "JetBrains Mono"
# (mirrors ass_font_name() in src-tauri/src/subtitle/style.rs and
#  CAPTION_FONTS[*].assName in src/lib/caption-style.ts). This script hard-fails
# if any delivered file reports the wrong family, so mis-named fonts are never
# shipped.
#
# All three families are SIL OFL 1.1 (redistribution OK) — see
# src-tauri/fonts/README.md for attribution.
#
# Usage:
#   ./scripts/download-fonts.sh
#
# Sources (GitHub raw, static instances — NOT variable fonts; libass weight
# selection from a variable TTF is unreliable):
#   Outfit:        github.com/Outfitio/Outfit-Fonts  (google/fonts ships variable only)
#   Inter:         github.com/rsms/inter release zip  (master no longer ships
#                  static TTFs — only woff2 + the variable TTF; the release
#                  extras/ttf/ static builds report family "Inter" exactly)
#   JetBrains Mono:github.com/JetBrains/JetBrainsMono

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/fonts"
TMP="$(mktemp -d)"
trap "rm -rf '$TMP'" EXIT

mkdir -p "$OUT"

OUTFIT_REG_URL="https://raw.githubusercontent.com/Outfitio/Outfit-Fonts/main/fonts/ttf/Outfit-Regular.ttf"
OUTFIT_BOLD_URL="https://raw.githubusercontent.com/Outfitio/Outfit-Fonts/main/fonts/ttf/Outfit-Bold.ttf"
# rsms/inter release zip (pinned) — its extras/ttf/ holds real static builds.
INTER_VERSION="4.1"
INTER_ZIP_URL="https://github.com/rsms/inter/releases/download/v${INTER_VERSION}/Inter-${INTER_VERSION}.zip"
JBM_REG_URL="https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Regular.ttf"
JBM_BOLD_URL="https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Bold.ttf"

fetch() { # <url> <dest>
  echo ">> $(basename "$2")"
  curl -fL --http1.1 --retry 5 --retry-all-errors --retry-delay 3 \
    --connect-timeout 30 -o "$2" "$1"
}

# First family token reported by fc-scan (falls back to fontTools if fc-scan
# is missing). Strips any trailing localized-name duplicates fc-scan may join
# with commas.
family_of() { # <file>
  if command -v fc-scan >/dev/null; then
    fc-scan --format '%{family}\n' "$1" | head -n1 | sed 's/,.*//'
  elif command -v python3 >/dev/null; then
    python3 - "$1" <<'PY'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
name = f["name"].getDebugName(1)
print(name if name else "")
PY
  else
    echo "!! neither fc-scan nor python3 available to verify font family" >&2
    exit 1
  fi
}

# Rewrite name IDs 1,4,6,16 so the delivered file reports exactly <family>.
# Used when the only available static reports e.g. "Inter 18pt". Requires
# fontTools; installs it into the current interpreter if missing.
normalize_family() { # <file> <family> <regular|bold>
  local file="$1" family="$2" style="$3"
  if ! python3 -c "import fontTools" >/dev/null 2>&1; then
    echo "   installing fonttools to normalize '$family' name table" >&2
    python3 -m pip install --quiet fonttools >&2
  fi
  python3 - "$file" "$family" "$style" <<'PY'
import sys
from fontTools.ttLib import TTFont

path, family, style = sys.argv[1], sys.argv[2], sys.argv[3]
subfamily = "Bold" if style == "bold" else "Regular"
full = f"{family} {subfamily}" if style == "bold" else family
# PostScript name: no spaces, hyphen-joined.
ps = f"{family.replace(' ', '')}-{subfamily}"

f = TTFont(path)
name = f["name"]
# ID 1 = family, 2 = subfamily, 4 = full, 6 = postscript,
# 16 = typographic family, 17 = typographic subfamily.
for nid, val in ((1, family), (4, full), (6, ps), (16, family)):
    name.setName(val, nid, 3, 1, 0x409)  # Windows / Unicode BMP / en-US
    name.setName(val, nid, 1, 0, 0)       # Mac / Roman / en
f.save(path)
print(f"   normalized {path} -> family '{family}'", file=sys.stderr)
PY
}

# Assert the file's family equals expected; on Inter mismatch, normalize once
# and re-check. Any surviving mismatch is fatal.
verify_family() { # <file> <expected> <regular|bold> <allow_normalize:0|1>
  local file="$1" expected="$2" style="$3" allow_norm="$4" got
  got="$(family_of "$file")"
  if [ "$got" != "$expected" ]; then
    if [ "$allow_norm" = "1" ]; then
      echo "   family is '$got', expected '$expected' — normalizing" >&2
      normalize_family "$file" "$expected" "$style"
      got="$(family_of "$file")"
    fi
  fi
  if [ "$got" != "$expected" ]; then
    echo "!! family mismatch for $file" >&2
    echo "   expected: '$expected'" >&2
    echo "   got:      '$got'" >&2
    echo "   libass would substitute a system font — refusing to ship." >&2
    exit 1
  fi
  echo "   family OK: '$got'"
}

fetch "$OUTFIT_REG_URL"  "$OUT/Outfit-Regular.ttf"
fetch "$OUTFIT_BOLD_URL" "$OUT/Outfit-Bold.ttf"

echo ">> Inter-Regular.ttf / Inter-Bold.ttf (from Inter-${INTER_VERSION}.zip)"
fetch "$INTER_ZIP_URL" "$TMP/inter.zip"
unzip -o -q "$TMP/inter.zip" -d "$TMP/inter"
INTER_REG_SRC="$(find "$TMP/inter" -path '*extras/ttf/Inter-Regular.ttf' | head -n1)"
INTER_BOLD_SRC="$(find "$TMP/inter" -path '*extras/ttf/Inter-Bold.ttf' | head -n1)"
if [ -z "$INTER_REG_SRC" ] || [ -z "$INTER_BOLD_SRC" ]; then
  echo "!! static Inter TTFs not found in $INTER_ZIP_URL" >&2
  exit 1
fi
cp "$INTER_REG_SRC"  "$OUT/Inter-Regular.ttf"
cp "$INTER_BOLD_SRC" "$OUT/Inter-Bold.ttf"

fetch "$JBM_REG_URL"     "$OUT/JetBrainsMono-Regular.ttf"
fetch "$JBM_BOLD_URL"    "$OUT/JetBrainsMono-Bold.ttf"

echo
echo ">> verifying internal family names"
verify_family "$OUT/Outfit-Regular.ttf"        "Outfit"         regular 0
verify_family "$OUT/Outfit-Bold.ttf"           "Outfit"         bold    0
# Inter static builds are sometimes named family "Inter 18pt"; normalize to "Inter".
verify_family "$OUT/Inter-Regular.ttf"         "Inter"          regular 1
verify_family "$OUT/Inter-Bold.ttf"            "Inter"          bold    1
verify_family "$OUT/JetBrainsMono-Regular.ttf" "JetBrains Mono" regular 0
verify_family "$OUT/JetBrainsMono-Bold.ttf"    "JetBrains Mono" bold    0

echo
echo "Done. Fonts:"
ls -lh "$OUT/"

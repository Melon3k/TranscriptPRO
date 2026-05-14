#!/usr/bin/env bash
#
# Downloads static ffmpeg binaries and places them in src-tauri/binaries/ under
# Tauri's sidecar naming convention (ffmpeg-<rust-target-triple>[.exe]).
#
# Usage:
#   ./scripts/download-ffmpeg.sh            # auto-detects host platform
#   ./scripts/download-ffmpeg.sh macos      # both macOS arches
#   ./scripts/download-ffmpeg.sh windows    # windows x64
#   ./scripts/download-ffmpeg.sh all        # everything
#
# Sources:
#   macOS: https://www.osxexperts.net/  (Helmut K. C. Tessarek's static builds, BSD)
#   Windows: https://www.gyan.dev/ffmpeg/builds/  (essentials, static)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries"
TMP="$(mktemp -d)"
trap "rm -rf '$TMP'" EXIT

mkdir -p "$OUT"

OSX_ARM_URL="https://www.osxexperts.net/ffmpeg711arm.zip"
OSX_INTEL_URL="https://www.osxexperts.net/ffmpeg7intel.zip"
WIN_URL="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

download_macos_arm() {
  echo ">> ffmpeg-aarch64-apple-darwin"
  curl -fL --http1.1 --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 30 -o "$TMP/ff-arm.zip" "$OSX_ARM_URL"
  unzip -o -q "$TMP/ff-arm.zip" -d "$TMP/ff-arm"
  cp "$TMP/ff-arm/ffmpeg" "$OUT/ffmpeg-aarch64-apple-darwin"
  chmod +x "$OUT/ffmpeg-aarch64-apple-darwin"
}

download_macos_intel() {
  echo ">> ffmpeg-x86_64-apple-darwin"
  curl -fL --http1.1 --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 30 -o "$TMP/ff-intel.zip" "$OSX_INTEL_URL"
  unzip -o -q "$TMP/ff-intel.zip" -d "$TMP/ff-intel"
  cp "$TMP/ff-intel/ffmpeg" "$OUT/ffmpeg-x86_64-apple-darwin"
  chmod +x "$OUT/ffmpeg-x86_64-apple-darwin"
}

# Tauri's --target universal-apple-darwin expects a single fat binary
# at binaries/ffmpeg-universal-apple-darwin (not the two per-arch files).
build_macos_universal() {
  echo ">> ffmpeg-universal-apple-darwin (lipo)"
  if ! command -v lipo >/dev/null; then
    echo "lipo not found (only available on macOS) — skipping universal build" >&2
    return
  fi
  lipo -create \
    "$OUT/ffmpeg-aarch64-apple-darwin" \
    "$OUT/ffmpeg-x86_64-apple-darwin" \
    -output "$OUT/ffmpeg-universal-apple-darwin"
  chmod +x "$OUT/ffmpeg-universal-apple-darwin"
}

download_windows() {
  echo ">> ffmpeg-x86_64-pc-windows-msvc.exe"
  curl -fL --http1.1 --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 30 -o "$TMP/ff-win.zip" "$WIN_URL"
  unzip -o -q "$TMP/ff-win.zip" -d "$TMP/ff-win"
  EXE="$(find "$TMP/ff-win" -name ffmpeg.exe -type f | head -n1)"
  if [ -z "$EXE" ]; then
    echo "ffmpeg.exe not found in archive" >&2
    exit 1
  fi
  cp "$EXE" "$OUT/ffmpeg-x86_64-pc-windows-msvc.exe"
}

TARGET="${1:-auto}"

if [ "$TARGET" = "auto" ]; then
  case "$(uname -s)" in
    Darwin) TARGET="macos" ;;
    Linux)  TARGET="windows" ;; # CI Linux runner — used for cross-compile? Treat as no-op for now.
    MINGW*|MSYS*|CYGWIN*) TARGET="windows" ;;
    *) echo "Unknown OS $(uname -s)"; exit 1 ;;
  esac
fi

case "$TARGET" in
  macos)
    download_macos_arm
    download_macos_intel
    build_macos_universal
    ;;
  windows)
    download_windows
    ;;
  all)
    download_macos_arm
    download_macos_intel
    build_macos_universal
    download_windows
    ;;
  *)
    echo "Unknown target: $TARGET (expected: macos|windows|all|auto)" >&2
    exit 1
    ;;
esac

echo
echo "Done. Binaries:"
ls -lh "$OUT/"

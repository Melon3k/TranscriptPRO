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
# Version-pinned gyan.dev package (the "release-essentials" alias retargets on every
# upstream release, which would silently change the shipped binary AND break the pin).
WIN_URL="https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip"

# Pinned SHA-256 of the downloaded archives (verified 2026-07-17; the extracted
# macOS binaries match the ones the app has shipped with since May 2026, and the
# Windows sum is gyan.dev's published .sha256). If upstream replaces an archive,
# the download fails here — re-verify the new artifact before updating the pin.
OSX_ARM_SHA="59e39a5cec2e5d2307ed079c53227a9181e64b87454ed4de998349e044bfdc70"
OSX_INTEL_SHA="2d01a9bb00c3d0d4a850baa12a9414af197c1199315443bce44064ffb8e4297a"
WIN_SHA="db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"

sha256_of() {
  if command -v shasum >/dev/null; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

verify_sha256() { # <file> <expected>
  local got
  got="$(sha256_of "$1")"
  if [ "$got" != "$2" ]; then
    echo "!! SHA-256 mismatch for $1" >&2
    echo "   expected: $2" >&2
    echo "   got:      $got" >&2
    echo "   The upstream archive changed — verify the new artifact and update the pin." >&2
    exit 1
  fi
}

download_macos_arm() {
  echo ">> ffmpeg-aarch64-apple-darwin"
  curl -fL --http1.1 --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 30 -o "$TMP/ff-arm.zip" "$OSX_ARM_URL"
  verify_sha256 "$TMP/ff-arm.zip" "$OSX_ARM_SHA"
  unzip -o -q "$TMP/ff-arm.zip" -d "$TMP/ff-arm"
  cp "$TMP/ff-arm/ffmpeg" "$OUT/ffmpeg-aarch64-apple-darwin"
  chmod +x "$OUT/ffmpeg-aarch64-apple-darwin"
}

download_macos_intel() {
  echo ">> ffmpeg-x86_64-apple-darwin"
  curl -fL --http1.1 --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 30 -o "$TMP/ff-intel.zip" "$OSX_INTEL_URL"
  verify_sha256 "$TMP/ff-intel.zip" "$OSX_INTEL_SHA"
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
  verify_sha256 "$TMP/ff-win.zip" "$WIN_SHA"
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

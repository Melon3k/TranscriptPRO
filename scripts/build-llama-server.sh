#!/usr/bin/env bash
#
# Builds a STATIC llama-server binary and places it in src-tauri/binaries/ under
# Tauri's sidecar naming convention (llama-server-<rust-target-triple>[.exe]).
#
# Static because the official llama.cpp release archives are dynamically linked
# (llama-server + ~20 dylibs), which doesn't fit Tauri's single-file externalBin
# model or macOS notarization. A pinned-tag source build gives one self-contained
# binary, same shape as the ffmpeg sidecar.
#
# Usage:
#   ./scripts/build-llama-server.sh            # auto-detects host platform
#   ./scripts/build-llama-server.sh macos      # both macOS arches (for universal CI builds)
#   ./scripts/build-llama-server.sh macos-arm  # aarch64-apple-darwin (Metal)
#   ./scripts/build-llama-server.sh macos-x64  # x86_64-apple-darwin
#   ./scripts/build-llama-server.sh windows    # x86_64-pc-windows-msvc (CPU)
#
# Requires: cmake, git, a C/C++ toolchain (Xcode CLT on macOS, MSVC on Windows).

set -euo pipefail

# Pin the llama.cpp build to an exact commit — a git tag is a movable ref, so we
# clone the tag for convenience but then assert HEAD matches this SHA, failing the
# build if the upstream tag was ever re-pointed. Bump both together, deliberately,
# and re-test local translation afterwards.
LLAMA_TAG="b9974"
LLAMA_COMMIT="3cec3bcd162a410171ded45c11d44725678f0880"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries"
TMP="$(mktemp -d)"
trap "rm -rf '$TMP'" EXIT

mkdir -p "$OUT"

clone() {
  git clone --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp "$TMP/llama.cpp"
  local head
  head="$(git -C "$TMP/llama.cpp" rev-parse HEAD)"
  if [ "$head" != "$LLAMA_COMMIT" ]; then
    echo "ERROR: llama.cpp tag $LLAMA_TAG resolved to $head, expected $LLAMA_COMMIT (tag moved?)" >&2
    exit 1
  fi
}

# Common cmake flags: static, server only, no curl (we download models ourselves),
# no TLS (the server binds 127.0.0.1 only; SSL would drag in a homebrew/system
# OpenSSL dylib that user machines don't have), and no embedded Web UI. We run the
# server with --no-jinja/--no-webui and only call /health + /completion, so the UI
# is dead weight — and building it (npm build, else an HF asset download) broke the
# Windows CI runner (MSB8066 in llama-ui-assets). BUILD_UI=OFF + USE_PREBUILT_UI=OFF
# makes the asset step emit an empty stub instead.
COMMON_FLAGS=(
  -DBUILD_SHARED_LIBS=OFF
  -DLLAMA_BUILD_SERVER=ON
  -DLLAMA_BUILD_TESTS=OFF
  -DLLAMA_BUILD_EXAMPLES=OFF
  -DLLAMA_BUILD_TOOLS=ON
  -DLLAMA_CURL=OFF
  -DLLAMA_SERVER_SSL=OFF
  -DLLAMA_BUILD_UI=OFF
  -DLLAMA_USE_PREBUILT_UI=OFF
  -DCMAKE_DISABLE_FIND_PACKAGE_OpenSSL=ON
  -DCMAKE_BUILD_TYPE=Release
)

build_macos() {
  local arch="$1" triple="$2"
  echo ">> llama-server-$triple (static, Metal embedded)"
  cmake -S "$TMP/llama.cpp" -B "$TMP/build-$arch" \
    "${COMMON_FLAGS[@]}" \
    -DCMAKE_OSX_ARCHITECTURES="$arch" \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON \
    -DGGML_NATIVE=OFF
  cmake --build "$TMP/build-$arch" --target llama-server -j "$(sysctl -n hw.ncpu)"
  cp "$TMP/build-$arch/bin/llama-server" "$OUT/llama-server-$triple"
  chmod +x "$OUT/llama-server-$triple"
}

# Tauri's --target universal-apple-darwin expects a single fat binary at
# binaries/llama-server-universal-apple-darwin (not the two per-arch files),
# same as the ffmpeg sidecar. Combine the two arch builds with lipo.
build_macos_universal() {
  echo ">> llama-server-universal-apple-darwin (lipo)"
  if ! command -v lipo >/dev/null; then
    echo "lipo not found (only available on macOS) — skipping universal build" >&2
    return
  fi
  lipo -create \
    "$OUT/llama-server-aarch64-apple-darwin" \
    "$OUT/llama-server-x86_64-apple-darwin" \
    -output "$OUT/llama-server-universal-apple-darwin"
  chmod +x "$OUT/llama-server-universal-apple-darwin"
}

build_windows() {
  echo ">> llama-server-x86_64-pc-windows-msvc.exe (static CPU)"
  cmake -S "$TMP/llama.cpp" -B "$TMP/build-win" \
    "${COMMON_FLAGS[@]}" \
    -DGGML_NATIVE=OFF
  cmake --build "$TMP/build-win" --target llama-server --config Release -j
  # MSVC multi-config puts binaries under bin/Release/.
  local exe="$TMP/build-win/bin/Release/llama-server.exe"
  [ -f "$exe" ] || exe="$TMP/build-win/bin/llama-server.exe"
  cp "$exe" "$OUT/llama-server-x86_64-pc-windows-msvc.exe"
}

TARGET="${1:-auto}"
if [ "$TARGET" = "auto" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) TARGET="macos-arm" ;;
    Darwin-x86_64) TARGET="macos-x64" ;;
    MINGW*|MSYS*|CYGWIN*) TARGET="windows" ;;
    *) echo "Unsupported host; pass macos-arm | macos-x64 | windows" >&2; exit 1 ;;
  esac
fi

clone
case "$TARGET" in
  macos)     build_macos arm64 aarch64-apple-darwin
             build_macos x86_64 x86_64-apple-darwin
             build_macos_universal ;;
  macos-arm) build_macos arm64 aarch64-apple-darwin ;;
  macos-x64) build_macos x86_64 x86_64-apple-darwin ;;
  windows)   build_windows ;;
  *) echo "Unknown target: $TARGET" >&2; exit 1 ;;
esac

echo "Done. Binaries in $OUT"

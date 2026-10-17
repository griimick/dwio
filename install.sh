#!/bin/sh
# Install dwio: downloads the prebuilt binary for this OS/CPU from GitHub Releases.
#   curl -fsSL https://raw.githubusercontent.com/griimick/dwio/main/install.sh | sh
# Env: DWIO_VERSION (e.g. v0.1.0, default: latest), DWIO_INSTALL_DIR (default: ~/.local/bin),
#      DWIO_BASE_URL (override the download location, for mirrors and testing)
set -eu

REPO="griimick/dwio"
DIR="${DWIO_INSTALL_DIR:-$HOME/.local/bin}"

# Colors, in the style of opencode's installer: dim labels, red errors, one orange accent.
# Used only when messages go to a terminal. NO_COLOR turns them off; FORCE_COLOR turns them on.
if [ -n "${NO_COLOR:-}" ]; then use_color=0
elif [ -n "${FORCE_COLOR:-}" ] && [ "${FORCE_COLOR}" != "0" ]; then use_color=1
elif [ -t 2 ] && [ "${TERM:-}" != "dumb" ]; then use_color=1
else use_color=0; fi
if [ "$use_color" = 1 ]; then
  MUTED='\033[0;2m'; RED='\033[0;31m'; ORANGE='\033[38;5;214m'; NC='\033[0m'
else
  MUTED=''; RED=''; ORANGE=''; NC=''
fi
say() { printf '%b\n' "$1" >&2; }
fail() { say "${RED}error:${NC} $1"; exit 1; }

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  linux|darwin) ;;
  *) fail "unsupported OS '$os' (Windows: download dwio-windows-x64.exe from the Releases page)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) fail "unsupported CPU '$(uname -m)'" ;;
esac

asset="dwio-$os-$arch"
if [ -n "${DWIO_BASE_URL:-}" ]; then base="$DWIO_BASE_URL"
elif [ -n "${DWIO_VERSION:-}" ]; then base="https://github.com/$REPO/releases/download/$DWIO_VERSION"
else base="https://github.com/$REPO/releases/latest/download"; fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "${MUTED}Downloading ${NC}$asset${MUTED}…${NC}"
curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"

want=$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
else got=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1); fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then fail "checksum mismatch for $asset; aborting"; fi

mkdir -p "$DIR"
install -m 755 "$tmp/$asset" "$DIR/dwio"
say "${MUTED}Installed ${NC}dwio ${MUTED}$("$DIR/dwio" --version) to ${NC}$DIR/dwio"
case ":$PATH:" in *":$DIR:"*) ;; *) say "${ORANGE}Note:${NC} $DIR is not on your PATH. Add: ${MUTED}export PATH=\"$DIR:\$PATH\"${NC}" ;; esac
say "${MUTED}First run downloads the draw.io web app once (~50 MB); run ${NC}dwio setup${MUTED} to do it now.${NC}"
say "${MUTED}Try: ${NC}dwio diagram.drawio.svg"

#!/bin/sh
# Install dwio: downloads the prebuilt binary for this OS/CPU from GitHub Releases.
#   curl -fsSL https://raw.githubusercontent.com/griimick/dwio/main/install.sh | sh
# Env: DWIO_VERSION (e.g. v0.1.0, default: latest), DWIO_INSTALL_DIR (default: ~/.local/bin),
#      DWIO_BASE_URL (override the download location, for mirrors and testing)
set -eu

REPO="griimick/dwio"
DIR="${DWIO_INSTALL_DIR:-$HOME/.local/bin}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  linux|darwin) ;;
  *) echo "dwio: unsupported OS '$os' (Windows: download dwio-windows-x64.exe from the Releases page)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "dwio: unsupported CPU '$(uname -m)'" >&2; exit 1 ;;
esac

asset="dwio-$os-$arch"
if [ -n "${DWIO_BASE_URL:-}" ]; then base="$DWIO_BASE_URL"
elif [ -n "${DWIO_VERSION:-}" ]; then base="https://github.com/$REPO/releases/download/$DWIO_VERSION"
else base="https://github.com/$REPO/releases/latest/download"; fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $asset…" >&2
curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"

want=$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
else got=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1); fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then echo "dwio: checksum mismatch for $asset; aborting" >&2; exit 1; fi

mkdir -p "$DIR"
install -m 755 "$tmp/$asset" "$DIR/dwio"
echo "Installed $("$DIR/dwio" --version) to $DIR/dwio" >&2
case ":$PATH:" in *":$DIR:"*) ;; *) echo "Note: $DIR is not on your PATH. Add: export PATH=\"$DIR:\$PATH\"" >&2 ;; esac
echo "First run downloads the draw.io web app once (~50 MB); run 'dwio setup' to do it now." >&2

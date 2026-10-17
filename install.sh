#!/bin/sh
# Install dwio: downloads the prebuilt binary for this OS/CPU from GitHub Releases.
#   curl -fsSL https://raw.githubusercontent.com/griimick/dwio/main/install.sh | sh
# Env: DWIO_VERSION (e.g. v0.1.0, default: latest), DWIO_INSTALL_DIR (default: ~/.local/bin),
#      DWIO_BASE_URL (override the download location, for mirrors and testing)
#
# Everything below is inside functions, and the only command that runs is the last line, `main "$@"`.
# So a download that is cut off half way cannot run a half-finished command.
set -eu

REPO="griimick/dwio"

# Output style, in the spirit of opencode's installer: dim labels, red errors, one accent color
# (Catppuccin Mocha green here; opencode uses gold).
# Colors only on a terminal. NO_COLOR turns them off; FORCE_COLOR turns them on.
# The download loader only on a terminal (it moves the cursor), and never when TERM=dumb.
setup_output() {
  if [ -n "${NO_COLOR:-}" ]; then use_color=0
  elif [ -n "${FORCE_COLOR:-}" ] && [ "${FORCE_COLOR}" != "0" ]; then use_color=1
  elif [ -t 2 ] && [ "${TERM:-}" != "dumb" ]; then use_color=1
  else use_color=0; fi
  if [ "$use_color" = 1 ]; then
    MUTED='\033[0;2m'; RED='\033[0;31m'; NC='\033[0m'
    case "${COLORTERM:-}" in
      *truecolor*|*24bit*) ACCENT='\033[38;2;166;227;161m' ;; # #a6e3a1
      *) ACCENT='\033[38;5;151m' ;; # the nearest of the 256 colors
    esac
  else
    MUTED=''; RED=''; ACCENT=''; NC=''
  fi
  if [ -t 2 ] && [ "${TERM:-}" != "dumb" ]; then ANIMATE=1; else ANIMATE=0; fi
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) FILL='━'; EMPTY='─' ;;
    *) FILL='#'; EMPTY='-' ;;
  esac
}

say() { printf '%b\n' "$1" >&2; }
fail() { say "${RED}error:${NC} $1"; exit 1; }

# repeat STRING COUNT
repeat() {
  _s=''; _n=$2
  while [ "$_n" -gt 0 ]; do _s="$_s$1"; _n=$((_n - 1)); done
  printf '%s' "$_s"
}

# File size in bytes. `ls` and not `wc -c`: busybox reads the whole file for wc.
file_size() { ls -ln "$1" | awk '{ print $5 }'; }

mb() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1048576 }'; }

# draw_bar NAME BYTES TOTAL FRAME: one line that is redrawn in place. TOTAL 0 means the size is not known.
draw_bar() {
  _label="Downloading $1"; _bytes=$2; _total=$3; _frame=$4
  if [ "$_total" -gt 0 ] 2>/dev/null; then
    _pct=$((_bytes * 100 / _total)); [ "$_pct" -gt 100 ] && _pct=100
    _cols=$(tput cols 2>/dev/null || echo 80)
    [ "$_cols" -gt 0 ] 2>/dev/null || _cols=80 # some terminals report no size, or 0
    _width=$((_cols - ${#_label} - 30)); [ "$_width" -gt 28 ] && _width=28
    if [ "$_width" -lt 8 ]; then
      _line="${MUTED}${_label}${NC}  ${ACCENT}${_pct}%${NC}" # a narrow terminal: no bar
    else
      _on=$((_pct * _width / 100)); _off=$((_width - _on))
      _line="${MUTED}${_label}${NC}  ${ACCENT}$(repeat "$FILL" "$_on")${NC}${MUTED}$(repeat "$EMPTY" "$_off")${NC} $(printf '%3d' "$_pct")%  ${MUTED}$(mb "$_bytes") / $(mb "$_total")${NC}"
    fi
  else
    case $((_frame % 4)) in 0) _spin='|' ;; 1) _spin='/' ;; 2) _spin='-' ;; *) _spin='\\' ;; esac
    _line="${MUTED}${_label}${NC}  ${ACCENT}${_spin}${NC} ${MUTED}$(mb "$_bytes")${NC}"
  fi
  printf '\r%b\033[K' "$_line" >&2
}

# download URL DEST NAME: with a loader on a terminal, one plain line otherwise.
download() {
  _url=$1; _dest=$2; _name=$3
  if [ "$ANIMATE" != 1 ]; then
    say "${MUTED}Downloading ${NC}$_name${MUTED}…${NC}"
    curl -fsSL "$_url" -o "$_dest"
    return
  fi
  # The size comes from the headers of the last redirect. If there is none, the loader is a spinner.
  _size=$(curl -fsSIL "$_url" 2>/dev/null | awk 'tolower($1) == "content-length:" { v = $2 } END { gsub(/\r/, "", v); print v + 0 }') || _size=0
  printf '\033[?25l' >&2 # hide the cursor
  curl -fsSL "$_url" -o "$_dest" &
  _pid=$!
  trap 'kill "$_pid" 2>/dev/null; printf "\r\033[K\033[?25h" >&2; exit 130' INT TERM
  _tick=0
  while kill -0 "$_pid" 2>/dev/null; do
    draw_bar "$_name" "$(file_size "$_dest" 2>/dev/null || echo 0)" "$_size" "$_tick"
    _tick=$((_tick + 1))
    sleep 0.1 2>/dev/null || sleep 1
  done
  _rc=0
  wait "$_pid" || _rc=$?
  trap - INT TERM
  printf '\r\033[K\033[?25h' >&2 # clear the line, show the cursor
  [ "$_rc" -eq 0 ] || return "$_rc"
  say "${MUTED}Downloaded ${NC}$_name ${MUTED}($(mb "$(file_size "$_dest")"))${NC}"
}

main() {
  setup_output
  DIR="${DWIO_INSTALL_DIR:-$HOME/.local/bin}"

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

  download "$base/$asset" "$tmp/$asset" "$asset" || fail "could not download $base/$asset"
  curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"

  want=$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
  if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
  else got=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1); fi
  if [ -z "$want" ] || [ "$want" != "$got" ]; then fail "checksum mismatch for $asset; aborting"; fi

  mkdir -p "$DIR"
  install -m 755 "$tmp/$asset" "$DIR/dwio"
  say "${MUTED}Installed ${NC}dwio ${MUTED}$("$DIR/dwio" --version) to ${NC}$DIR/dwio"
  case ":$PATH:" in *":$DIR:"*) ;; *) say "${ACCENT}Note:${NC} $DIR is not on your PATH. Add: ${MUTED}export PATH=\"$DIR:\$PATH\"${NC}" ;; esac
  say "${MUTED}First run downloads the draw.io web app once (~50 MB); run ${NC}dwio setup${MUTED} to do it now.${NC}"
  say "${MUTED}Try: ${NC}dwio diagram.drawio.svg"
}

main "$@"

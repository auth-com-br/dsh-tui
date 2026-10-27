#!/bin/sh
# Installs (or updates) deepseek-harness-tui and what it needs, for the user
# running it — no sudo, nothing outside their home:
#
#   curl -fsSL https://auth-com-br.github.io/dsh-tui/install.sh | sh
#
# 1. Node.js 20 or newer: the one on PATH, or else the official build put in
#    ~/.local/share/dsh-tui/node (checked against nodejs.org's SHASUMS256).
# 2. The DeepSeek Harness CLI, `dsh`, at the version this TUI is tested on,
#    into ~/.local (npm's --prefix, so no global npm folder is written).
# 3. This TUI, from GitHub, into ~/.local/share/dsh-tui/app, with its
#    dependencies.
# 4. The harness's `tui` profile wired to it (`dsh plugin --profile tui add`;
#    pnpm, which the harness manages plugins with, is installed if missing).
# 5. `dsh-tui`, the command that opens it, in ~/.local/bin.
#
# Run again to update. Settings, sessions and keys in ~/.dsh are left alone.
# The model's key is set inside the TUI, with /models.
#
# Overrides, for testing or a fork: DSH_TUI_PREFIX (~/.local), DSH_TUI_REPO
# (auth-com-br/dsh-tui), DSH_TUI_REF (main), DSH_TUI_SOURCE (a local folder
# to install instead of downloading), DSH_VERSION, NODE_VERSION.

set -eu

USER_PATH="$PATH"
PREFIX="${DSH_TUI_PREFIX:-$HOME/.local}"
REPO="${DSH_TUI_REPO:-auth-com-br/dsh-tui}"
REF="${DSH_TUI_REF:-main}"
# The harness this TUI is built and tested against: its packages are on
# ^0.1.0-rc, which the 0.2 series does not satisfy.
DSH_VERSION="${DSH_VERSION:-0.1.2-rc.1}"
NODE_VERSION="${NODE_VERSION:-v22.22.2}"
NODE_MAJOR_MIN=20

HOME_DIR="$PREFIX/share/dsh-tui"
APP_DIR="$HOME_DIR/app"
NODE_DIR="$HOME_DIR/node"
BIN_DIR="$PREFIX/bin"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is needed and was not found"; }

# fetch URL FILE: curl, or wget where there is no curl.
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "curl or wget is needed to download"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

need tar
need uname

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

# ── 1. Node.js ───────────────────────────────────────────────────────────────

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "$major" -ge "$NODE_MAJOR_MIN" ] 2>/dev/null
}

# Our own Node, from an earlier run, comes first: it is what dsh-tui runs on.
if [ -x "$NODE_DIR/bin/node" ]; then
  PATH="$NODE_DIR/bin:$PATH"
fi

if node_ok; then
  say "Node.js $(node -v) ($(command -v node))"
else
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) die "this installer is for Linux and macOS; install Node.js $NODE_MAJOR_MIN+ and the harness by hand (see the README)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "no Node.js build for $(uname -m); install Node.js $NODE_MAJOR_MIN+ yourself and run this again" ;;
  esac
  name="node-$NODE_VERSION-$os-$arch"
  say "Node.js $NODE_MAJOR_MIN+ not found: installing $NODE_VERSION in $NODE_DIR"
  fetch "https://nodejs.org/dist/$NODE_VERSION/$name.tar.gz" "$TMP/$name.tar.gz"
  fetch "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" "$TMP/SHASUMS256.txt"
  want=$(grep " $name.tar.gz\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)
  [ -n "$want" ] || die "$name.tar.gz is not in nodejs.org's checksums"
  [ "$(sha256 "$TMP/$name.tar.gz")" = "$want" ] || die "the Node.js download does not match its checksum"
  tar -xzf "$TMP/$name.tar.gz" -C "$TMP"
  mkdir -p "$HOME_DIR"
  rm -rf "$NODE_DIR"
  mv "$TMP/$name" "$NODE_DIR"
  PATH="$NODE_DIR/bin:$PATH"
  node_ok || die "the Node.js just installed does not run"
fi
export PATH
# npm's "new version available" notice is not this installer's to show.
NPM_CONFIG_UPDATE_NOTIFIER=false
export NPM_CONFIG_UPDATE_NOTIFIER

# ── 2. The harness, dsh ──────────────────────────────────────────────────────

mkdir -p "$BIN_DIR"
PATH="$BIN_DIR:$PATH"
have=$("$BIN_DIR/dsh" --version 2>/dev/null || true)
if [ "$have" = "$DSH_VERSION" ]; then
  say "DeepSeek Harness $DSH_VERSION (already installed)"
else
  say "installing the DeepSeek Harness $DSH_VERSION into $PREFIX"
  npm install -g --prefix "$PREFIX" --no-audit --no-fund --loglevel=error "@deepseek-ai/dsh@$DSH_VERSION" >/dev/null
fi

# The harness manages a profile's plugins with pnpm.
if ! command -v pnpm >/dev/null 2>&1; then
  say "installing pnpm into $PREFIX (the harness manages its plugins with it)"
  npm install -g --prefix "$PREFIX" --no-audit --no-fund --loglevel=error pnpm@10 >/dev/null
fi

# ── 3. This TUI ──────────────────────────────────────────────────────────────

say "installing deepseek-harness-tui ($REPO, $REF) into $APP_DIR"
mkdir -p "$TMP/src"
if [ -n "${DSH_TUI_SOURCE:-}" ]; then
  (cd "$DSH_TUI_SOURCE" && tar --exclude=./node_modules --exclude=./.git -cf - .) | tar -xf - -C "$TMP/src"
else
  fetch "https://codeload.github.com/$REPO/tar.gz/$REF" "$TMP/src.tar.gz"
  tar -xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1
fi
[ -f "$TMP/src/package.json" ] || die "the download has no package.json: is $REPO@$REF this TUI?"
# Its dependencies only, no scripts: the development tools (husky's git
# hooks among them) are for working on it, not for running it.
(cd "$TMP/src" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)
mkdir -p "$HOME_DIR"
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$TMP/src" "$APP_DIR"
rm -rf "$APP_DIR.old"

# ── 4. The tui profile ───────────────────────────────────────────────────────

say "wiring the harness's tui profile to it"
dsh plugin --profile tui add "$APP_DIR" >"$TMP/plugin.log" 2>&1 || {
  cat "$TMP/plugin.log" >&2
  die "dsh plugin --profile tui add failed"
}

# A new profile watches its patch layer for live reloading, which needs a
# reload service a plain install does not mount: dsh then stops at start
# ("user patch-layer watching requires the Cordis HMR service"). The patch
# layer is read once, at start, instead.
node -e '
const fs = require("fs");
const file = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
pkg.dsh.profile.patchReload = "startup";
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
' "$HOME/.dsh/profiles/tui/package.json"

# ── 5. The command ───────────────────────────────────────────────────────────

cat >"$BIN_DIR/dsh-tui" <<EOF
#!/bin/sh
# Opens deepseek-harness-tui (installed by its install.sh; run that again to
# update). The Node.js it was installed with comes first on PATH.
PATH="$NODE_DIR/bin:$BIN_DIR:\$PATH"
export PATH
exec dsh --profile tui "\$@"
EOF
chmod 755 "$BIN_DIR/dsh-tui"

say "done: deepseek-harness-tui is installed"
echo
case ":$USER_PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    warn "$BIN_DIR is not on your PATH. Add it (then open a new terminal):"
    echo "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc   # or ~/.zshrc"
    echo
    ;;
esac
echo "  Open it:            dsh-tui"
echo "  Choose a model:     /models inside it (an API key, or a local server)"
echo "  Update it later:    run this installer again"

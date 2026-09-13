#!/bin/bash
# Builds double-clickable macOS launchers for this checkout:
#   "God's Eye View.app"       builds a fresh production bundle and serves it
#                              in the background (if not already running),
#                              then opens the browser. Every launch picks up
#                              the latest source — there's just no hot-reload
#                              while it's already open (see start.sh).
#   "Stop God's Eye View.app"  stops that background server.
# Usage: ./scripts/make-mac-app.sh [install-dir]   (default: /Applications)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/Applications}"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"

NODE_BIN="/opt/homebrew/opt/node@24/bin"
PORT=4173
LOG="$HOME/Library/Logs/GodsEyeView.log"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---- icon: render public/logo.svg into an .icns --------------------------
make_icon() {
  local iconset="$WORK/AppIcon.iconset"
  mkdir -p "$iconset"
  (cd "$REPO" && PATH="$NODE_BIN:$PATH" node --input-type=module -e "
    import sharp from 'sharp';
    const svg = await import('node:fs').then(fs => fs.readFileSync('$REPO/public/logo.svg'));
    const size = 1024, pad = 120, inner = size - pad * 2;
    const logo = await sharp(svg, { density: 1200 }).resize(inner, inner, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } }).png().toBuffer();
    const bg = Buffer.from('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"1024\"><defs><radialGradient id=\"g\" cx=\"50%\" cy=\"40%\" r=\"70%\"><stop offset=\"0\" stop-color=\"#10263a\"/><stop offset=\"1\" stop-color=\"#03080d\"/></radialGradient></defs><rect x=\"40\" y=\"40\" width=\"944\" height=\"944\" rx=\"210\" fill=\"url(#g)\" stroke=\"#1f4a66\" stroke-width=\"6\"/></svg>');
    await sharp(bg).composite([{ input: logo, left: pad, top: pad }]).png().toFile('$WORK/icon-1024.png');
  ")
  for s in 16 32 128 256 512; do
    sips -z $s $s "$WORK/icon-1024.png" --out "$iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$WORK/icon-1024.png" --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$WORK/AppIcon.icns"
}

# ---- bundle writer --------------------------------------------------------
make_bundle() { # name, bundle-id, script-file
  local app="$DEST/$1.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp "$3" "$app/Contents/MacOS/launcher"
  chmod +x "$app/Contents/MacOS/launcher"
  cp "$WORK/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$1</string>
  <key>CFBundleDisplayName</key><string>$1</string>
  <key>CFBundleIdentifier</key><string>$2</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
  codesign --force --sign - "$app" >/dev/null 2>&1 || true
  echo "Installed: $app"
}

# ---- launcher scripts -----------------------------------------------------
cat > "$WORK/start.sh" <<EOF
#!/bin/bash
REPO="$REPO"
URL="http://localhost:$PORT"
LOG="$LOG"
export PATH="$NODE_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

alert() { osascript -e "display alert \"God's Eye View\" message \"\$1\" as critical" >/dev/null; }
is_gev() { curl -fsS --max-time 2 "\$URL" 2>/dev/null | grep -q "God's Eye View"; }

if is_gev; then open "\$URL"; exit 0; fi

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  alert "Port $PORT is being used by another app. Close it and try again."
  exit 1
fi
if [ ! -d "\$REPO/node_modules" ]; then
  alert "Dependencies are missing. In the project folder run: npm ci"
  exit 1
fi

cd "\$REPO"
: > "\$LOG"
# A fresh production build every launch: ~3.4x less transfer and ~7x fewer
# requests than \`vite dev\` (unbundled, unminified, per-module fetches), which
# is what made the app feel sluggish to load/switch stacks in. This still
# picks up whatever source is on disk right now — it's just not hot-reloading
# while already open, unlike \`npm run dev\`.
if ! npm run build >> "\$LOG" 2>&1; then
  alert "The production build failed. See the log: \$LOG"
  open -a Console "\$LOG"
  exit 1
fi
# Detach fully so the server outlives this launcher.
( nohup npm run preview -- --port $PORT --strictPort >> "\$LOG" 2>&1 & )

for _ in \$(seq 1 90); do
  if is_gev; then open "\$URL"; exit 0; fi
  sleep 0.5
done
alert "The server didn't start within 45 seconds. See the log: \$LOG"
open -a Console "\$LOG"
exit 1
EOF

cat > "$WORK/stop.sh" <<EOF
#!/bin/bash
PIDS=\$(lsof -nP -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null)
STOPPED=0
for pid in \$PIDS; do
  cwd=\$(lsof -a -p "\$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [ "\$cwd" = "$REPO" ]; then kill "\$pid" && STOPPED=1; fi
done
if [ \$STOPPED = 1 ]; then
  osascript -e 'display notification "Server stopped." with title "God'"'"'s Eye View"'
else
  osascript -e 'display notification "It wasn'"'"'t running." with title "God'"'"'s Eye View"'
fi
EOF

make_icon
make_bundle "God's Eye View" "local.gods-eye-view.launcher" "$WORK/start.sh"
make_bundle "Stop God's Eye View" "local.gods-eye-view.stop" "$WORK/stop.sh"

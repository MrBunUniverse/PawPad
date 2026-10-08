#!/bin/bash
# Builds standalone bridge executables (Node single-executable apps) and release zips into dist/.
# Needs: node 22, npm, curl, zip, tar, internet access. Run from anywhere:  bash scripts/build-release.sh
# Optional: TARGETS="darwin-arm64" bash scripts/build-release.sh   (build a subset)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/scripts/.build"
DIST="$ROOT/dist"
NODE_VERSION="$(node -p 'process.versions.node')"   # target binaries must match the node that makes the blob
TARGETS="${TARGETS:-darwin-arm64 darwin-x64 win-x64 linux-x64}"

[ "${NODE_VERSION%%.*}" -ge 22 ] || { echo "Node 22+ required (found $NODE_VERSION)"; exit 1; }
[ -f "$ROOT/pad_stream.prx" ] || { echo "pad_stream.prx missing: build it first with ps4-plugin/build_prx.sh"; exit 1; }

rm -rf "$DIST"; mkdir -p "$BUILD" "$DIST"
cd "$BUILD"
[ -f package.json ] || echo '{"name":"bridge-build","private":true}' > package.json
npm install --silent --no-audit --no-fund esbuild postject >/dev/null
(cd "$ROOT/mac-receiver" && npm ci --silent --no-audit --no-fund)

echo "[1/4] Bundling bridge..."
./node_modules/.bin/esbuild "$ROOT/mac-receiver/server.js" --bundle --platform=node --target=node22 \
    --format=cjs --external:bufferutil --external:utf-8-validate --outfile=bridge.cjs --log-level=warning

echo "[2/4] Creating SEA blob (overlay files embedded)..."
cat > sea-config.json <<JSON
{
  "main": "bridge.cjs",
  "output": "sea.blob",
  "disableExperimentalSEAWarning": true,
  "assets": {
    "index.html": "$ROOT/obs-overlay/index.html",
    "style.css": "$ROOT/obs-overlay/style.css",
    "app.js": "$ROOT/obs-overlay/app.js",
    "retro.js": "$ROOT/obs-overlay/retro.js"
  }
}
JSON
node --experimental-sea-config sea-config.json >/dev/null

# Templates for the PS4 side (no personal IP in releases)
cat > pad_stream.ini <<'INI'
; Copy to /data/GoldHEN/pad_stream.ini on the PS4
[Network]
; IP address of the computer running the bridge (the bridge prints it on start)
ip = 192.168.1.100
port = 9999

[Performance]
; 16 = about 60 updates per second, 8 = about 120
poll_rate_ms = 16
INI
cat > plugins.ini <<'INI'
; Add to /data/GoldHEN/plugins.ini on the PS4 (merge with your existing entries)
[default]
/data/GoldHEN/plugins/pad_stream.prx
INI

# Local-controller support: the SDL binding is a native add-on, which Node single-executables cannot embed.
# Each zip gets native/sdl (the package's JavaScript + that platform's prebuilt sdl.node and SDL library) next to the bridge;
# the bridge loads it at startup and stays PS4-only if the folder is missing.
SDL_PKG="$ROOT/mac-receiver/node_modules/@kmamal/sdl"
[ -f "$SDL_PKG/package.json" ] || { echo "@kmamal/sdl not installed (run npm ci in mac-receiver)"; exit 1; }
SDL_VERSION="$(node -p "require('$SDL_PKG/package.json').version")"
add_native() {  # add_native <target> <destination zip folder>
    local target="$1" dest="$2" plat
    case "$target" in win-x64) plat=win32-x64 ;; *) plat="$target" ;; esac
    local archive="$BUILD/sdl.node-v$SDL_VERSION-$plat.tar.gz"
    [ -f "$archive" ] || curl -fsSL "https://github.com/kmamal/node-sdl/releases/download/v$SDL_VERSION/sdl.node-v$SDL_VERSION-$plat.tar.gz" -o "$archive"
    local sdl="$dest/native/sdl"
    mkdir -p "$sdl/dist" "$sdl/src"
    cp "$SDL_PKG/package.json" "$SDL_PKG/LICENSE" "$sdl/"
    cp -R "$SDL_PKG/src/javascript" "$sdl/src/javascript"
    tar -xzf "$archive" -C "$sdl/dist"
    case "$target" in darwin-*) codesign --force --sign - "$sdl"/dist/*.dylib "$sdl/dist/sdl.node" 2>/dev/null || true ;; esac
}

echo "[3/4] Building executables..."
for target in $TARGETS; do
    case "$target" in
        win-x64)  ext=zip;    exe=bridge.exe; inner="node-v$NODE_VERSION-win-x64/node.exe" ;;
        *)        ext=tar.gz; exe=bridge;     inner="node-v$NODE_VERSION-$target/bin/node" ;;
    esac
    work="$BUILD/$target"; rm -rf "$work"; mkdir -p "$work"
    archive="$BUILD/node-$NODE_VERSION-$target.$ext"
    [ -f "$archive" ] || curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$target.$ext" -o "$archive"
    if [ "$ext" = zip ]; then unzip -q -o "$archive" "$inner" -d "$work"; else tar -xzf "$archive" -C "$work" "$inner"; fi
    cp "$work/$inner" "$work/$exe"; rm -rf "$work/node-v$NODE_VERSION-$target"

    case "$target" in
        darwin-*) codesign --remove-signature "$work/$exe" 2>/dev/null || true
                  ./node_modules/.bin/postject "$work/$exe" NODE_SEA_BLOB sea.blob \
                      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA >/dev/null
                  codesign --sign - "$work/$exe" 2>/dev/null || true ;;
        *)        ./node_modules/.bin/postject "$work/$exe" NODE_SEA_BLOB sea.blob \
                      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null ;;
    esac
    chmod +x "$work/$exe"

    echo "[4/4] Packaging $target..."
    pkg="PawPad-$target"
    mkdir -p "$DIST/$pkg"
    mv "$work/$exe" "$DIST/$pkg/"
    add_native "$target" "$DIST/$pkg"
    cp "$ROOT/pad_stream.prx" "$BUILD/pad_stream.ini" "$BUILD/plugins.ini" "$DIST/$pkg/"
    [ -f "$ROOT/README.md" ] && cp "$ROOT/README.md" "$DIST/$pkg/"
    [ -f "$ROOT/LICENSE" ] && cp "$ROOT/LICENSE" "$DIST/$pkg/"
    (cd "$DIST" && zip -qr -X "$pkg.zip" "$pkg" && rm -rf "$pkg")
done

echo; echo "Done. Release files:"; ls -lh "$DIST"

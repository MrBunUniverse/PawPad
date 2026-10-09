#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_BUNDLE="$PROJECT_DIR/PawPad.app"
SRC_DIR="$SCRIPT_DIR/src"
ASSETS_DIR="$SCRIPT_DIR/assets"

echo "Building native macOS Menu Bar Application at $APP_BUNDLE..."

# 1. AppIcon.icns is checked in (regenerate with: python3 assets/make_icon.py)

# 2. Re-create bundle directory structure
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# 3. Copy AppIcon.icns
cp "$ASSETS_DIR/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"

# 4. Create Info.plist (LSUIElement = true gives a seamless Menu Bar app experience)
cat << 'EOF' > "$APP_BUNDLE/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>PawPad</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.pawpad.menubar</string>
    <key>CFBundleName</key>
    <string>PawPad</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

# 5. Compile Swift binary with swiftc
echo "Compiling native Swift Menu Bar binary..."
swiftc -O -target "$(uname -m)-apple-macos11" "$SRC_DIR/PS4OverlayMenuBar.swift" -o "$APP_BUNDLE/Contents/MacOS/PawPad"

# 6. Set permissions
chmod +x "$APP_BUNDLE/Contents/MacOS/PawPad"
xattr -cr "$APP_BUNDLE" 2>/dev/null || true

# 7. Sign the whole bundle (ad-hoc). The designated requirement is the bundle id, so permission grants survive rebuilds.
codesign --force --deep --sign - --requirements '=designated => identifier "com.pawpad.menubar"' "$APP_BUNDLE"

echo "✓ Native macOS Menu Bar Application built successfully at $APP_BUNDLE!"

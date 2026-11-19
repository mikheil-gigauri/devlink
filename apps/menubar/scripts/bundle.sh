#!/usr/bin/env bash
# Builds Devlink.app into apps/menubar/build: a menu bar-only app (LSUIElement), signed ad hoc so it
# runs on this Mac. It installs nothing; copy it to /Applications yourself if you want to keep it.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$here/../../packages/devlink/package.json').version")"
app="$here/build/Devlink.app"

cd "$here"
xcrun swift build -c release --product Devlink
binary="$(xcrun swift build -c release --show-bin-path)/Devlink"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/Devlink"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.devlink.menubar</string>
  <key>CFBundleName</key><string>devlink</string>
  <key>CFBundleDisplayName</key><string>devlink</string>
  <key>CFBundleExecutable</key><string>Devlink</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHumanReadableCopyright</key><string>MIT License</string>
</dict>
</plist>
PLIST
codesign --force --sign - --timestamp=none "$app"
echo "Built $app"

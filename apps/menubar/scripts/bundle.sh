#!/usr/bin/env bash
# Builds Dryfit.app into apps/menubar/build: a menu bar-only app (LSUIElement). It installs nothing;
# copy it to /Applications yourself if you want to keep it.
#
#   DRYFIT_UNIVERSAL=1         build for Apple silicon and Intel in one binary (releases do)
#   DRYFIT_SIGN_IDENTITY=...   sign with a Developer ID and the hardened runtime, ready to notarize;
#                               without it the app is signed ad hoc and runs on this Mac only
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$here/../../packages/dryfit/package.json').version")"
app="$here/build/Dryfit.app"

cd "$here"
arch=()
[ "${DRYFIT_UNIVERSAL:-}" = 1 ] && arch=(--arch arm64 --arch x86_64)
xcrun swift build -c release --product Dryfit ${arch[@]+"${arch[@]}"}
binary="$(xcrun swift build -c release ${arch[@]+"${arch[@]}"} --show-bin-path)/Dryfit"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/Dryfit"
# The Icon Composer icon: Assets.car for macOS 26's layered Liquid Glass icon, AppIcon.icns for Finder.
xcrun actool "$here/Resources/AppIcon.icon" --compile "$app/Contents/Resources" --platform macosx \
  --minimum-deployment-target 26.0 --app-icon AppIcon \
  --output-partial-info-plist "$here/build/icon-info.plist" >/dev/null
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.dryfit.menubar</string>
  <key>CFBundleName</key><string>dryfit</string>
  <key>CFBundleDisplayName</key><string>dryfit</string>
  <key>CFBundleExecutable</key><string>Dryfit</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIconName</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHumanReadableCopyright</key><string>MIT License</string>
</dict>
</plist>
PLIST
if [ -n "${DRYFIT_SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$DRYFIT_SIGN_IDENTITY" "$app"
  codesign --verify --strict --verbose=2 "$app"
else
  codesign --force --sign - --timestamp=none "$app"
fi
echo "Built $app"

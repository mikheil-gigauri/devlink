#!/usr/bin/env bash
# Builds Dryfit.app into apps/menubar/build: a menu bar-only app (LSUIElement). It installs nothing;
# copy it to /Applications yourself if you want to keep it.
#
#   DRYFIT_UNIVERSAL=1         build for Apple silicon and Intel in one binary (releases do)
#   DRYFIT_SIGN_IDENTITY=...   sign with a Developer ID and the hardened runtime, ready to notarize;
#                               without it the app is signed ad hoc and runs on this Mac only
#
# With Resources/SparklePublicKey, the app updates itself from the appcast each release attaches
# (scripts/appcast.sh); without it, it does not.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$here/../../packages/dryfit/package.json').version")"
app="$here/build/Dryfit.app"

cd "$here"
arch=()
[ "${DRYFIT_UNIVERSAL:-}" = 1 ] && arch=(--arch arm64 --arch x86_64)
xcrun swift build -c release --product Dryfit ${arch[@]+"${arch[@]}"}
products="$(xcrun swift build -c release ${arch[@]+"${arch[@]}"} --show-bin-path)"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$app/Contents/Frameworks"
cp "$products/Dryfit" "$app/Contents/MacOS/Dryfit"
# Sparkle, without the XPC services that only a sandboxed app uses.
sparkle="$app/Contents/Frameworks/Sparkle.framework"
ditto "$products/Sparkle.framework" "$sparkle"
rm -rf "$sparkle/XPCServices" "$sparkle/Versions/B/XPCServices"

updates=""
public_key="$(tr -d '[:space:]' < "$here/Resources/SparklePublicKey" 2>/dev/null || true)"
if [ -n "$public_key" ]; then
  updates="<key>SUFeedURL</key><string>https://github.com/mikheil-gigauri/dryfit/releases/latest/download/appcast.xml</string>
  <key>SUPublicEDKey</key><string>$public_key</string>
  <key>SUEnableAutomaticChecks</key><true/>
  <key>SUAutomaticallyUpdate</key><true/>"
else
  echo "No Resources/SparklePublicKey, so this build does not update itself." >&2
fi
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
  $updates
</dict>
</plist>
PLIST
sign() {
  if [ -n "${DRYFIT_SIGN_IDENTITY:-}" ]; then
    codesign --force --options runtime --timestamp --sign "$DRYFIT_SIGN_IDENTITY" "$1"
  else
    codesign --force --sign - --timestamp=none "$1"
  fi
}
# Inside out: Sparkle's helpers, Sparkle, then the app.
sign "$sparkle/Versions/B/Autoupdate"
sign "$sparkle/Versions/B/Updater.app"
sign "$sparkle"
sign "$app"
codesign --verify --deep --strict --verbose=2 "$app"
echo "Built $app"

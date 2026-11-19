#!/usr/bin/env bash
# Packs a built Dryfit.app (see bundle.sh) into build/Dryfit.dmg: the app next to a link to
# /Applications, to drag it onto. Prints the disk image's path.
#
# The name carries no version, so https://github.com/mikheil-gigauri/dryfit/releases/latest/download/Dryfit.dmg
# always downloads the newest one; the volume's name says which version it is.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
app="${1:-$here/build/Dryfit.app}"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
stage="$here/build/dmg"
dmg="$here/build/Dryfit.dmg"

rm -rf "$stage" "$dmg"
mkdir -p "$stage"
ditto "$app" "$stage/Dryfit.app"
ln -s /Applications "$stage/Applications"
hdiutil create -quiet -volname "dryfit $version" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg"
rm -rf "$stage"
if [ -n "${DRYFIT_SIGN_IDENTITY:-}" ]; then
  codesign --force --timestamp --sign "$DRYFIT_SIGN_IDENTITY" "$dmg"
fi
hdiutil verify -quiet "$dmg"
echo "$dmg"

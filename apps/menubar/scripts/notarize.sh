#!/usr/bin/env bash
# Notarizes a Developer ID-signed Devlink.app (see bundle.sh), staples the ticket to it, and zips it
# for release as build/Devlink-<version>.zip. Prints the zip's path and SHA-256.
#
#   APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD   an Apple ID with an app-specific password
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
app="${1:-$here/build/Devlink.app}"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
upload="$here/build/Devlink-notarize.zip"
zip="$here/build/Devlink-$version.zip"

ditto -c -k --keepParent "$app" "$upload"
xcrun notarytool submit "$upload" --wait \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose "$app"

rm -f "$upload" "$zip"
ditto -c -k --keepParent "$app" "$zip"
echo "$zip"
shasum -a 256 "$zip" | cut -d' ' -f1

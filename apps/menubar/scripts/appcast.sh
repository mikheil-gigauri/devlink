#!/usr/bin/env bash
# Writes build/appcast.xml, the Sparkle feed the installed app checks for updates, for a released
# Dryfit-<version>.zip, and prints its path. Releases attach it, so the feed URL the app asks for,
# https://github.com/mikheil-gigauri/dryfit/releases/latest/download/appcast.xml, always names the
# newest version.
#
#   SPARKLE_PRIVATE_KEY=... scripts/appcast.sh build/Dryfit-<version>.zip
#
# The key is the EdDSA private key that matches Resources/SparklePublicKey (generate_keys -x).
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
zip="$1"
: "${SPARKLE_PRIVATE_KEY:?the EdDSA private key that matches Resources/SparklePublicKey}"
sign_update="$here/.build/artifacts/sparkle/Sparkle/bin/sign_update"
[ -x "$sign_update" ] || { echo "Build the app first (scripts/bundle.sh): it fetches Sparkle's tools" >&2; exit 1; }

version="$(basename "$zip" .zip)"
version="${version#Dryfit-}"
release="https://github.com/mikheil-gigauri/dryfit/releases/download/%40dryfit/cli%40$version"
# sparkle:edSignature="…" length="…"
signature="$(printf '%s' "$SPARKLE_PRIVATE_KEY" | "$sign_update" --ed-key-file - "$zip")"
appcast="$here/build/appcast.xml"

cat > "$appcast" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>dryfit</title>
    <item>
      <title>dryfit $version</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$version</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>26.0</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>https://github.com/mikheil-gigauri/dryfit/releases/tag/%40dryfit%2Fcli%40$version</sparkle:fullReleaseNotesLink>
      <enclosure url="$release/Dryfit-$version.zip" type="application/octet-stream" $signature />
    </item>
  </channel>
</rss>
XML
echo "$appcast"

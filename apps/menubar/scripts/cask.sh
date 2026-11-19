#!/usr/bin/env bash
# Prints the Homebrew cask for a released Dryfit.app zip: scripts/cask.sh <version> <sha256>.
# The release workflow writes it to Casks/dryfit.rb in the tap repository.
set -euo pipefail
version="$1"
sha256="$2"
cat <<RUBY
cask "dryfit" do
  version "$version"
  sha256 "$sha256"

  url "https://github.com/mikheil-gigauri/dryfit/releases/download/%40dryfit/cli%40#{version}/Dryfit-#{version}.zip"
  name "dryfit"
  desc "Menu bar app for testing unreleased npm libraries in real apps"
  homepage "https://mikheil-gigauri.github.io/dryfit/"

  # The app updates itself with Sparkle; brew upgrade leaves it to that.
  auto_updates true
  depends_on macos: ">= :tahoe"

  app "Dryfit.app"

  zap trash: "~/Library/Preferences/dev.dryfit.menubar.plist"

  caveats <<~EOS
    The menu bar app drives the dryfit command-line tool. Install it with:
      npm install --global @dryfit/cli
  EOS
end
RUBY
